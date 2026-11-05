package io.github.pawsey0319.learninghub;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/**
 * App 内更新：下载新版安装包，校验后交给系统安装器覆盖安装。
 * download({url, sha256, size}) 下载到缓存目录，过程中发 progress 事件 {loaded, total}；
 * 下载完核对 SHA-256、包名和版本号（必须是同一个 App 的更高版本）。
 * fetchText({url}) 读版本信息。
 * install({path}) 打开系统安装界面；还没允许“安装未知应用”时先打开那个设置页，返回 {needPermission: true}。
 */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {
    private volatile boolean cancelled = false;

    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url");
        String sha = call.getString("sha256", "");
        if (url == null || !url.startsWith("https://")) { call.reject("下载地址不对"); return; }
        cancelled = false;
        new Thread(() -> {
            File dir = new File(getContext().getCacheDir(), "updates");
            dir.mkdirs();
            for (File old : dir.listFiles() == null ? new File[0] : dir.listFiles()) old.delete();
            File part = new File(dir, "update.apk.part"), out = new File(dir, "update.apk");
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setInstanceFollowRedirects(true);
                c.setConnectTimeout(15000);
                c.setReadTimeout(30000);
                c.setRequestProperty("User-Agent", "learning-hub-app");
                int code = c.getResponseCode();
                if (code != 200) throw new Exception("服务器返回 " + code);
                long total = c.getContentLengthLong(), loaded = 0, last = 0;
                MessageDigest md = MessageDigest.getInstance("SHA-256");
                try (InputStream in = c.getInputStream(); FileOutputStream fo = new FileOutputStream(part)) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        if (cancelled) throw new Exception("已取消");
                        fo.write(buf, 0, n);
                        md.update(buf, 0, n);
                        loaded += n;
                        long now = System.currentTimeMillis();
                        if (now - last > 200) {
                            last = now;
                            JSObject p = new JSObject();
                            p.put("loaded", loaded);
                            p.put("total", total);
                            notifyListeners("progress", p);
                        }
                    }
                }
                StringBuilder hex = new StringBuilder();
                for (byte b : md.digest()) hex.append(String.format("%02x", b));
                if (sha != null && !sha.isEmpty() && !sha.equalsIgnoreCase(hex.toString())) throw new Exception("安装包校验没通过，可能下载不完整，请重试");
                if (!part.renameTo(out)) throw new Exception("保存安装包失败");
                PackageManager pm = getContext().getPackageManager();
                PackageInfo pkg = pm.getPackageArchiveInfo(out.getAbsolutePath(), 0);
                PackageInfo me = pm.getPackageInfo(getContext().getPackageName(), 0);
                if (pkg == null || !getContext().getPackageName().equals(pkg.packageName)) throw new Exception("下载到的不是这个 App 的安装包");
                if (versionOf(pkg) <= versionOf(me)) throw new Exception("下载到的版本不比现在的新");
                JSObject r = new JSObject();
                r.put("path", out.getAbsolutePath());
                r.put("size", out.length());
                call.resolve(r);
            } catch (Exception e) {
                part.delete();
                call.reject(e.getMessage() == null ? "下载失败" : e.getMessage());
            } finally {
                if (c != null) c.disconnect();
            }
        }).start();
    }

    // 读版本信息（JSON 文本）。走原生网络，不受网页跨域限制，会跟随 GitHub 的跳转
    @PluginMethod
    public void fetchText(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !url.startsWith("https://")) { call.reject("地址不对"); return; }
        new Thread(() -> {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setInstanceFollowRedirects(true);
                c.setConnectTimeout(10000);
                c.setReadTimeout(15000);
                c.setRequestProperty("User-Agent", "learning-hub-app");
                c.setRequestProperty("Cache-Control", "no-cache");
                if (c.getResponseCode() != 200) throw new Exception("服务器返回 " + c.getResponseCode());
                StringBuilder sb = new StringBuilder();
                try (InputStream in = c.getInputStream()) {
                    byte[] buf = new byte[8192]; int n; long total = 0;
                    while ((n = in.read(buf)) > 0) { sb.append(new String(buf, 0, n, "UTF-8")); total += n; if (total > 256 * 1024) break; }
                }
                JSObject r = new JSObject();
                r.put("text", sb.toString());
                call.resolve(r);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "读取失败" : e.getMessage());
            } finally {
                if (c != null) c.disconnect();
            }
        }).start();
    }

    @PluginMethod
    public void cancel(PluginCall call) { cancelled = true; call.resolve(); }

    @PluginMethod
    public void install(PluginCall call) {
        String path = call.getString("path");
        File f = path == null ? null : new File(path);
        if (f == null || !f.exists()) { call.reject("找不到下载好的安装包，请重新下载"); return; }
        String pkg = getContext().getPackageName();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent s = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + pkg));
            s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(s);
            JSObject r = new JSObject();
            r.put("needPermission", true);
            call.resolve(r);
            return;
        }
        Uri uri = FileProvider.getUriForFile(getContext(), pkg + ".fileprovider", f);
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(uri, "application/vnd.android.package-archive");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        JSObject r = new JSObject();
        r.put("needPermission", false);
        call.resolve(r);
    }

    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject r = new JSObject();
        r.put("value", Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getContext().getPackageManager().canRequestPackageInstalls());
        call.resolve(r);
    }

    @SuppressWarnings("deprecation")
    private static long versionOf(PackageInfo p) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? p.getLongVersionCode() : p.versionCode;
    }
}
