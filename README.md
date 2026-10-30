# 学习路线

个人学习路线网站：AI 大模型、单领域小模型、智能体、量化四个板块，26 周计划，含学习资源、实时动态和经过核验的精选资讯。

网址：https://pawsey0319.github.io/studying-roadmap/

- 路线数据：`content/tracks/*.json`（每个阶段、任务有固定 ID）
- 精选资讯：`content/feed.json`（每条带来源与可信度等级）
- 网页代码：`src/`（原生 ES 模块，无需构建）；测试：`node --test tests/*.test.js`
- 本地预览：仓库目录运行 `python3 -m http.server`，打开 http://localhost:8000/
- 官方博客与媒体快照：GitHub Actions 每天北京时间 8 点运行 `tools/fetch_sources.py` 生成，不进仓库
- 进度与笔记：保存在浏览器里，可在页面底部设置用私有 Gist 在多台设备间同步
- 发布本地改动：`bash tools/publish.sh "说明"`
- 每周资讯更新与换电脑的步骤：见 [UPDATE.md](UPDATE.md)，任何电脑上的任何 AI 助手都能照着执行
