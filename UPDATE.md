# 维护说明（给人和 AI 助手看）

这个仓库是一个持续学习网站，发布在 https://pawsey0319.github.io/studying-roadmap/ 。
日常更新全部在 GitHub Actions 上自动运行，不依赖任何电脑。只有手动补跑、改内容、换电脑时才需要照本文件操作；在哪台电脑、用哪个 AI 助手都可以。

## 网站是什么

- 默认四个方向：`llm` AI 大模型、`slm` 单领域小模型、`agent` 智能体、`quant` 量化（指个人量化投资/交易，不是模型量化）。用户可以在网站上隐藏方向、导入或让 Agent 起草新方向，这些只存在用户自己的数据里。
- 每个方向有两种路线：
  - 理论路线：按内容的先后逻辑排列，没有周次。每个阶段同时有理论任务（`mode: "theory"`）和实践验证（`mode: "practice"`），至少各一个。
  - 前沿路线：从资讯里自动整理出来的话题，和理论路线并行，从某个理论阶段“分出”（`from`）。
- 个人调整（跳过、改写、新增、已掌握）只存在用户的个人层里，不改公共路线文件；用户随时能恢复原版。

## 文件结构

- `content/tracks/*.json`：理论路线。每个阶段、任务、资源都有固定 ID（阶段 `agent.s02`、任务 `agent.s02.i03`、资源 `agent.s02.r01`），用户进度和个人调整按 ID 记录。**已有 ID 不能改、不能复用**；新增条目用这个阶段下一个没用过的编号。资源优先给链接，没有链接的只写名称。
- `content/routes.json`：前沿路线。字段：`id`（如 `agent.r03`）、`track`、`title`、`from`（分出的理论阶段）、`desc`、`kw`（关键词：英文按词边界匹配，中文直接包含，`/正则/` 当正则）、`status`（`active`/`merged`，合并时写 `into`）、`learn`（跟踪学习清单，ID 如 `agent.r03.l01`）。每周自动精修。
- `content/feed.json`：精选资讯与论文。`ai: true` 表示每周由免费模型整理（网站上标“AI 整理”），没有这个字段的是人工核验过的。
- `content/suggestions.json`：每周自动生成的“待确认建议”，用户在网站上点“应用”才改他自己的路线。
- `content/biz.json`：落地与商机（`kind: new|old`）。
- `content/domains.json`：知识领域和它包含的方向。`content/legacy-v1.json`：v1 旧进度 ID 对照表，只用于迁移，不要改。
- `data/sources.json`：官方博客、媒体、arXiv、项目 Release、AI 资讯日报的快照，每天自动生成，不进仓库。
- `data/community.json`：Reddit 与 Hacker News 社区讨论，每周自动生成并提交。
- `src/`：网页代码（浏览器原生 ES 模块，无需构建）。`src/core/` 纯逻辑，`src/store/` 个人数据（IndexedDB；同步走 `backend.js` 适配的腾讯云开发 CloudBase 或 Supabase，备用 Gist），`src/ai/` 学习 Agent 和向量检索，`src/import/` 文档导入，`src/ui/` 界面，`src/native.js` 安卓 App 专用的适配。
  - v3 新增的纯逻辑：`core/mastery.js` 自测掌握度，`core/method.js` 学习方法档案（含证据约束、撤销），`core/anki.js` Anki 导出，`core/ctxpack.js` 导出给其他 AI（工具配置表、拆段），`core/public.js` 公共区域快照与采用，`core/graph.js` 知识树。参考了 DeepTutor 和 mem0 的算法思路，见 `NOTICE`。
- `vendor/`：pdf.js 和 mammoth（解析 PDF、Word）、Cytoscape.js（知识树），许可证在同目录。
- `cloudbase/schema.sql`：腾讯云开发 PostgreSQL 的表、权限和触发器（第 1–9 段，重复执行没关系）。`app/`：安卓 App 外壳（Capacitor 8），见 `app/README.md`。
- `tests/`：单元测试，`node --test tests/*.test.js`。
- `tools/fetch_sources.py`：每日快照。`tools/weekly.py`：每周整理。`tools/fetch_community.py`：只抓社区讨论。`tools/publish.sh`：提交并推送。
- `supabase/schema.sql`：内测云端的数据库表和权限。`config.json`（可选）：云端公开配置，格式见 `config.example.json`。
- 本地预览：在仓库根目录运行 `python3 -m http.server`（Windows 用 `python -m http.server`），打开 http://localhost:8000/ 。不能直接双击 index.html。

## 自动运行的任务

| 什么时候 | 工作流 | 做什么 |
|---|---|---|
| 每次推送到 main、每天北京时间 8 点 | `.github/workflows/pages.yml` | 跑测试 → 抓每日快照（含 AI 资讯日报）→ 访问一次云端数据库防暂停 → 部署 |
| 每 2 小时 | `.github/workflows/news.yml` | 抓财经快讯和海外源，配置了 Secrets 时写进腾讯云开发的 `hot_items`、`news_items`（App 和网页打开就能读到，不用等部署） |
| 手动运行或推送 `v*` 标签 | `.github/workflows/android.yml` | 打出签名的安卓 APK，标签时发布到 Releases |
| 每周一北京时间 9 点 | `.github/workflows/weekly.yml` | 抓社区讨论 → 核验候选链接 → 免费模型写精选、精修前沿路线、生成待确认建议 → 跑测试 → 提交 → 触发部署。失败时开一个 `weekly-failed` issue，网站保留上周内容 |

每周任务需要仓库 Secrets 里至少有一个模型 Key，按顺序轮换：`MODELSCOPE_KEY`（魔搭，首选，可用 `MODELSCOPE_MODEL` 改模型，逗号分隔多个）→ `SILICONFLOW_KEY` → `ZHIPU_KEY` → `LLM_BASE` + `LLM_KEY` + `LLM_MODEL`（聚合接口用这一组：`LLM_BASE` 填到 `/v1` 为止，`LLM_MODEL` 可以写多个模型、逗号分隔，按顺序备用）。
可选 `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`：读取内测用户对 AI 整理条目的“分错了”标记，被标记的条目下架，并作为反例告诉模型。

每日快照还包括经转载服务获取的二手来源，条目都带 `via` 字段：微信公众号（wechat2rss.bestblogs.dev）、X 账号（api.xgo.ing）、BestBlogs 高分精选。这些服务可能停掉，单个源失败不影响其他源。

每日快照里的 AI 资讯日报（hex2077.dev）是二手聚合：每条按它引用的原始链接的域名定可信度，标“经 AI 资讯日报”，只存标题、原始链接和一句摘要。

## 公司内网模型（当前用法）

模型接口在公司内网，GitHub Actions 连不上，所以每周任务分两段：

1. **每周一，云端采集**：`weekly.yml` 运行 `weekly.py --stage auto`，抓社区讨论、核验候选链接，写出 `data/weekly-candidates.json` 并提交。连不上模型接口时到这里就停，任务显示成功，不开失败 issue。
2. **公司电脑，整理**：运行 `bash tools/weekly_local.sh`。它会拉取最新仓库，用内网模型整理精选、精修前沿路线、生成待确认建议，跑测试后推送，网站自动重新部署。同一周的候选只整理一次，所以可以每天跑，没有新候选时几秒就结束。

第一次在公司电脑上配置（只需两步）：

1. 终端运行 `bash ~/Desktop/学习/learning-hub/tools/setup_local.sh`。它会建好配置文件 `~/.config/learning-hub/llm.env`（在仓库之外、权限 600、不会被提交），并装一个每天 10:30 自动运行 `weekly_local.sh` 的定时任务（launchd，睡眠错过会在唤醒后补跑）。
2. 运行 `open -e ~/.config/learning-hub/llm.env`，把三处“在这里填…”换成内网地址、Key、模型名，保存后再运行一次第 1 步的命令，它会测试模型接口能不能用。

之后不用管：每周一云端采集候选，这台电脑当天（或之后第一次开机连上内网时）整理并推送。没连内网的那天会跳过，候选超过 10 天就等下周。运行记录在 `~/.config/learning-hub/weekly.log`。卸载定时任务：`bash tools/setup_local.sh --uninstall`。想马上跑一次：`bash tools/weekly_local.sh`；只测试接口：`python3 tools/weekly.py --stage ping`。

学习 Agent 也可以用内网模型：在公司电脑的网站设置 → AI 服务 → 自定义，填同一个地址、Key、模型名（只存在这台电脑的浏览器里）。

以后换成公网能访问的接口（独立产品）时，不用改代码：把 Key 填进仓库 Secrets（`LLM_BASE`/`LLM_KEY`/`LLM_MODEL` 或 `MODELSCOPE_KEY` 等），云端那一段会自动接着整理，`weekly_local.sh` 就不用再跑了。

## 手动补跑每周更新（自动任务失败、或想立刻更新时）

开始前先 `git pull`。

1. 有免费模型 Key 时（推荐）：
   - `python3 tools/fetch_sources.py`
   - 设置环境变量后运行 `python3 tools/weekly.py`，例如 macOS/Linux：`MODELSCOPE_KEY=你的Key python3 tools/weekly.py`。Key 只在这次命令里用，不要写进任何文件。
   - 加 `--dry-run` 只看结果不写文件；`--skip-community` 跳过 Reddit/HN。
2. 没有 Key、由 AI 助手手动整理时：按下面“精选资讯规则”往 `content/feed.json` 里加条目（不加 `ai` 字段），每个方向 4–6 条。
3. 对理论路线的修改不要直接改 `content/tracks/*.json`，写进 `content/suggestions.json`，格式：
   `{"id":"w20261109-agent-1","track":"agent","stage":"agent.s02","title":"一句话","why":"原因","ops":[{"op":"edit","id":"agent.s02.i03","text":"改写后"},{"op":"add","text":"新任务","mode":"practice"},{"op":"res","name":"资源名","url":"https://..."}],"at":"2026-11-09"}`
4. 运行 `node --test tests/*.test.js`，报错必须修好。
5. 发布：`bash tools/publish.sh "每周更新 YYYY-MM-DD"`；没有 bash 时：`git add -A` → `git commit -m "..."` → `git pull --rebase origin main` → `git push origin main`。不要 `--force`，不要改 git 配置，不要提交令牌文件。推送失败时停下来告诉用户原因。

最后给出简短总结：每个方向新增几条、最值得看的一条（附链接）、前沿路线的变化、提出了哪些待确认建议、是否已发布。

## 精选资讯规则

- 条目格式：`{"d":"YYYY-MM-DD","k":"llm|slm|agent|quant","type":"news|paper|dir|biz","t":"中文标题","s":"一句中文说明，30–60 字，点出对产品或落地的意义","u":"https://原始链接","src":"来源名称","lvl":"A|B","r":["可选：前沿路线 ID"]}`。这是 JSON：键和字符串都用英文双引号。
- `lvl: "A"` 一手来源：官方博客/新闻稿/文档更新日志、官方 GitHub Release、arXiv 或期刊论文、Hugging Face 官方页、政府与监管机构原文（证监会、交易所、中证协、SEC、FINRA、欧盟委员会等）。
- `lvl: "B"` 权威媒体与机构：Reuters、Bloomberg、FT、WSJ、CNBC、TechCrunch、The Verge、Ars Technica、MIT Technology Review、The Information、财新、第一财经、证券时报、中国证券报、上海证券报、36氪、机器之心、量子位、Epoch AI、Stanford HAI，以及 Simon Willison、Interconnects 等知名研究者博客。
- 不要用：内容农场、SEO 评测与排行站、转载站、论坛帖、加密货币站、无署名聚合站、营销软文。有一手来源时给一手链接。
- 每条都打开原文核对：链接能打开、日期正确、描述与原文一致。拿不准就不收录，不编造日期、数字或产品名。
- 量化方向重点关注个人量化：A 股和期货的交易与程序化交易规则、证监会与交易所公告、券商 QMT/PTrade、开源量化工具（Qlib、RD-Agent、vn.py、AKShare、TradingAgents 等）的正式版本、LLM/Agent 用于投研的论文。
- 每个方向最多保留 45 条，超出时删最旧的；交易所与监管规则类的 `news` 条目保留。

## 腾讯云开发（v3 的后端）

- 网页继续放在 GitHub Pages，数据和登录在腾讯云开发（环境 `studyingloop-d4gve2bc779a7d0ea`，上海，PostgreSQL）。`config.json` 里的 `cloudbaseKey` 是公开的 Publishable Key，可以提交。
- 管理员密钥（服务端 API Key）只放在 GitHub Secrets：`CLOUDBASE_ENV`、`CLOUDBASE_API_KEY`，给 `news.yml` 写资讯表用。不要放进仓库或网页。
- 改了 `cloudbase/schema.sql` 后，在控制台 → 数据库 → SQL 编辑器里重新执行新增的那几段。
- 公共区域的举报在 `reports` 表里，只能在控制台看；下架某条内容：把 `public_items.status` 改成 `removed`。
- 向量检索（对话纪要按意思查找）：用户在网站设置里填向量模型的 Key（默认硅基流动的 BAAI/bge-m3），只存在本设备。

## 内测（Supabase 云端账号，备用）

见 [内测说明.md](内测说明.md)：创建 Supabase 项目、运行 `supabase/schema.sql`、关闭公开注册、邀请测试用户、填 `config.json`、部署模型代理 `supabase/functions/ai`（内测用户用管理员的模型，Key 只存在 Supabase 函数密钥里）。

## 换到一台新电脑

1. `git clone https://github.com/pawsey0319/studying-roadmap.git`
   Windows：先装 Git for Windows，第一次 `git push` 时会弹出浏览器登录 GitHub。Windows 上的 Python 命令通常是 `python` 或 `py`。
2. macOS/Linux 需要脚本推送时，可以建一个细粒度令牌（仓库只选 studying-roadmap，Contents 和 Workflows 给 Read and write），存成仓库根目录的 `.deploy-token`（已在 .gitignore 中）。也可以直接用这台电脑已登录的 git 凭据。
3. 每周更新已经在云端自动运行，新电脑上不需要建定时任务。
4. 换掉旧电脑时，删除旧电脑上的 `.deploy-token`，并在 GitHub 设置里吊销旧令牌。

公用或别人的电脑上不要存 `.deploy-token`，也不要在网站里填 AI Key 或同步令牌。
