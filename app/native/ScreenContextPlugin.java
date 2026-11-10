package io.github.pawsey0319.learninghub;

import android.app.Activity;
import android.content.Intent;
import android.media.projection.MediaProjectionConfig;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.getcapacitor.PermissionState;
import androidx.activity.result.ActivityResult;

/** Narrow, memory-only bridge. No caller supplied Intent, URI, file path or package target. */
@CapacitorPlugin(name = "ScreenContext", permissions = {
    @Permission(alias = "screenNotifications", strings = { "android.permission.POST_NOTIFICATIONS" })
})
public class ScreenContextPlugin extends Plugin {
    static volatile boolean ownVisible = true;
    static final class Grant {
        final int code; final Intent data;
        Grant(int code, Intent data) { this.code = code; this.data = data; }
    }
    private static Grant grant;
    private boolean requesting, cancelled;
    static synchronized Grant takeGrant() { Grant g = grant; grant = null; return g; }

    @PluginMethod public void start(PluginCall call) {
        if (!ownVisible || getActivity() == null || getActivity().isFinishing()) { call.reject("App must be visible", "APP_NOT_VISIBLE"); return; }
        if (!Boolean.TRUE.equals(call.getBoolean("consent", false))) { call.reject("App consent required", "CONSENT_REQUIRED"); return; }
        if (requesting || ScreenCaptureService.current != null) { call.reject("Already sharing", "BUSY"); return; }
        requesting = true; cancelled = false;
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("screenNotifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("screenNotifications", call, "notificationResult"); return;
        }
        launchProjection(call);
    }
    @PermissionCallback private void notificationResult(PluginCall call) {
        if (call == null) { requesting = false; return; }
        if (cancelled) { requesting = false; call.reject("Sharing request cancelled", "CANCELLED"); return; }
        if (getPermissionState("screenNotifications") != PermissionState.GRANTED) {
            requesting = false; call.reject("Notification permission denied", "NOTIFICATION_REQUIRED"); return;
        }
        launchProjection(call);
    }
    private void launchProjection(PluginCall call) {
        if (!((android.app.NotificationManager) getContext().getSystemService(android.content.Context.NOTIFICATION_SERVICE)).areNotificationsEnabled()) {
            requesting = false; call.reject("Enable notifications in Android app settings before sharing", "NOTIFICATION_REQUIRED"); return;
        }
        MediaProjectionManager manager = (MediaProjectionManager) getContext().getSystemService(android.content.Context.MEDIA_PROJECTION_SERVICE);
        // Default user choice permits Android 14+ single-app sharing. Do NOT claim which
        // choice the user made: MediaProjection does not disclose package/URL identity.
        Intent intent = Build.VERSION.SDK_INT >= 34
            ? manager.createScreenCaptureIntent(MediaProjectionConfig.createConfigForUserChoice())
            : manager.createScreenCaptureIntent();
        startActivityForResult(call, intent, "projectionResult");
    }
    @ActivityCallback private void projectionResult(PluginCall call, ActivityResult result) {
        requesting = false;
        if (call == null) return;
        if (cancelled) { call.reject("Sharing request cancelled", "CANCELLED"); return; }
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) { call.reject("Screen sharing denied", "PERMISSION_DENIED"); return; }
        synchronized (ScreenContextPlugin.class) { grant = new Grant(result.getResultCode(), result.getData()); }
        try {
            Intent service = new Intent(getContext(), ScreenCaptureService.class);
            if (Build.VERSION.SDK_INT >= 26) getContext().startForegroundService(service); else getContext().startService(service);
            JSObject out = new JSObject(); out.put("status", "starting"); out.put("singleAppAvailable", Build.VERSION.SDK_INT >= 34); out.put("scope", "user-selected-unknown"); call.resolve(out);
        } catch (RuntimeException e) { takeGrant(); call.reject("Cannot start foreground sharing", "START_FAILED"); }
    }
    @PluginMethod public void status(PluginCall call) { getActivity().runOnUiThread(() -> call.resolve(ScreenCaptureService.status())); }
    @PluginMethod public void requestFrame(PluginCall call) {
        ScreenCaptureService s = ScreenCaptureService.current;
        if (s == null) { call.reject("Sharing stopped", "STOPPED"); return; }
        int delay = call.getInt("delayMs", 3000);
        if (delay < 1500 || delay > 10000) { call.reject("Delay outside 1500..10000", "INVALID_ARGUMENT"); return; }
        getActivity().runOnUiThread(() -> { String error = s.requestFrame(delay); if (error != null) call.reject(error, error); else call.resolve(ScreenCaptureService.status()); });
    }
    @PluginMethod public void preview(PluginCall call) {
        ScreenCaptureService s = ScreenCaptureService.current;
        if (s == null) { call.reject("Sharing stopped", "STOPPED"); return; }
        getActivity().runOnUiThread(() -> { JSObject frame = s.preview(); if (frame == null) call.reject("No fresh frame", "NO_FRESH_FRAME"); else call.resolve(frame); });
    }
    @PluginMethod public void stop(PluginCall call) {
        cancelled = true; takeGrant();
        getActivity().runOnUiThread(() -> { ScreenCaptureService s = ScreenCaptureService.current; if (s != null) s.finish("user-stop"); call.resolve(); });
    }
    @Override protected void handleOnResume() { ownVisible = true; ScreenCaptureService s = ScreenCaptureService.current; if (s != null) s.pauseCapture(); }
    @Override protected void handleOnDestroy() { takeGrant(); ScreenCaptureService s = ScreenCaptureService.current; if (s != null) s.finish("activity-destroyed"); }
}
