package io.github.pawsey0319.learninghub;

import android.app.*;
import android.content.*;
import android.graphics.*;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.*;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.view.WindowManager;
import com.getcapacitor.JSObject;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.security.MessageDigest;
import java.util.UUID;

/** Captures locally at most once per two seconds while our Activity is not visible.
 * No networking, disk storage, accessibility, overlay or automatic model calls. */
public class ScreenCaptureService extends Service {
    static volatile ScreenCaptureService current;
    private static volatile String lastReason = "not-started";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private MediaProjection projection;
    private VirtualDisplay display;
    private ImageReader reader;
    private BroadcastReceiver lockReceiver;
    private boolean registered, ended, contentVisible = true;
    private byte[] jpeg;
    private String hash, frameId, sessionId;
    private long capturedAt, lastCapture, notBefore;
    private int width, height;
    private String state = "starting";
    private static final long TTL = 30000, INTERVAL = 2000;
    private final MediaProjection.Callback callback = new MediaProjection.Callback() {
        @Override public void onStop() { finish("system-stop"); }
        @Override public void onCapturedContentVisibilityChanged(boolean visible) {
            contentVisible = visible;
            if (!visible && !ScreenContextPlugin.ownVisible) { clearFrame(); state = "source-not-visible"; }
        }
        @Override public void onCapturedContentResize(int w, int h) {
            if (w <= 0 || h <= 0 || ended || display == null || (w == width && h == height)) return;
            clearFrame();
            display.setSurface(null);
            if (reader != null) reader.close();
            width = w; height = h;
            reader = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 2);
            reader.setOnImageAvailableListener(ScreenCaptureService.this::onImage, handler);
            display.resize(w, h, getResources().getDisplayMetrics().densityDpi);
            display.setSurface(ScreenContextPlugin.ownVisible ? null : reader.getSurface());
            state = "waiting-source";
        }
    };
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && "STOP".equals(intent.getAction())) { finish("notification-stop"); return START_NOT_STICKY; }
        if (current != null || projection != null) return START_NOT_STICKY;
        ScreenContextPlugin.Grant grant = ScreenContextPlugin.takeGrant();
        if (grant == null) { stopSelf(); return START_NOT_STICKY; } // never restore a token
        current = this; sessionId = UUID.randomUUID().toString();
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(new NotificationChannel("screen-context", "阅读屏幕共享", NotificationManager.IMPORTANCE_LOW));
            Intent stop = new Intent(this, ScreenCaptureService.class).setAction("STOP");
            PendingIntent pi = PendingIntent.getService(this, 31, stop, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, "screen-context") : new Notification.Builder(this);
            Notification notification = builder.setSmallIcon(android.R.drawable.ic_menu_view).setContentTitle("阅读共享已开启")
                .setContentText("仅本机内存限频采集；咨询页暂停；点击停止撤权").setOngoing(true)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "停止共享", pi).build();
            if (Build.VERSION.SDK_INT >= 29) startForeground(32, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
            else startForeground(32, notification);
            MediaProjectionManager manager = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
            projection = manager.getMediaProjection(grant.code, grant.data);
            projection.registerCallback(callback, handler);
            DisplayMetrics metrics = new DisplayMetrics();
            ((WindowManager) getSystemService(WINDOW_SERVICE)).getDefaultDisplay().getRealMetrics(metrics);
            width = metrics.widthPixels; height = metrics.heightPixels;
            // Native display buffers keep correct geometry. Only the resulting JPEG is downscaled.
            reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2);
            reader.setOnImageAvailableListener(this::onImage, handler);
            display = projection.createVirtualDisplay("LearningContext", width, height, metrics.densityDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, ScreenContextPlugin.ownVisible ? null : reader.getSurface(), null, handler);
            lockReceiver = new BroadcastReceiver() { @Override public void onReceive(Context c, Intent i) { finish("screen-locked"); } };
            if (Build.VERSION.SDK_INT >= 33) registerReceiver(lockReceiver, new IntentFilter(Intent.ACTION_SCREEN_OFF), Context.RECEIVER_NOT_EXPORTED);
            else registerReceiver(lockReceiver, new IntentFilter(Intent.ACTION_SCREEN_OFF));
            registered = true; state = "waiting-source";
        } catch (RuntimeException e) { finish("capture-start-failed"); }
        return START_NOT_STICKY;
    }
    @Override public void onCreate() { super.onCreate(); }
    // Notification stop action cannot carry a token or arbitrary target.
    @Override public void onTaskRemoved(Intent intent) { finish("task-removed"); }
    private void onImage(ImageReader source) {
        Image image = null;
        try {
            image = source.acquireLatestImage();
            if (image == null || ended) return;
            PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
            KeyguardManager keyguard = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
            if (!power.isInteractive() || keyguard.isKeyguardLocked()) { finish("screen-locked"); return; }
            long now = SystemClock.elapsedRealtime();
            if (ScreenContextPlugin.ownVisible) { state = "paused-consultation"; return; }
            if (!contentVisible) { clearFrame(); state = "source-not-visible"; return; }
            if (now < notBefore || now - lastCapture < INTERVAL) return;
            lastCapture = now;
            // Detach between samples: no continuous pixel processing or frame retention.
            if (display != null) display.setSurface(null);
            handler.removeCallbacks(nextSample); handler.postDelayed(nextSample, INTERVAL);
            Image.Plane plane = image.getPlanes()[0];
            int stride = plane.getPixelStride(), rowStride = plane.getRowStride();
            if (stride != 4) { clearFrame(); state = "unsupported-pixel-format"; return; }
            ByteBuffer bytes = plane.getBuffer();
            Bitmap padded = Bitmap.createBitmap(rowStride / stride, image.getHeight(), Bitmap.Config.ARGB_8888);
            padded.copyPixelsFromBuffer(bytes);
            Bitmap crop = Bitmap.createBitmap(padded, 0, 0, image.getWidth(), image.getHeight());
            float ratio = Math.min(1f, 1280f / Math.max(crop.getWidth(), crop.getHeight()));
            Bitmap scaled = Bitmap.createScaledBitmap(crop, Math.max(1, Math.round(crop.getWidth() * ratio)), Math.max(1, Math.round(crop.getHeight() * ratio)), true);
            try {
                // Uniform/black/protected pages are not usable evidence; never retain the prior frame.
                int first = scaled.getPixel(0, 0); boolean uniform = true;
                for (int y = 0; y < scaled.getHeight() && uniform; y += Math.max(1, scaled.getHeight() / 16))
                    for (int x = 0; x < scaled.getWidth(); x += Math.max(1, scaled.getWidth() / 16))
                        if (scaled.getPixel(x, y) != first) { uniform = false; break; }
                if (uniform) { clearFrame(); state = "protected-or-empty"; return; }
                ByteArrayOutputStream out = new ByteArrayOutputStream(); scaled.compress(Bitmap.CompressFormat.JPEG, 75, out);
                byte[] next = out.toByteArray();
                if (next.length > 2 * 1024 * 1024) { clearFrame(); state = "frame-too-large"; return; }
                jpeg = next; hash = digest(next); frameId = UUID.randomUUID().toString(); capturedAt = System.currentTimeMillis(); state = "capturing";
                handler.removeCallbacks(expireFrame); handler.postDelayed(expireFrame, TTL);
            } finally {
                if (scaled != crop && scaled != padded) scaled.recycle();
                if (crop != padded) crop.recycle(); padded.recycle();
            }
        } catch (RuntimeException e) { clearFrame(); state = "frame-error"; }
        finally { if (image != null) image.close(); }
    }
    private String digest(byte[] bytes) {
        try { byte[] value = MessageDigest.getInstance("SHA-256").digest(bytes); StringBuilder b = new StringBuilder(); for (byte v : value) b.append(String.format("%02x", v & 255)); return b.toString(); }
        catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
    String requestFrame(int delay) { if (ended) return "STOPPED"; clearFrame(); notBefore = SystemClock.elapsedRealtime() + delay; state = "waiting-source"; return null; }
    void pauseCapture() {
        if (ended) return;
        state = "paused-consultation";
        if (display != null) display.setSurface(null);
        drainPending();
    }
    void resumeCapture() {
        if (ended || display == null || reader == null) return;
        clearFrame(); drainPending();
        notBefore = Math.max(notBefore, SystemClock.elapsedRealtime() + 500);
        state = "waiting-source";
        display.setSurface(reader.getSurface());
    }
    private void drainPending() {
        if (reader == null) return;
        Image pending = reader.acquireLatestImage(); if (pending != null) pending.close();
    }
    private final Runnable nextSample = () -> {
        if (!ended && !ScreenContextPlugin.ownVisible && display != null && reader != null) {
            drainPending(); display.setSurface(reader.getSurface());
        }
    };
    private final Runnable expireFrame = this::clearFrame;
    private void clearFrame() { handler.removeCallbacks(expireFrame); jpeg = null; frameId = null; hash = null; capturedAt = 0; }
    static JSObject status() {
        JSObject o = new JSObject(); ScreenCaptureService s = current;
        o.put("status", s == null ? "stopped" : (ScreenContextPlugin.ownVisible ? "paused-consultation" : s.state));
        o.put("reason", s == null ? lastReason : ""); o.put("sessionId", s == null ? null : s.sessionId);
        o.put("singleAppAvailable", Build.VERSION.SDK_INT >= 34); o.put("scope", "user-selected-unknown");
        o.put("packageName", null); o.put("url", null); o.put("continuousLocalCapture", true);
        o.put("frameId", s == null ? null : s.frameId); o.put("capturedAt", s == null ? 0 : s.capturedAt); return o;
    }
    JSObject preview() {
        if (ended || jpeg == null || !ScreenContextPlugin.ownVisible || System.currentTimeMillis() - capturedAt > TTL) { clearFrame(); return null; }
        JSObject o = status(); o.put("frameId", frameId); o.put("capturedAt", capturedAt); o.put("hash", hash);
        o.put("mimeType", "image/jpeg"); o.put("base64", Base64.encodeToString(jpeg, Base64.NO_WRAP));
        o.put("sourceIdentity", "unknown-requires-user-confirmation"); o.put("live", false); return o;
    }
    void finish(String reason) {
        if (ended) return; ended = true; lastReason = reason; clearFrame(); handler.removeCallbacksAndMessages(null);
        if (display != null) { display.release(); display = null; }
        if (reader != null) { reader.close(); reader = null; }
        MediaProjection p = projection; projection = null;
        if (p != null) { p.unregisterCallback(callback); p.stop(); }
        if (registered) { unregisterReceiver(lockReceiver); registered = false; }
        if (current == this) current = null; stopForeground(true); stopSelf();
    }
    @Override public void onDestroy() { finish("service-destroyed"); super.onDestroy(); }
}
