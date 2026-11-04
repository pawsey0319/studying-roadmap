#!/usr/bin/env python3
"""给 `npx cap add android` 生成的工程补上：版本号、发布签名（读环境变量，不写进文件）、通知权限说明。
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
(A / "src" / "main" / "AndroidManifest.xml").write_text(m, encoding="utf-8")
print(f"已设置版本 {name}（{code}）和发布签名")
