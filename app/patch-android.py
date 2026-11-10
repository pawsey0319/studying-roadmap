#!/usr/bin/env python3
"""给 `npx cap add android` 生成的工程补上：版本号、发布签名（读环境变量，不写进文件）、通知权限说明、App 内更新（app/native/）。
用法：python3 patch-android.py <versionCode> <versionName>
签名用的四个环境变量（GitHub Secrets 提供）：ANDROID_KEYSTORE_FILE、ANDROID_KEYSTORE_PASSWORD、ANDROID_KEY_ALIAS、ANDROID_KEY_PASSWORD。
"""
import re
import sys
from pathlib import Path

A = Path(__file__).resolve().parent / "android" / "app"
code, name = (sys.argv[1:] + ["1", "1.0"][len(sys.argv) - 1:])[:2]
g = (A / "build.gradle").read_text(encoding="utf-8")
g = re.sub(r"versionCode \d+", f"versionCode {int(code)}", g)
g = re.sub(r'versionName "[^"]*"', f'versionName "{name}"', g)
if "signingConfigs" not in g:
    sign = '''    signingConfigs {
        release {
            def ks = System.getenv("ANDROID_KEYSTORE_FILE")
            if (ks) {
                storeFile file(ks)
                storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias System.getenv("ANDROID_KEY_ALIAS")
                keyPassword System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        release {
            if (System.getenv("ANDROID_KEYSTORE_FILE")) signingConfig signingConfigs.release'''
    g = g.replace("    buildTypes {\n        release {", sign, 1)
(A / "build.gradle").write_text(g, encoding="utf-8")
assert "signingConfig signingConfigs.release" in g and f"versionCode {int(code)}" in g, "build.gradle 的结构变了，补丁没打上"

m = (A / "src" / "main" / "AndroidManifest.xml").read_text(encoding="utf-8")
# 每天提醒用不到精确闹钟，去掉这项敏感权限（插件默认会申请）
if "SCHEDULE_EXACT_ALARM" not in m:
    m = m.replace('<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
                  '<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools">', 1)
    m = m.replace("</manifest>", '    <uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" tools:node="remove" />\n</manifest>', 1)
# 按住说话：只声明录音权限，运行时仍由 WebView/系统逐次请求，不能自动授权。
if 'android.permission.RECORD_AUDIO' not in m:
    m = m.replace('</manifest>', '    <uses-permission android:name="android.permission.RECORD_AUDIO" />\n</manifest>', 1)
# MediaProjection 前台服务：OS 单次授权，非导出服务，不申请无障碍/悬浮窗。
for permission in ["FOREGROUND_SERVICE", "FOREGROUND_SERVICE_MEDIA_PROJECTION", "POST_NOTIFICATIONS"]:
    if f'android.permission.{permission}"' not in m:
        m = m.replace('</manifest>', f'    <uses-permission android:name="android.permission.{permission}" />\n</manifest>', 1)
if 'android:name=".ScreenCaptureService"' not in m:
    m = m.replace('</application>', '    <service android:name=".ScreenCaptureService" android:exported="false" android:foregroundServiceType="mediaProjection" android:stopWithTask="true" />\n    </application>', 1)
# App 内更新：安装新版需要“安装未知应用”的权限
if "REQUEST_INSTALL_PACKAGES" not in m:
    m = m.replace("</manifest>", '    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />\n</manifest>', 1)
# 权限声明统一放到 application 前；兼容已打过补丁的生成工程并保持幂等。
permissions = re.findall(r'\s*<uses-permission\b[^>]*/>', m)
m = re.sub(r'\s*<uses-permission\b[^>]*/>', '', m)
m = m.replace('<application', '\n' + '\n'.join('    ' + p.strip() for p in permissions) + '\n    <application', 1)
(A / "src" / "main" / "AndroidManifest.xml").write_text(m, encoding="utf-8")

# 原生代码：App 内更新插件，替换生成的 MainActivity（注册插件）
import shutil
J = A / "src" / "main" / "java" / "io" / "github" / "pawsey0319" / "learninghub"
J.mkdir(parents=True, exist_ok=True)
for f in (Path(__file__).resolve().parent / "native").glob("*.java"):
    shutil.copy(f, J / f.name)
# 下载的安装包放在缓存目录 updates/ 里，交给系统安装器时要通过 FileProvider 共享
fp = A / "src" / "main" / "res" / "xml" / "file_paths.xml"
x = fp.read_text(encoding="utf-8") if fp.exists() else '<?xml version="1.0" encoding="utf-8"?>\n<paths xmlns:android="http://schemas.android.com/apk/res/android">\n</paths>'
if 'name="updates"' not in x:
    x = x.replace("</paths>", '    <cache-path name="updates" path="updates/" />\n</paths>', 1)
fp.parent.mkdir(parents=True, exist_ok=True); fp.write_text(x, encoding="utf-8")
print(f"已设置版本 {name}（{code}）、发布签名和 App 内更新")
