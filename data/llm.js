/* 板块一：AI 大模型。res 项：[名称, 链接]；没有链接的只写 [名称]。 */
HUB.track({
  id: 'llm', name: 'AI 大模型', short: '大模型', color: '#2F5BD3', hours: 3,
  goal: '从“会用、懂 Transformer”走到能看懂训练/后训练/推理部署的关键取舍，并能把前沿进展翻译成产品判断。',
  live: { hf: 'large language model reasoning', hn: 'LLM', gh: 'llm' },
  stages: [
    {
      t: '从 Transformer 到 GPT：亲手搭一遍', w: [1, 4],
      goal: '把已知的 Transformer 架构变成能跑的代码，同时建立对 token、上下文、价格的产品直觉。',
      tech: [
        '看完 Karpathy《Let\'s build GPT》并逐行复现，跑通 nanoGPT 的 Shakespeare 字符级模型',
        '看《Let\'s build the GPT Tokenizer》，手写一个最小 BPE 分词器',
        '用 3Blue1Brown 第 5–6 集复习注意力机制，补上 Zero to Hero 前几集里不熟的反向传播'
      ],
      prod: [
        '同一个任务（如会议纪要生成）分别跑 3 个主流模型，记录质量、首 token 延迟、单次成本',
        '读 Artificial Analysis 的价格/速度榜，搞清楚“输入价、输出价、缓存价”三者对产品成本的影响',
        '写一页《模型选型对比表》：场景、候选模型、选择理由、风险'
      ],
      res: [
        ['Karpathy · Neural Networks: Zero to Hero', 'https://karpathy.ai/zero-to-hero.html'],
        ['Let\'s build GPT: from scratch（视频）', 'https://www.youtube.com/watch?v=kCc8FmEb1nY'],
        ['nanoGPT', 'https://github.com/karpathy/nanoGPT'],
        ['3Blue1Brown 神经网络系列', 'https://www.3blue1brown.com/topics/neural-networks'],
        ['The Illustrated Transformer', 'https://jalammar.github.io/illustrated-transformer/'],
        ['Build a Large Language Model (From Scratch) 代码库', 'https://github.com/rasbt/LLMs-from-scratch'],
        ['Datawhale happy-llm（中文，从零理解大模型）', 'https://github.com/datawhalechina/happy-llm'],
        ['李宏毅 2025 机器学习课程（中文）', 'https://speech.ee.ntu.edu.tw/~hylee/ml/2025-spring.php'],
        ['Artificial Analysis 模型对比', 'https://artificialanalysis.ai/']
      ],
      out: '跑通的 nanoGPT 仓库 + 一页模型选型对比表'
    },
    {
      t: '预训练、Scaling 与后训练', w: [5, 9],
      goal: '理解一个模型从预训练到 SFT、RLHF、RL 推理训练的完整流水线，以及每一步在买什么能力。',
      tech: [
        '精读 Scaling Laws 与 Chinchilla，能说清“参数量、数据量、算力”怎么配比',
        '精读 InstructGPT（RLHF）与 DPO，画出两者的流程差异',
        '精读 DeepSeekMath（GRPO）与 DeepSeek-R1，理解可验证奖励的强化学习为什么能训出推理能力',
        '读 nanochat 代码，跟着走一遍 预训练 → 中训练 → SFT → RL 的最小完整流程'
      ],
      prod: [
        '读 Test-Time Compute 论文，总结“让模型多想一会儿”对产品延迟、价格、交互设计的影响',
        '写一篇 800 字短文：推理模型出现后，哪些产品形态变了（如深度研究、后台长任务）'
      ],
      res: [
        ['Scaling Laws for Neural Language Models', 'https://arxiv.org/abs/2001.08361'],
        ['Chinchilla: Training Compute-Optimal LLMs', 'https://arxiv.org/abs/2203.15556'],
        ['InstructGPT: Training LMs to follow instructions with human feedback', 'https://arxiv.org/abs/2203.02155'],
        ['DPO: Direct Preference Optimization', 'https://arxiv.org/abs/2305.18290'],
        ['DeepSeekMath（提出 GRPO）', 'https://arxiv.org/abs/2402.03300'],
        ['DeepSeek-R1', 'https://arxiv.org/abs/2501.12948'],
        ['Scaling LLM Test-Time Compute', 'https://arxiv.org/abs/2408.03314'],
        ['HF 博客：Illustrating RLHF', 'https://huggingface.co/blog/rlhf'],
        ['nanochat（Karpathy 全流程最小实现）', 'https://github.com/karpathy/nanochat'],
        ['Stanford CS336: Language Modeling from Scratch', 'https://stanford-cs336.github.io/'],
        ['HF Smol Training Playbook', 'https://huggingface.co/spaces/HuggingFaceTB/smol-training-playbook']
      ],
      out: '一张“大模型训练流水线”图（每步：数据、目标、成本、产出能力）+ 推理模型短文'
    },
    {
      t: '推理部署与成本：MoE、KV Cache、量化', w: [10, 14],
      goal: '搞懂一次 API 调用背后的推理系统，能估算自部署 vs 调 API 的成本。',
      tech: [
        '读 vLLM / PagedAttention 论文，理解 KV Cache、连续批处理为什么决定吞吐',
        '读 DeepSeek-V3 技术报告的 MoE 与 MLA 部分，理解“总参数 vs 激活参数”',
        '本地用 vLLM 或 Ollama 部署一个 7B 级开源模型，压测并记录 tokens/s',
        '浏览 Ultra-Scale Playbook，知道数据/张量/流水线并行各解决什么问题即可'
      ],
      prod: [
        '做一个成本模型表格：日活、每次对话 token 数、缓存命中率 → 月成本（API 与自部署两套）',
        '对比开源权重模型的许可证（MIT / Apache / 自定义），列出商用限制'
      ],
      res: [
        ['vLLM', 'https://github.com/vllm-project/vllm'],
        ['PagedAttention 论文', 'https://arxiv.org/abs/2309.06180'],
        ['DeepSeek-V3 Technical Report', 'https://arxiv.org/abs/2412.19437'],
        ['GLM-4.5 技术报告（Agentic/Reasoning/Coding）', 'https://arxiv.org/abs/2508.06471'],
        ['Ultra-Scale Playbook（分布式训练）', 'https://huggingface.co/spaces/nanotron/ultrascale-playbook'],
        ['Ollama', 'https://ollama.com/'],
        ['开源权重模型许可证清单', 'https://github.com/xigh/open-weight-models'],
        ['Datawhale self-llm（开源模型部署中文教程）', 'https://github.com/datawhalechina/self-llm']
      ],
      out: '本地部署压测记录 + 成本测算表（可复用到面试）'
    },
    {
      t: '评估、RAG 与 AI 产品工程', w: [15, 20],
      goal: '把模型变成可靠的产品：会写评估、会做 RAG、会定义质量指标。',
      tech: [
        '读 RAG 原始论文，用 LightRAG 或 RAGFlow 搭一个个人知识库问答',
        '用 promptfoo 给自己的 RAG 写 30 条评估用例，跑出准确率和失败分类',
        '学 Anthropic / OpenAI 官方提示工程文档，整理成自己的提示模板库'
      ],
      prod: [
        '精读 Hamel Husain 的评估文章，按“错误分析 → 指标 → 自动评估”给自己的产品设计评估方案',
        '读 Chip Huyen《AI Engineering》对应章节，总结 AI 产品与传统产品在 PRD 上的差异',
        '写一份带评估指标、上线门槛、失败兜底的 AI 功能 PRD'
      ],
      res: [
        ['RAG: Retrieval-Augmented Generation', 'https://arxiv.org/abs/2005.11401'],
        ['LightRAG', 'https://github.com/HKUDS/LightRAG'],
        ['RAGFlow', 'https://github.com/infiniflow/ragflow'],
        ['MinerU（PDF 解析）', 'https://github.com/opendatalab/MinerU'],
        ['promptfoo（评估工具）', 'https://github.com/promptfoo/promptfoo'],
        ['Hamel：Your AI Product Needs Evals', 'https://hamel.dev/blog/posts/evals/'],
        ['Chip Huyen《AI Engineering》配套仓库', 'https://github.com/chiphuyen/aie-book'],
        ['Claude 提示工程文档', 'https://docs.claude.com/en/docs/build-with-claude/prompt-engineering/overview'],
        ['OpenAI Cookbook', 'https://cookbook.openai.com/'],
        ['提示工程指南（中文）', 'https://www.promptingguide.ai/zh']
      ],
      out: '个人知识库 RAG Demo + 评估报告 + 一份 AI 功能 PRD'
    },
    {
      t: '跟上前沿：读论文的固定节奏', w: [21, 26],
      goal: '形成每周追踪前沿的习惯，能独立判断一篇新论文/新模型的产品意义。',
      tech: [
        '每周从本站“最新论文”挑 2 篇精读，用固定模板记笔记：问题、方法、结果、局限、对产品的意义',
        '选一个方向深挖：可解释性（Transformer Circuits）、长上下文、多模态、世界模型 中任选一个',
        '复现一篇小论文的核心实验（推荐从 open-r1 的小规模 GRPO 实验开始）'
      ],
      prod: [
        '每月写一篇“本月大模型变化 → 产品机会”月报，发布到自己的博客或公众号',
        '订阅并固定阅读 3 个信息源（如 Interconnects、Simon Willison、Latent Space）'
      ],
      res: [
        ['Hugging Face Daily Papers', 'https://huggingface.co/papers'],
        ['Transformer Circuits（Anthropic 可解释性）', 'https://transformer-circuits.pub/'],
        ['open-r1', 'https://github.com/huggingface/open-r1'],
        ['Lilian Weng 博客', 'https://lilianweng.github.io/'],
        ['Interconnects（Nathan Lambert）', 'https://www.interconnects.ai/'],
        ['Simon Willison 博客', 'https://simonwillison.net/'],
        ['Latent Space', 'https://www.latent.space/'],
        ['Epoch AI（算力与趋势数据）', 'https://epoch.ai/'],
        ['Stanford AI Index', 'https://hai.stanford.edu/ai-index'],
        ['mlabonne LLM Course', 'https://github.com/mlabonne/llm-course']
      ],
      out: '论文笔记 ≥ 10 篇 + 2 篇月报'
    }
  ],
  frontier: [
    { t: '推理模型与测试时计算', d: '前沿模型普遍分出“快/慢”档位，长时间思考与后台长任务成为卖点。看点：思考预算如何定价，怎样把长任务做成可等待的产品体验。', l: [['Test-Time Compute 论文', 'https://arxiv.org/abs/2408.03314']] },
    { t: '后训练与蒸馏', d: '强化学习后训练的成果被蒸馏到更小的模型上，例如 2026-10 HF 热榜的 Waypoint-OPD（门控在线策略蒸馏）。这决定了便宜模型能追到多近。', l: [['Waypoint-OPD', 'https://huggingface.co/papers/2610.21601']] },
    { t: '开源权重格局', d: '2026 年 10 月，开源一线是 DeepSeek V4/V4.1、GLM-5.3、Kimi K3、Qwen 3.8、Gemma 4、MiniMax M3 等。阿里表示 Qwen 4 仍在训练中，许可证差异是商用的关键。', l: [['开源模型与许可证全景（2026-10）', 'https://codersera.com/blog/open-source-llms-landscape-2026/'], ['Qwen 4 发布进度', 'https://techpilot.ai/qwen-4-release-date/']] },
    { t: '闭源前沿与价格战', d: 'OpenAI GPT-6 系列（Astra / Sol / Luna）、Anthropic Claude Fable 5.1 / Opus 5.5 / Sonnet 5.5、Gemini 3.8 等并行竞争。低档模型每百万 token 只要几毛钱，成本已不再是大多数场景的瓶颈。', l: [['2026-10 前沿模型对比', 'https://www.teamday.ai/blog/best-ai-models-2026'], ['DeepSeek V4.1 Flash 实测', 'https://kingy.ai/blog/deepseek-v4-1-flash-1017-specs-benchmarks-pricing/'], ['大模型排行榜', 'https://www.jumohub.com/leaderboards/overall/']] },
    { t: '可解释性', d: '稀疏自编码器（SAE）与电路分析是安全与可控性的基础研究，HF 热榜上 SAE 相关论文持续出现。', l: [['Behavioral Compositionality of SAE', 'https://huggingface.co/papers/2610.21261'], ['Transformer Circuits', 'https://transformer-circuits.pub/']] },
    { t: '世界模型与具身', d: '视频生成与动作建模合并训练（world + action），VLA 模型快速迭代，是下一个大赛道。', l: [['World and Action Modeling 联合训练', 'https://huggingface.co/papers/2610.21095']] }
  ],
  biz: {
    fresh: [
      { t: 'AI 原生的专业服务（Service-as-Software）', d: '不卖软件席位，按结果交付服务：AI 法务初审、AI 财务对账、AI 招聘初筛。护城河在流程设计与质量把控，不在模型。', l: [['Foundation Capital: Service as Software', 'https://foundationcapital.com/ai-service-as-software/']] },
      { t: '生成式引擎优化（GEO）', d: '用户从搜索转向问 AI，品牌需要出现在 AI 的回答里。2026 年国内已经有一批服务商在卖这项服务。', l: [['2026-08 GEO 服务商评测', 'https://www.cnblogs.com/GrowthUME/p/22373544']] },
      { t: '评估与数据服务', d: '每家做 AI 应用的公司都缺评估集和高质量领域数据，“卖铲子”的机会长期存在。' }
    ],
    old: [
      { t: '客服与销售', d: '最早跑出 ROI 的场景。老业务用大模型做质检、话术推荐、商机评估（参考你的 Dumate-Agent 项目），按节省的人力计价。', l: [['a16z：企业实际在哪里采用 AI', 'https://a16z.com/where-enterprises-are-actually-adopting-ai/'], ['Dumate-Agent', 'https://github.com/yangqxuan-work/Dumate-Agent']] },
      { t: '文档密集型行业', d: '保险理赔、银行信贷、政务审批：存量流程里有大量“读文件 → 填表 → 判断”，最适合用大模型改造。', l: [['Anthropic Economic Index（AI 实际被用来做什么）', 'https://www.anthropic.com/economic-index']] },
      { t: '内容与营销', d: '电商详情页、短视频脚本、本地化翻译。规模大但竞争激烈，差异化在于接入客户自己的数据与渠道。' }
    ]
  }
});
