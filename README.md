# 学习路线

一个持续学习网站：理论路线打基础，前沿路线跟着资讯自动生长，配经过核验的资讯、笔记和个人学习 Agent。默认四个方向：AI 大模型、单领域小模型、智能体、量化（个人量化投资/交易），方向可以自己增减。

网址：https://pawsey0319.github.io/studying-roadmap/ （电脑和手机都能用，手机可添加到主屏幕）

- 理论路线：`content/tracks/*.json`，按内容顺序排列，每个阶段有理论任务和实践验证；前沿路线：`content/routes.json`
- 精选资讯：`content/feed.json`（每条带来源与可信度等级，`ai: true` 为每周自动整理）；待确认建议：`content/suggestions.json`；落地与商机：`content/biz.json`
- 网页代码：`src/`（原生 ES 模块，无需构建）；测试：`node --test tests/*.test.js`
- 本地预览：仓库目录运行 `python3 -m http.server`，打开 http://localhost:8000/
- 每天北京时间 8 点自动抓官方博客、媒体、arXiv、项目 Release 和 AI 资讯日报（`tools/fetch_sources.py`）并部署
- 每周一北京时间 9 点自动整理精选、精修前沿路线、生成待确认建议（`tools/weekly.py`，用免费模型，Key 放在仓库 Secrets）
- 个人数据存在浏览器里（IndexedDB）；登录腾讯云开发（邮箱验证码）后多设备同步，备用 Gist
- 学习 Agent：自测与掌握度、学习方法档案、对话纪要、学习日志、导出 Anki；“导出给 AI”把背景整理成 ChatGPT、Claude Code（CLAUDE.md / AGENTS.md / SKILL.md）、v0、Lovable、秒哒等工具能用的格式
- 公共区域：公开自己的路线和笔记，采用别人的（复制到自己的方向里），作者更新后会提示
- 方向页的“知识树”：阶段、前沿路线、资讯和笔记的关系图
- 安卓 App：`app/`（Capacitor 8），GitHub Actions 自动出签名 APK
- 学习 Agent 的模型 Key 只存在本设备，推荐免费的魔搭 ModelScope
- 维护、手动补跑和换电脑：见 [UPDATE.md](UPDATE.md)
