# Android 跨 App 阅读：源码交付与未验证限制

日期：2026-11-10。此记录不代表阶段二或真机验收通过；未部署、未提交。

## 已实现的安全收敛

- Capacitor `ScreenContext` 插件仅开放 start/status/requestFrame/preview/stop，不接受调用者 Intent、包目标或文件路径。必须应用内同意再弹系统 MediaProjection 授权。授权结果仅内存一次消费，服务 START_NOT_STICKY，进程重建不恢复共享。
- 前台 mediaProjection 服务、持续通知和停止按钮；通知未启用先拒绝开始。Manifest 服务不导出，随任务移除停止；不申请无障碍、任意操作、悬浮窗权限。
- 主 Activity 可见即断开捕获 surface，暂停来源采集；不可见时仅本机限频更新最新 JPEG 内存帧（两秒一帧，采样间断开 surface）。没有后台上传/推理；旧帧30秒后清空，回来源时清旧帧。截图最长边1280、JPEG75、2MiB上限，小字识别能力尚未验证。
- 系统 onStop、锁屏/熄屏、Activity销毁、移除任务、通知停止均释放 projection/display/reader 和帧。旋转/共享对象尺寸变化清旧帧并调整 display/reader；失败不兜底旧图。单色/黑屏作为“受保护或空画面”处理，而非宣称读到正文。
- 回咨询仅提供冻结预览与时间/会话/帧 ID/hash，不标实时；逐帧确认用户看到的确切页面，再单次允许向明确处理端发送图片。新帧/来源不明/过期/撤权不继承旧确认；图片不默认进历史或同步。

## 接口

`src/native.js` 导出 `screenContext`：

- `start({consent:true})` → `{status:'starting', singleAppAvailable, scope:'user-selected-unknown'}`；授权结果后仍需 status 确认服务就绪。
- `status()` → status/sessionId/frameId/capturedAt/singleAppAvailable/scope/packageName:null/url:null。
- `requestFrame({delayMs:3000})`：1500–10000ms延迟，清旧帧，留时间回来源；不是自动跳转外部 App。
- `preview()` → `{sessionId,frameId,capturedAt,hash,mimeType:'image/jpeg',base64,live:false}`；仅自家 Activity 可见且帧未过期可取。
- `stop()`：撤权及释放。

`createScreenContext({bridge,now,maxAgeMs})` 纯逻辑控制器：start/status/refresh(delayMs)/preview/confirm({frameId,sourceLabel})/authorize({frameId,destination})/attachment({destination})/stop/dispose。attachment检查原生授权仍有效、会话及帧一致、30秒以内、已逐帧确认来源与目的地，返回 `{mimeType,base64,source}`，发送许可立即消费。sourceLabel只是用户描述，不是系统已验证的包/URL。调用端须在关闭咨询时 stop/dispose，并且不得把旧 attachment 静默放进重试/历史或忽略撤权。

## 兼容边界与下一步真机门槛

| 系统 | 本轮实现 | 未验证/不可承诺 |
|---|---|---|
| API 34+ | 系统 user-choice 共享选择器，优先让用户选单 App | 系统仍可能允许整屏选择；没有可靠来源包/URL/所选范围回传，不能把 singleAppAvailable 当已选单 App；切咨询后被共享 App 是否仍出新帧依系统实现 |
| API 24–33 | MediaProjection整屏，回咨询主动暂停；不声称单App隔离 | 不能可靠感知外部换App/换页，逐帧确认；连续授权仅说明可本机采样，不能证明仍是原页面 |
| API <24 | 不列 Capacitor 8 支持范围 | 未额外适配 |

本轮未实现悬浮咨询入口，不能在来源 App 内直接提问；需“来源 → 回咨询冻结预览确认 → 提问 → 回来源刷新”。这不等于设计所需的完整连续来源身份监听，页面变化无法可靠识别，不能静默继承页面许可。来源仍不确定时必须用户确认；共享仅限可见画面，不含DOM/后台正文/聊天记录。只要系统停止刷新/保护页面/30秒过期就拒绝旧图。

## 只构建验证路径（未运行远端）

已有 `.github/workflows/android.yml` 使用 Node22、JDK21，但是依赖 release 签名 Secrets，不能作为无发布验证。新增 `.github/workflows/android-check.yml` 仅 workflow_dispatch/pull_request（路径过滤），contents只读，无push/tag触发、无Secrets、无release/部署。安装SDK36后通过 `bash app/verify-android.sh` 运行真实 `:app:assembleDebug :app:lintDebug`，只保留lint报告。此工作流尚未在远端触发；2026-11-10已在本机以隔离工具链实际编译和lint通过，详见下方证据。

本地同一脚本要求Node22/JDK21/ANDROID_HOME及platform android-36；先 `npm ci`、复制Web、创建/同步Capacitor工程、运行patch，随后清除所有release签名环境变量再debug编译与lint。Debug APK有Android默认debug签名，不是发布签名，不能用于证明同签升级。脚本会生成ignored目录并安装lockfile依赖，执行前应知悉这些行为；不自动下载SDK。本机已使用隔离工具链实际执行脚本：Temurin JDK 21.0.13+9、SDK 36/build-tools 36.0.0；`assembleDebug` 与 `lintDebug` 成功，326 tasks，lint 0 errors/15 warnings，调试 APK 约 5.5 MiB，SHA256 为 `9ccd69c011d5a2dc991d6f078b5f268ac208edb14e0cf6421a047a418d491af4`。可复现环境为 `JAVA_HOME=$HOME/Library/Caches/learning-hub-android/jdk-21.0.13+9/Contents/Home`、`ANDROID_HOME=$HOME/Library/Caches/learning-hub-android/sdk`、`GRADLE_USER_HOME=$HOME/Library/Caches/learning-hub-android/gradle`；bash语法测试与构建证据不冒充真机验证。

2026-11-10后续一致性核对发现上述历史APK缺少8个后续Web修复（音频provider/预算、认证代际及抽屉/屏幕界面等），因此重新执行同一构建脚本。最新构建 `BUILD SUCCESSFUL in 1m 45s`，326 tasks（257 executed/69 up-to-date），lint仍0 errors/15 warnings；最新APK 5,840,622 bytes，SHA256 `64fe63bba84502551708fda665471bc2c83759c9c3a578d3b7a660a9d4350230`。117个打包输入（含src/content/vendor/icons及配置/数据）逐字节匹配当前工作树，四个原生Java源文件也与生成工程一致。证据见 [当前产物比对](../../../eval/results/android-current-assets-20261110.json)。历史哈希保留为旧构建记录，不能当作当前版本；仍无真机通过证据。另对最新APK扫描已知本机媒体token字节与私有配置/权重/虚拟环境路径，无匹配，未输出凭据值；[扫描证据](../../../eval/results/android-package-private-data-check-20261110.json)仅覆盖已知媒体凭据及指定路径，不代表完整秘密扫描或安全审计，不授予发布资格。

API33+首次开始时通过Capacitor原生 `POST_NOTIFICATIONS` runtime permission回调，请求通知同意后再请求屏幕共享；拒绝/设置关闭给NOTIFICATION_REQUIRED，取消中途授权不继续。原生preview还检查自家Activity可见及TTL：后台桥直接调用不能提取帧；start也要求可见。此桥没有JNI或其他图片导出端口。咨询本身是Web抽屉而非独立Activity，原生无法证明“当前路由确为咨询”；UI负责关闭咨询时stop，不能把JS路由检查声称为OS安全边界。

本机已完成 Android debug Java 编译与 lint，但没有连接 Android 设备或模拟器；源码契约和构建证据不是 OS 生命周期或真机证据。仍需：API34前后微信/外部浏览器各两次新帧提问；系统停止、锁屏、旋转、拒绝、通知停止、任务移除、进程重建、黑屏、厂商后台限制至少两类设备实测；UI关闭撤权及处理端取消链路联验。真实模型图片理解也未由本模块验证。不宣称所有普通 Android 均支持或阶段二已完成。
