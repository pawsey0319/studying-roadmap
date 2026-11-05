# 安卓 App（Capacitor 8）

网页文件打包进安装包（本地打包），不远程加载页面。资讯、前沿路线、商机这些每天或每周更新的内容，App 打开时先从网站读最新的，读不到再用安装包里的。

## 自动出安装包（推荐）

GitHub 仓库 → Actions → “安卓安装包” → Run workflow。跑完在这次运行的页面底部下载 `learning-hub-apk`，解压得到 APK。
推送 `v` 开头的标签（例如 `git tag v3.0.0 && git push origin v3.0.0`）时，会同时发布到 Releases，手机上直接打开 Releases 页下载即可。

签名用仓库里的四个 Secrets：`ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`。每次都用同一个签名文件，新版本才能覆盖安装。

## 发新版本（App 里会提示更新）

```bash
git push origin main
git tag -a v3.0.1 -m "这次更新了什么，一行一条"
git push origin v3.0.1
```

推送标签后，“安卓安装包”工作流会打包、签名，并在 Releases 里发布 APK 和 `version.json`（版本号、下载地址、SHA-256、更新说明）。
已经装了 App 的手机，下次打开时会弹出“发现新版本”，点“立即更新”在 App 里下载、校验，然后交给系统安装器覆盖安装，数据都保留。
第一次更新时系统会要求允许这个 App“安装未知应用”，打开开关回到 App 就会继续安装。
`-m` 里写的就是弹窗里的更新说明；不写的话，用这次的提交标题。设置页有“检查更新”按钮。
版本号是工作流的运行编号，每次都会变大，所以总能覆盖旧版。

更新相关的原生代码在 `app/native/`（`AppUpdatePlugin.java`，由 `patch-android.py` 复制进生成的工程），网页这边在 `src/update.js`。

## 本地打包（可选）

需要 Node 22+、JDK 21、Android Studio（含 Android SDK 36）。

```bash
cd app
npm ci
bash build-web.sh
npx cap add android            # 只第一次
npx capacitor-assets generate --android
npx cap sync android
python3 patch-android.py 1 3.0.0
npx cap open android           # 在 Android Studio 里运行或打包
```

`android/` 和 `www/` 都是生成的，不进仓库。改了网页代码后重新跑 `bash build-web.sh && npx cap sync android`。

## App 和网页版的区别

- 不用缓存程序（sw.js），网页文件随安装包更新。
- 外部链接用系统浏览器打开；返回键先关弹窗和 Agent 抽屉，再后退。
- 导出备份、Anki、AGENTS.md 时弹出系统分享，可以存到文件或发到其他 App。
- 设置里多一项“每天提醒”（本地通知，不经过服务器）。
- 登录、同步、公共区域和网页版一样，用的是同一个腾讯云开发环境（安全来源里已经有 `https://localhost`）。
