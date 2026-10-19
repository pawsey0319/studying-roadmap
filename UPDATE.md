# 维护说明（给人和 AI 助手看）

这个仓库是一个个人学习路线网站，发布在 https://pawsey0319.github.io/studying-roadmap/ 。
维护工作不依赖任何特定电脑或 AI 账号：在哪台电脑、用哪个 AI 助手（Claude、Codex、Kiro、Cursor 等）都可以，只要按本文件操作。

## 网站是什么

- 四个板块：`llm` AI 大模型、`slm` 单领域小模型、`agent` 智能体、`quant` 量化（指个人量化投资/交易，不是模型量化）。
- 学习者情况：会基础 Python、懂 Transformer 架构、学过概率论和高等代数，量化零基础；每周约 10 小时，产品与技术各占一半，目标是从产品和技术两个角度跟上前沿，并关注 AI 真正落地的机会、新商机和老商机改造。
- 文件结构：
  - `data/llm.js` `data/slm.js` `data/agent.js` `data/quant.js`：学习路线、前沿方向、商机。资源优先给链接，没有链接的写资源名称。
  - `data/feed.js`：精选资讯与论文，每周更新。
  - `data/sources.js`：官方博客与媒体快照，由 GitHub Actions 每天运行 `tools/fetch_sources.py` 生成，不进仓库。
  - `.github/workflows/pages.yml`：推送后自动部署，并每天北京时间 8 点刷新快照。
  - `.github/workflows/weekly-reminder.yml`：每周一在仓库里开一个提醒 issue。
  - `tools/publish.sh`：提交并推送。

## 每周资讯更新（每周一次，任何电脑都可以做）

开始前先在仓库根目录运行 `git pull`，拿到其他电脑上的最新改动。

1. 读 `data/feed.js`，按链接和标题去重。
2. 收集过去 7 天的内容，每个板块新增 4–6 条，尽量覆盖四类：`news`（重要模型/产品/框架发布、监管变化）、`paper`（重要论文或技术报告）、`dir`（新方向/趋势）、`biz`（落地案例、收入与融资、商业模式）。量化板块重点关注个人量化：A 股和期货的交易与程序化交易规则、证监会与交易所公告、券商 QMT/PTrade、开源量化工具（Qlib、RD-Agent、vn.py、AKShare、TradingAgents 等）的正式版本、LLM/Agent 用于投研的论文。
   线索：运行 `python3 tools/fetch_sources.py` 生成快照后读 `data/sources.js`；`https://huggingface.co/api/daily_papers?limit=100`（按 upvotes 排序）；网页搜索。
3. 来源可信度（最重要）：
   - `lvl: 'A'` 一手来源：官方博客/新闻稿/文档更新日志、官方 GitHub Release、arXiv 或期刊论文、Hugging Face 官方模型页或 Papers 页、政府与监管机构原文（证监会、交易所、中证协、SEC、FINRA、欧盟委员会等）。
   - `lvl: 'B'` 权威媒体与机构：Reuters、Bloomberg、FT、WSJ、CNBC、TechCrunch、The Verge、Ars Technica、MIT Technology Review、The Information、财新、第一财经、证券时报、中国证券报、上海证券报、36氪、机器之心、量子位、Epoch AI、Stanford HAI，以及 Simon Willison、Interconnects 等知名研究者博客。
   - 不要用：内容农场、SEO 评测与排行站、博客园/CSDN/知乎等转载、论坛帖、加密货币站、无署名聚合站、营销软文。有一手来源时给一手链接。
4. 每条都打开原文核对：链接能打开、日期正确、描述与原文一致。拿不准就不收录，不编造日期、数字或产品名。
5. 把新条目插到 `HUB.feed.items` 中对应板块注释（如 `/* ---------- 智能体 ---------- */`）下方的最前面，格式与已有条目一致：
   `{ d: 'YYYY-MM-DD', k: 'llm|slm|agent|quant', type: 'news|paper|dir|biz', t: '中文标题', s: '一句中文说明，30–60 字，点出对产品或落地的意义', u: 'https://原始链接', src: '来源名称', lvl: 'A|B' },`
   字符串里不要出现单引号。把 `updated` 改成当天日期。
6. 每个板块最多保留 45 条，超出时删最旧的，但交易所与监管规则类的 `news` 条目保留。
7. 本周如果有足以改变学习路线的重大变化（关键框架改名、重要新模型或新协议、监管新规），不要直接改路线文件，在总结里给出具体修改建议，由用户决定。
8. 运行 `node --check data/feed.js`，报错必须修好。
9. 发布：`bash tools/publish.sh "每周资讯更新 YYYY-MM-DD"`。不要 `--force`，不要改 git 配置，不要提交令牌文件。推送失败时停下来告诉用户原因。
10. 关闭本周的提醒 issue（如果有权限）。

最后给出简短总结：每个板块新增几条、每个板块最值得看的一条（附链接）、是否已发布、对学习路线的修改建议。

## 换到一台新电脑

1. `git clone https://github.com/pawsey0319/studying-roadmap.git`
2. 需要自动推送时，建一个细粒度令牌：仓库只选 studying-roadmap，权限只给 Contents 读写，存成仓库根目录的 `.deploy-token`（已在 .gitignore 中）。也可以直接用这台电脑已登录的 git 凭据。
3. 想定时自动更新，就在这台电脑的 AI 助手里建一个每周任务，提示词写：
   “进入 <仓库所在路径>，读 UPDATE.md，按其中‘每周资讯更新’一节执行。”
4. 换掉旧电脑时，删除旧电脑上的定时任务和 `.deploy-token`，并在 GitHub 设置里吊销旧令牌。

公用或别人的电脑上不要存 `.deploy-token`，也不要在浏览器里设置多设备同步令牌。
