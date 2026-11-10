# DeepSeek 图片链路适配与验证（2026-11-10）

## 范围与结论

用户要求继续使用既有DeepSeek并连续完整验证；手机由用户自行上手，不要求ADB。复用既有CloudBase认证与额度，不新建账号、不充值、不把密钥写入网页。2026-11-10 23:51用户完成管理授权，明确允许更新现有lh-ai、视觉声明与CORS，后续生产部署依此执行。

**2026-11-11已部署同名线上CloudBase函数并核对4文件与源码一致，正式站、Android及本地CORS通过，鉴权仍开启；现有生产DeepSeek官方配置已真实识图成功。尚无App用户会话，不能宣称真实账号→线上额度→图片的整条链路已通过。**

## 真实文字全层补验

[前端provider→本地生产代理→真实DeepSeek](../../../eval/results/deepseek-text-provider-chain-20261110.json)：实际调用 `src/ai/providers.js` 的hosted `chat`，生产 `handle` 转发真实模型；返回“文字链路正常”，`finishReason=stop`，逐片段累计与最终正文一致，用量41输入/4输出，1.282s，单次上游调用，`ai_take/ai_record`完整执行。认证与额度RPC仍为明确模拟，不是线上账号验证。没有扩大调用规模或自动重试。

## 真实模型证据

使用本机私有配置中的既有兼容网关（不公开地址/Key），请求模型 `DeepSeek-V4.1-Flash`，返回 `deepseek-v4.1-flash-1017`。仅发送项目合成开发卡，无个人截图，无自动重试。

- [首张学习卡](../../../eval/results/deepseek-image-smoke-20261110.json)：HTTP200，2.544s，`finish_reason=stop`，准确返回英语口语、明天下午三点、20分钟、未开始。
- [三项边界卡](../../../eval/results/deepseek-image-boundaries-20261110.json)：缺失作者、审核前提、小字时间；后两张严格字段与行定位均匹配且stop。缺失作者卡768输出token全部用于推理，正文为空、`length`，明确失败，不算成功、不掩盖、不自动重试。三张严格通过2/3，不代表正式准确率。
- [真实本地代理→真实上游](../../../eval/results/deepseek-local-proxy-real-upstream-20261110.json)：运行生产 `handle`，只替换CloudBase身份/额度RPC为本机模拟，模型请求走真实上游；能力GET、CORS、图片转发、SSE、stop、用量、`ai_take`/`ai_record`完整通过。四字段准确，3.65s。**身份及额度不是腾讯云真实验证**。

这些是少量合成开发样本，不是240例冻结集或真人测试；不使用本地模型历史失败作为DeepSeek质量结论，也不把DeepSeek单图成功当原音频能力。

## 安全与兼容设计

- 服务端显式 `AI_VISION_MODELS` 与 `AI_MODELS` 交集才启用，旧部署默认不支持；Anthropic平台接口继续拒绝图数组。
- 只允许user内联PNG/JPEG/WebP/GIF及text块，规范base64与基础文件签名检查；不声称完成图像解码审计。拒绝远程URL、音频、未知块/字段与非user图数组，不过滤后继续答复。
- 每张2MiB，最多4张，总6MiB；文字20万字符独立计算，base64不当作正文token。图片费用仅在上游返回真实usage时可靠，缺失usage的字数估算不包含图片成本。
- 图片和请求格式验证在扣额之前；上游失败沿用原退款。前端依据服务端能力而非模型名字猜测；截图仍需逐帧、目的地、模型确认，临时像素不持久化。

## 线上启用记录（已获授权并于2026-11-11执行）

[生产部署证据](../../../eval/results/cloudbase-deepseek-deployed-20261111.json)：CloudBase CLI 3.9.2管理授权可访问原环境，原代码与完整配置已备份到仓库外私有目录。仅 `AI_ALLOW_ORIGIN`、`AI_VISION_MODELS` 两项发生变化；未移除变量、未换Key/上游/默认模型/额度，运行类型、版本、超时、内存、端口均保持不变。同名函数Active，下载线上4文件与本地逐字节匹配。

生产原模型本来就是官方 `deepseek-flash`，因此新增视觉声明沿用此ID，没有把先前兼容网关模型名写入官方接口。[生产配置官方接口真实图片验证](../../../eval/results/deepseek-official-production-config-20261111.json)：HTTP200，2.663s，四字段准确且stop，无重试。这是生产Key直连官方上游，不是App用户登录链路。

来源保留正式站、Android `https://localhost` 与原8801，并追加本机8811/8000精确来源。正式站/Android/8811预检204；不可信来源403；无令牌及无效令牌均401。没有更改数据库/登录权限。此前本机CORS403为历史状态，现已修复。

当前唯一认证联调缺口：管理CLI会话不是App用户access token；本次没有创建测试用户、替用户重置密码、读浏览器凭据或签发冒充令牌，需要现有用户在当前测试页面正常登录后再完成平台额度/图片链路。

以下为配置依据（历史未部署阶段保留）：

现有CloudBase登录不变；需有管理权限的执行环境部署更新后的同一 `lh-ai` 函数，并保留数据库与鉴权变量：

- `AI_FORMAT=openai`
- `AI_BASE` / `AI_KEY`：采用现有可用服务的私有配置，不在文档中复制。官方直连接口与本次兼容网关的模型ID不可混用。
- `AI_MODELS` 与 `AI_VISION_MODELS`：本次实际网关ID为 `DeepSeek-V4.1-Flash`；官方直连ID须按该服务文档配置，不凭别名猜测。
- `AI_ALLOW_ORIGIN` 保留正式站和Android来源，若需要本机预览则追加对应完整origin，不能用关闭认证替代CORS修复。
- 云网关需容纳受限视觉请求体（函数约9.3MiB上限），若网关上限更小需实测或进一步缩图，不隐式放大预算。

[线上只读就绪探测](../../../eval/results/deepseek-remote-readiness-20261110.json)确认：正式站origin预检204；本机`http://127.0.0.1:8811`仍403且没有CORS响应头；未登录GET仍401，鉴权未被关闭。没有使用真实登录身份调用线上图片。

当前没有云函数管理凭据/CLI登录，不能从公开publishable key取得管理权限。浏览器现有账号登录与云函数部署权限不是一回事。本文不声称已更改远端变量或生产函数。

## 最终回归

- 父独立全量Node **233/233**，Python **66/66**，`git diff --check`通过。后端独立只读复审未发现可确证阻断问题；这不是并发压力/完整图像解码安全审计。
- [真实Chromium界面](../../../eval/results/browser-hosted-vision-20261110.json)：使用生产screen-consult模块、真实DOM，模拟cloud/capture边界，验证旧部署拒绝且保留预览、显式能力可发送、目的地与模型确认无凭据、授权单次消费，errors=[]。不是真实云登录或Android采屏；测试服务已回收。
- screen-only发送会将确认的视觉模型锁入本次请求，避免确认后默认模型变化；工具循环同样使用该模型，临时字段与像素不落盘。
- Android最终重新构建 `assembleDebug + lintDebug`成功，lint **0 error / 15 warnings**；[117项网页资源逐字节匹配](../../../eval/results/android-deepseek-vision-assets-20261110.json)，包含最终模型锁定修复。APK为 `app/android/app/build/outputs/apk/debug/app-debug.apk`，5,840,948 bytes，SHA256 `be5cad1ed5f2b62d8d799f8f819d3d1267a1e4e95f9fdb2b110cd232cf02482d`。这是调试包构建，不是手机实测或发布；由用户自行安装验收。

另已补齐完整无密钥函数归档 `/tmp/learning-hub-deepseek-ai-function-complete-20261111.zip`，包含index.mjs、lib.mjs、package.json、scf_bootstrap、README.md；启动文件可执行权限保留、5文件逐字节核对。此前三文件zip仅是更新材料，不可作为全新HTTP函数完整部署包。

部署前旧代码与含敏感变量的配置位于仓库外 `~/.config/learning-hub/cloudbase-backup-20261110/`（目录700、文件600），不得分享。必要时对同名函数回滚此处旧代码与原Environment；不能拿公开无密钥zip恢复密钥配置。当前尚未执行回滚。

所有历史模型、协议、手机生命周期与正式评测缺口继续保留于[整体验收](2026-11-10-integrated-acceptance-status.md)。
