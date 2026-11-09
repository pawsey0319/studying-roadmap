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
| `AI_FORMAT` | 否 | 接口是 Anthropic 格式时填 `anthropic` |
| `AI_PRICES` | 否 | 成本单价，JSON，单位“元 / 百万 token”，例如 `{"deepseek-chat":[2,8]}`；不填按 0 记 |
| `AI_FREE_DAY` / `AI_FREE_MONTH` | 否 | 免费额度，默认每天 30 次、每月 300 次 |
| `AI_SUB_DAY` / `AI_SUB_MONTH` | 否 | 订阅额度，默认每天 200 次、每月 4000 次（第一版没有支付，只给手动开通的人） |
| `AI_LIGHT_DAY` | 否 | 自动总结和翻译每天的次数，默认 60，不占主额度 |
| `AI_MAX_TOKENS` | 否 | 单次最多输出，默认 4000 |
| `AI_ALLOW_ORIGIN` | 否 | 允许的来源，逗号分隔，例如 `https://pawsey0319.github.io,https://localhost`；不填时只靠云开发的“安全来源” |
| `AI_INVITE_ONLY` | 否 | 填 `1` 时只有 `ai_entitlements` 里有记录的人能用（内测用） |
| `AI_USAGE_OPT` | 否 | 默认 `1`：请求里带 `stream_options.include_usage`。接口不认这个参数时填 `0` |

4. 网站：`config.json` 加一行 `"aiFunction": "lh-ai"`，推送后网站和 App 的“AI 服务”里就会出现“平台模型”。
   如果网关地址 `https://<环境ID>.api.tcloudbasegateway.com/v1/functions/lh-ai?webfn=true` 调不通，
   在控制台 → HTTP 访问服务里给函数配一个路径，再加一行 `"aiUrl": "https://完整地址"`。

## 自测

```bash
# 换成你自己登录后的 access_token（浏览器开发者工具 → Application → Local Storage → learning-hub.cloud 里的 access）
curl -s "https://<环境ID>.api.tcloudbasegateway.com/v1/functions/lh-ai?webfn=true" -H "x-user-token: <access_token>" -H "authorization: Bearer <access_token>"
# 应该返回 {"models":[...],"plan":"free","day":0,...}
```

## 看用量和成本

在 SQL 编辑器里执行第 11 段末尾注释里的查询语句。日志里只有匿名编号、功能、token 数和耗时，没有对话内容。
