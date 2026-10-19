/* 板块三：智能体 */
HUB.track({
  id: 'agent', name: '智能体', short: '智能体', color: '#B4521E', hours: 3,
  goal: '能设计、搭建、评估一个生产可用的 Agent，并理解协议生态（MCP / A2A / Skills）与商业模式。',
  live: { hf: 'LLM agent tool use benchmark', hn: 'AI agent', gh: 'ai-agent' },
  stages: [
    {
      t: 'Agent 基本范式', w: [1, 4],
      goal: '弄懂 Agent = 模型 + 工具 + 循环 + 记忆，能区分“工作流”和“自主智能体”。',
      tech: [
        '精读 ReAct、Toolformer、Reflexion 三篇论文',
        '不用框架，用 50 行 Python + 一个模型 API 手写 ReAct 循环（能调搜索、计算器两个工具）',
        '学完 Hugging Face Agents Course 第 1–2 单元'
      ],
      prod: [
        '精读 Anthropic《Building Effective Agents》，把五种工作流模式（链式、路由、并行、编排者-工作者、评估-优化）各配一个业务例子',
        '复盘你的 Dumate-Agent 项目：它属于哪种模式？为什么这样选？'
      ],
      res: [
        ['ReAct 论文', 'https://arxiv.org/abs/2210.03629'],
        ['Toolformer 论文', 'https://arxiv.org/abs/2302.04761'],
        ['Reflexion 论文', 'https://arxiv.org/abs/2303.11366'],
        ['Generative Agents（斯坦福小镇）', 'https://arxiv.org/abs/2304.03442'],
        ['Anthropic: Building Effective Agents', 'https://www.anthropic.com/engineering/building-effective-agents'],
        ['Lilian Weng: LLM Powered Autonomous Agents', 'https://lilianweng.github.io/posts/2023-06-23-agent/'],
        ['Hugging Face Agents Course', 'https://huggingface.co/learn/agents-course'],
        ['Datawhale hello-agents（中文）', 'https://github.com/datawhalechina/hello-agents'],
        ['Microsoft AI Agents for Beginners', 'https://github.com/microsoft/ai-agents-for-beginners']
      ],
      out: '手写 ReAct 脚本 + 五种模式业务对照表'
    },
    {
      t: '工具、上下文与协议：MCP / A2A / Skills', w: [5, 9],
      goal: '掌握让 Agent 接入真实世界的三件事：写好工具、管好上下文、用标准协议连接。',
      tech: [
        '读 MCP 官方文档，写一个自己的 MCP Server（如读取本地笔记或查询行情）',
        '读 A2A 协议，理解 Agent 与 Agent 之间如何发现、委派、回传结果',
        '读 Anthropic 关于工具设计、上下文工程、Agent Skills 的三篇工程文章，并给自己的 Agent 写一个 Skill'
      ],
      prod: [
        '画 2026 年 Agent 协议栈图：MCP（连工具）、A2A（连 Agent）、AG-UI（连界面）、支付协议',
        '分析“网站开始屏蔽 AI Agent”这件事对 Agent 产品的影响，以及可能的商业对策'
      ],
      res: [
        ['Model Context Protocol', 'https://modelcontextprotocol.io/'],
        ['A2A Protocol', 'https://a2a-protocol.org/'],
        ['Anthropic: Writing tools for agents', 'https://www.anthropic.com/engineering/writing-tools-for-agents'],
        ['Anthropic: Effective context engineering', 'https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents'],
        ['Anthropic: Agent Skills', 'https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills'],
        ['anthropics/skills 示例', 'https://github.com/anthropics/skills'],
        ['AGENTS.md 规范', 'https://agents.md/'],
        ['2026 Agent 协议栈综述', 'https://dev.to/alexmercedcoder/the-state-of-agentic-ai-standards-in-2026-mcp-a2a-webmcp-osi-and-the-protocol-stack-taking-3o2l'],
        ['MCP vs A2A（2026）', 'https://beam.ai/agentic-insights/agent2agent-vs-mcp-2026-ai-agent-stack'],
        ['The Verge: 网站开始屏蔽 AI Agent（2026-10）', 'https://www.theverge.com/ai-artificial-intelligence/1013195/ai-agents-blocked-web']
      ],
      out: '自写 MCP Server + 一个 Skill + 协议栈图'
    },
    {
      t: '框架与多智能体', w: [10, 15],
      goal: '会用至少一个主流框架搭有状态的 Agent，知道多智能体什么时候值得用、什么时候是过度设计。',
      tech: [
        '用 LangGraph 实现一个带状态、可中断、可人工审批的业务 Agent',
        '对比 OpenAI Agents SDK、Claude Agent SDK、smolagents、PydanticAI 的设计取舍（各跑通一个 Demo）',
        '用 mem0 给 Agent 加长期记忆，观察记忆写入的错误类型'
      ],
      prod: [
        '读《12-Factor Agents》，对照检查你的 Agent 是否符合生产原则',
        '用 Dify 或扣子（Coze）10 分钟搭一个零代码 Agent，对比代码方案的效率与上限，总结低代码平台的适用边界'
      ],
      res: [
        ['LangGraph', 'https://github.com/langchain-ai/langgraph'],
        ['OpenAI Agents SDK', 'https://github.com/openai/openai-agents-python'],
        ['Claude Agent SDK', 'https://docs.claude.com/en/api/agent-sdk/overview'],
        ['smolagents', 'https://github.com/huggingface/smolagents'],
        ['PydanticAI', 'https://github.com/pydantic/pydantic-ai'],
        ['CrewAI', 'https://github.com/crewAIInc/crewAI'],
        ['AutoGen', 'https://github.com/microsoft/autogen'],
        ['Qwen-Agent', 'https://github.com/QwenLM/Qwen-Agent'],
        ['mem0（记忆层）', 'https://github.com/mem0ai/mem0'],
        ['12-Factor Agents', 'https://github.com/humanlayer/12-factor-agents'],
        ['Dify', 'https://github.com/langgenius/dify'],
        ['扣子 Coze', 'https://www.coze.cn/'],
        ['LangChain Academy（需在浏览器打开）', 'https://academy.langchain.com/']
      ],
      out: '一个 LangGraph 业务 Agent + 框架对比笔记'
    },
    {
      t: '编程 Agent、浏览器与 Computer Use', w: [16, 20],
      goal: '理解最赚钱、进展最快的两类 Agent：写代码的 Agent 和操作电脑的 Agent。',
      tech: [
        '日常使用一款编程 Agent（Claude Code / Codex / Gemini CLI 任选），记录哪些任务能完全交付',
        '用 browser-use 做一个自动填表或比价的浏览器 Agent',
        '读 OpenGCUA、MAI-Gym 两篇 2026-10 新论文，了解 GUI Agent 如何用 RL 训练'
      ],
      prod: [
        '做一份“编程 Agent 对产品经理工作的影响”分析：原型、数据分析、文档，哪些环节可以自己完成',
        '设计 Computer Use 产品的安全与权限方案：哪些操作必须人工确认'
      ],
      res: [
        ['OpenAI Codex CLI', 'https://github.com/openai/codex'],
        ['Gemini CLI', 'https://github.com/google-gemini/gemini-cli'],
        ['OpenHands', 'https://github.com/OpenHands/OpenHands'],
        ['browser-use', 'https://github.com/browser-use/browser-use'],
        ['OpenGCUA（开放通用 Computer Use 栈）', 'https://huggingface.co/papers/2610.22200'],
        ['MAI-Gym（GUI Agent 评估与 RL 训练）', 'https://huggingface.co/papers/2610.20939'],
        ['awesome-llm-apps', 'https://github.com/Shubhamsaboo/awesome-llm-apps']
      ],
      out: '浏览器 Agent Demo + PM 工作流改造报告'
    },
    {
      t: '评估、可观测与上线', w: [21, 26],
      goal: 'Agent 的难点在可靠性。学会用基准、轨迹评估和监控把 Agent 推到生产环境。',
      tech: [
        '了解 SWE-bench、τ-bench、GAIA、OSWorld 四个基准分别测什么',
        '用 Langfuse 接入自己的 Agent，记录每一步轨迹、成本、失败点',
        '为业务 Agent 建一个 50 条的任务评估集，计算任务成功率与每次成功的成本'
      ],
      prod: [
        '读 FDE-Gym（2026-10）：Agent 在“需求模糊、约束未说明”的真实交付中表现大幅下降。据此写出 Agent 产品的“需求澄清”设计',
        '写一份 Agent 上线 checklist：权限、兜底、人工接管、计费、监控指标',
        '把整个板块成果整理成作品集，对外讲一个完整的 Agent 产品故事'
      ],
      res: [
        ['SWE-bench', 'https://www.swebench.com/'],
        ['τ-bench', 'https://github.com/sierra-research/tau-bench'],
        ['GAIA 论文', 'https://arxiv.org/abs/2311.12983'],
        ['OSWorld', 'https://os-world.github.io/'],
        ['Langfuse', 'https://github.com/langfuse/langfuse'],
        ['FDE-Gym: The Last Mile of AI Delivery', 'https://huggingface.co/papers/2610.22350'],
        ['Berkeley Agentic AI 课程', 'https://rdi.berkeley.edu/agentic-ai/f25'],
        ['Anthropic《2026 State of AI Agents》报告（PDF）', 'https://resources.anthropic.com/hubfs/The%202026%20State%20of%20AI%20Agents%20Report.pdf']
      ],
      out: 'Agent 评估集 + 上线 checklist + 作品集'
    }
  ],
  frontier: [
    { t: 'Agentic RL 与环境合成', d: '前沿竞争从“提示词”转向“训练环境”：用可验证的环境做强化学习，训出长程任务能力。', l: [['SERO：长程 Agentic RL', 'https://huggingface.co/papers/2610.19397'], ['Cowork-Gym', 'https://huggingface.co/papers/2610.17670'], ['MLExpert：自主 ML 工程 Agent', 'https://huggingface.co/papers/2610.22344']] },
    { t: 'Computer Use 走向开放', d: 'OpenGCUA、MAI-Gym 等开放栈让 9B 级模型也能做 GUI 操作，成本大幅下降。', l: [['OpenGCUA', 'https://huggingface.co/papers/2610.22200']] },
    { t: '协议栈成形', d: 'A2A 到 2026 年 4 月已有 150 多家组织支持，MCP 成为工具接入事实标准，WebMCP、AG-UI、Agent 支付协议正在补齐。', l: [['2026 Agent 协议栈', 'https://dev.to/alexmercedcoder/the-state-of-agentic-ai-standards-in-2026-mcp-a2a-webmcp-osi-and-the-protocol-stack-taking-3o2l']] },
    { t: '开放网络 vs Agent', d: '越来越多网站屏蔽 AI Agent 访问，授权访问、付费 API 与 Agent 身份认证会成为新的基础设施。', l: [['The Verge 2026-10', 'https://www.theverge.com/ai-artificial-intelligence/1013195/ai-agents-blocked-web']] },
    { t: '治理缺口', d: '多数企业计划规模化部署 Agent，但只有约 21% 拥有成熟的治理模型，监控、审计与权限是机会点。', l: [['企业 Agent 使用报告', 'https://www.moderndata101.com/reports/how-enterprises-are-using-ai-agents']] }
  ],
  biz: {
    fresh: [
      { t: '垂直行业 Agent', d: 'Agentforce 约 18 个月做到 12 亿美元 ARR，证明“嵌入工作流 + 按结果收费”可行。垂直机会：税务、报关、招投标、医保审核。', l: [['AI Agent 市场趋势', 'https://www.precedenceresearch.com/insights/ai-agent-market-trends-key-players-report']] },
      { t: 'Agent 基础设施', d: '可观测、评估、权限、沙箱、Agent 身份与支付。企业治理缺口大，这里是“卖铲子”的机会。' },
      { t: '一人公司工具链', d: '编程 Agent + 浏览器 Agent 让个人能完成以前一个团队的工作，面向超级个体的工具和服务正在兴起。' }
    ],
    old: [
      { t: 'RPA 升级', d: '传统 RPA 脚本脆弱，Computer Use Agent 能处理界面变化与非结构化输入。存量 RPA 客户是现成的升级市场。' },
      { t: 'SaaS 加 Agent', d: '老 SaaS 从“卖席位”转向“卖完成的任务”。销售 CRM 里的商机评估 Agent 就是典型（参考 Dumate-Agent）。', l: [['Dumate-Agent', 'https://github.com/yangqxuan-work/Dumate-Agent']] },
      { t: '外包与 BPO', d: '客服、数据标注、财务外包公司用 Agent 改造交付，利润率提升最直接。' }
    ]
  }
});
