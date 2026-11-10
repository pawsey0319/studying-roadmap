# 平台模型代理 lh-ai（腾讯云开发 HTTP 云函数）

学习 Agent 选“平台模型”时，网页把请求发到这里；这里核对登录和额度，再转发给模型服务，原样流式返回。
模型 Key、数据库服务端 Key、调用口令只放在云函数的环境变量里。不依赖任何 npm 包，Node 20。

## 部署（第一次，约 20 分钟）

1. 数据库：控制台 → 数据库 → PostgreSQL → SQL 编辑器，执行 `cloudbase/schema.sql` 第 11 段。
   执行前把第 11 段里 `insert into public.ai_secret` 那一行的注释去掉，`<调用口令>` 换成 32 位以上的随机串
   （终端运行 `openssl rand -hex 24` 得到一串），执行后**不要**把这串字符提交到仓库。
2. 云函数：控制台 → 云函数 → 新建 → 选“HTTP 云函数”，名字 `lh-ai`，运行环境 Node.js 20，
   上传本目录的 4 个文件（`index.mjs`、`lib.mjs`、`package.json`、`scf_bootstrap`）。`scf_bootstrap` 要有可执行权限。
   执行超时时间设为 120 秒（长回答需要时间），内存 256 MB。
3. 环境变量（云函数 → 函数配置 → 环境变量）：

| 变量 | 必填 | 说明 |
|---|---|---|
| `CB_ENV` | 是 | 环境 ID，例如 `studyingloop-d4gve2bc779a7d0ea` |
| `CB_SERVICE_KEY` | 是 | 服务端 API Key（和 GitHub Secrets 里的 `CLOUDBASE_API_KEY` 可以是同一个） |
| `AI_DB_SECRET` | 是 | 第 1 步那串随机字符 |
| `AI_BASE` | 是 | 模型接口地址，填到 `/v1` 为止 |
| `AI_KEY` | 是 | 模型接口的 Key |
| `AI_MODELS` | 是 | 允许的模型，逗号分隔，第一个是默认 |
| `AI_VISION_MODELS` | 否 | 显式允许图片的模型，逗号分隔，**默认空（拒图）**。必须同时出现在 `AI_MODELS` 且 `AI_FORMAT` 为 OpenAI 格式；例如 `deepseek-flash`，不能按模型名称猜测能力 |
| `AI_FORMAT` | 否 | 接口是 Anthropic 格式时填 `anthropic` |
| `AI_PRICES` | 否 | 成本单价，JSON，单位“元 / 百万 token”，例如 `{"deepseek-chat":[2,8]}`；不填按 0 记 |
| `AI_FREE_DAY` / `AI_FREE_MONTH` | 否 | 免费额度，默认每天 30 次、每月 300 次 |
| `AI_SUB_DAY` / `AI_SUB_MONTH` | 否 | 订阅额度，默认每天 200 次、每月 4000 次（第一版没有支付，只给手动开通的人） |
| `AI_LIGHT_DAY` | 否 | 自动总结和翻译每天的次数，默认 60，不占主额度 |
| `AI_MAX_TOKENS` | 否 | 单次最多输出，默认 4000 |
| `AI_ALLOW_ORIGIN` | 否 | 允许的来源，逗号分隔，例如 `https://pawsey0319.github.io,https://localhost`；不填时只靠云开发的“安全来源” |
| `AI_INVITE_ONLY` | 否 | 填 `1` 时只有 `ai_entitlements` 里有记录的人能用（内测用） |
| `AI_USAGE_OPT` | 否 | 默认 `1`：请求里带 `stream_options.include_usage`。接口不认这个参数时填 `0` |

4. HTTP 路由：在控制台的独立「HTTP 网关 → 路由管理」页面添加路由，触发路径 `/lh-ai`，关联 HTTP 云函数 `lh-ai`。本环境已使用默认域名，路由指向 `$LATEST`。
   - 函数已通过 `AI_ALLOW_ORIGIN` 处理跨域，**此路由的网关跨域设置关闭**，否则可能返回重复的 `Access-Control-Allow-Origin`，导致浏览器拒绝响应。不要因此关闭整个环境的鉴权或放宽数据库权限。
5. 网站：`config.json` 同时配置 `"aiFunction": "lh-ai"` 与 `"aiUrl": "https://完整域名/lh-ai"`。本环境使用：
   `https://studyingloop-d4gve2bc779a7d0ea-1396624416.ap-shanghai.app.tcloudbase.com/lh-ai`。
   配置随网页发布后，“AI 服务”才会出现“平台模型”；现有用户选择的自带 Key 服务商不会自动切换。
   原 `/v1/functions/lh-ai?webfn=true` 入口在此次公开 Key 探测中被网关拒绝，不能据此假设 HTTP 函数代码不可用，应以配置后的 HTTP 路由实测为准。

### 图片能力与部署边界

- 额度查询的同一个 GET 入口返回 `visionModels`，内容为 `AI_VISION_MODELS` 与 `AI_MODELS` 的交集；Anthropic 格式始终返回空数组。前端应以该字段判断平台图片能力，旧部署缺失字段也视为不支持。
- DeepSeek 图片接入需管理员确认上游实际能力后，手动设置 `AI_MODELS=deepseek-flash`、`AI_VISION_MODELS=deepseek-flash`、`AI_FORMAT=openai` 及既有 `AI_BASE`/`AI_KEY`。只改源码或 README **不会自动发布云函数或更新生产变量**；本次不执行部署、不改凭据、不自动扩大测试费用。
- 只允许白名单模型的 `user.content` 为 `text` / `image_url` 数组。图片 URL 只能是内联 `data:image/png|jpeg|webp|gif;base64,...`，严格校验规范 base64、MIME 对应魔数/基础头部（非完整图像解码）。拒绝远程 URL、音频、未知块/字段及非 user 图片，不静默丢弃附件。可选 `image_url.detail` 仅允许 `auto`/`low`/`high`。
- 图片每张最多 2MiB，所有消息共最多 4 张、总计 6MiB。文字预算仍为全部字符串及 text 块合计 200000 字符，**不含 base64**；超过时整次拒绝，不截断。启用视觉时 HTTP 读取上限约 9.3MiB（6MiB 媒体的 base64 + 文字最坏 JSON 转义 + 64KiB 包装），未配置时维持原 1000000 字节。部署网关也须允许对应请求体，否则网关会提前拒绝，不能仅放大函数额度或文字限制来解决。
- 登录/邀请校验不变，所有正文/媒体校验在 `ai_take` 扣额前；上游失败仍退款。原有纯文本 OpenAI/Anthropic 请求保持兼容；图片原始内容不写日志或落盘。缺少上游 token 用量时仅估算文字 token，图片成本不能据此宣称准确。
- 本地协议回归：`node --test tests/n12.test.js`（假上游验证完整内联图片转发、拒绝不扣额、旧文本与退款，不代表真实 API 能力/质量验收）。

### 两类 Key 与故障定位

- 自带 Key：保存在本机设置中，浏览器直接访问服务商。
- 平台 Key：环境变量 `AI_KEY`，由云函数访问服务商。修改其中一处不会同步到另一处；换 Key 不需要新建函数。
- 数据库 `forbidden`：优先核对同一环境中的 `ai_secret.secret` 与 `AI_DB_SECRET` 是否完全一致，不要放开权限绕过。
- 上游 401 `invalid key`：核对 `AI_KEY` 是否为真实的模型 API Key，不是请求编号、登录密码或其他平台凭据。不要在聊天、日志或仓库中输出 Key。
- 已验证：2026-11-09 真实账号额度 GET 返回 200；模型 POST 返回 200；两次模型测试后日/月计数为 2；自带 Key 直连经用户更正 Key 后恢复。最终 Agent 页面正文与上线验收仍需另做。

### 内部测试注销后的数据清理

账号删除接口会删除账号及应用数据，但 `ai_usage` / `ai_entitlements` 没有开放给浏览器删除权限。内部测试期间由管理员在 PostgreSQL 控制台按已注销用户 ID 清理：

```sql
-- 先确认，再执行；不要把结果或用户 ID 发到公开聊天
select * from public.ai_usage where user_id = '<已注销用户 ID>';
select * from public.ai_entitlements where user_id = '<已注销用户 ID>';
delete from public.ai_usage where user_id = '<已注销用户 ID>';
delete from public.ai_entitlements where user_id = '<已注销用户 ID>';
```

正式公开前应将这项清理做成服务端注销事务/后台保留期限任务，并由法务确定保存期限；当前版本不把管理员权限放进网页。

## 自测

```bash
# 换成你自己登录后的 access_token（浏览器开发者工具 → Application → Local Storage → learning-hub.cloud 里的 access）
curl -s "https://studyingloop-d4gve2bc779a7d0ea-1396624416.ap-shanghai.app.tcloudbase.com/lh-ai" -H "x-user-token: <access_token>" -H "authorization: Bearer <access_token>"
# 应该返回 {"models":[...],"plan":"free","day":0,...}
```

## 看用量和成本

在 SQL 编辑器里执行第 11 段末尾注释里的查询语句。日志里只有匿名编号、功能、token 数和耗时，没有对话内容。
