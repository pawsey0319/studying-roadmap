/* 板块二：单领域小模型 */
HUB.track({
  id: 'slm', name: '单领域小模型', short: '小模型', color: '#13836B', hours: 2,
  goal: '掌握“选底座 → 造数据 → 微调/蒸馏 → 评估 → 端侧部署”的完整闭环，能判断一个场景该用小模型还是大模型 API。',
  live: { hf: 'small language model fine-tuning domain', hn: 'small language model', gh: 'fine-tuning' },
  stages: [
    {
      t: '小模型地图与本地运行', w: [1, 4],
      goal: '知道 2026 年主流小模型有哪些、各自强项，并能在自己电脑上跑起来。',
      tech: [
        '用 Ollama 或 llama.cpp 本地跑 Qwen、Gemma、MiniCPM 的小尺寸版本（1–9B）',
        '了解 GGUF 格式与 4-bit/8-bit 量化对显存和质量的影响（Mac 用户可试 MLX）',
        '读小模型综述，整理“参数量 / 能力 / 上下文 / 许可证”对照表'
      ],
      prod: [
        '读《Small Language Models are the Future of Agentic AI》，总结小模型的三条产品理由：成本、延迟、隐私',
        '列 5 个你认为“小模型比大模型 API 更合适”的场景，并写出判断依据'
      ],
      res: [
        ['Ollama', 'https://ollama.com/'],
        ['llama.cpp', 'https://github.com/ggml-org/llama.cpp'],
        ['MLX / mlx-lm（Apple 芯片）', 'https://github.com/ml-explore/mlx-lm'],
        ['SLM 综述（2026 更新版）', 'https://arxiv.org/abs/2501.05465'],
        ['Small Language Models are the Future of Agentic AI', 'https://arxiv.org/abs/2506.02153'],
        ['Qwen3', 'https://github.com/QwenLM/Qwen3'],
        ['MiniCPM（面壁，端侧）', 'https://github.com/OpenBMB/MiniCPM'],
        ['SmolLM3 博客', 'https://huggingface.co/blog/smollm3'],
        ['2026-10 本地模型推荐', 'https://techpilot.ai/best-local-ai-models/']
      ],
      out: '本地模型对照表 + 场景判断清单'
    },
    {
      t: '从零训一个迷你模型', w: [5, 8],
      goal: '用很小的算力完整走一遍预训练与 SFT，弄清每个环节花多少钱、多少时间。',
      tech: [
        '跟 MiniMind 用单卡（或云 GPU 几小时）训练一个 ~26M 参数的中文小模型',
        '读《Textbooks Are All You Need》，理解“数据质量 > 数据规模”对小模型为什么更重要',
        '跟 HF smol-course 学习 SFT 与对齐的基本流程'
      ],
      prod: [
        '记录训练全过程的算力、时长、费用，形成“小模型训练成本卡片”'
      ],
      res: [
        ['MiniMind（从零训练小模型，中文）', 'https://github.com/jingyaogong/minimind'],
        ['Datawhale tiny-universe（手搓小模型）', 'https://github.com/datawhalechina/tiny-universe'],
        ['Textbooks Are All You Need（phi-1）', 'https://arxiv.org/abs/2306.11644'],
        ['HF smol-course', 'https://github.com/huggingface/smol-course'],
        ['HF LLM Course（中文可选）', 'https://huggingface.co/learn/llm-course']
      ],
      out: '自己训练的迷你模型 + 成本卡片'
    },
    {
      t: '领域数据与微调：LoRA / QLoRA', w: [9, 15],
      goal: '为一个具体领域（建议选金融研报问答，可与量化板块共用）造数据并微调出可用模型。',
      tech: [
        '精读 LoRA、QLoRA 论文，理解低秩适配为什么省显存',
        '用 Easy Dataset 或 distilabel，从领域文档合成 1000 条指令数据，并人工抽检 100 条',
        '用 LLaMA-Factory 或 Unsloth 对 Qwen 小模型做 LoRA 微调',
        '用 lm-evaluation-harness 或自建评估集对比：底座 vs 微调后 vs 大模型 API'
      ],
      prod: [
        '写一份“数据卡片”：来源、授权、清洗规则、隐私处理（领域数据的合规是落地第一关）',
        '算 ROI：微调一次的成本、推理节省、效果差距，判断这个场景值不值得微调'
      ],
      res: [
        ['LoRA 论文', 'https://arxiv.org/abs/2106.09685'],
        ['QLoRA 论文', 'https://arxiv.org/abs/2305.14314'],
        ['LLaMA-Factory', 'https://github.com/hiyouga/LLaMA-Factory'],
        ['Unsloth 文档', 'https://docs.unsloth.ai/'],
        ['PEFT', 'https://github.com/huggingface/peft'],
        ['TRL', 'https://github.com/huggingface/trl'],
        ['Easy Dataset（领域数据集构建）', 'https://github.com/ConardLi/easy-dataset'],
        ['distilabel（合成数据）', 'https://github.com/argilla-io/distilabel'],
        ['lm-evaluation-harness', 'https://github.com/EleutherAI/lm-evaluation-harness'],
        ['FinGPT（金融领域参考）', 'https://github.com/AI4Finance-Foundation/FinGPT'],
        ['BloombergGPT 论文', 'https://arxiv.org/abs/2303.17564'],
        ['MedicalGPT（医疗领域训练流程参考）', 'https://github.com/shibing624/MedicalGPT']
      ],
      out: '领域微调模型 + 三方对比评估报告 + 数据卡片'
    },
    {
      t: '蒸馏、Embedding 与专用小模型', w: [16, 21],
      goal: '小模型不只是“聊天模型”：学会蒸馏，学会用 Embedding / Reranker / 时间序列等专用模型解决问题。',
      tech: [
        '读 Hinton 知识蒸馏论文，用大模型输出作为教师数据蒸馏你的领域小模型',
        '用 BGE 系列 Embedding + Reranker 给 RAG 换上自部署检索模型，对比效果',
        '了解金融 K 线基础模型 Kronos 等时间序列模型（与量化板块衔接）'
      ],
      prod: [
        '画出“大模型 + 小模型”协作架构：哪些步骤交给小模型（分类、抽取、路由），哪些交给大模型',
        '查 MTEB 榜单，为中文场景选 Embedding 模型并写理由'
      ],
      res: [
        ['Distilling the Knowledge in a Neural Network', 'https://arxiv.org/abs/1503.02531'],
        ['FlagEmbedding（BGE）', 'https://github.com/FlagOpen/FlagEmbedding'],
        ['MTEB 榜单', 'https://huggingface.co/spaces/mteb/leaderboard'],
        ['Sentence Transformers', 'https://sbert.net/'],
        ['Kronos（金融 K 线基础模型）', 'https://github.com/shiyu-coder/Kronos']
      ],
      out: '蒸馏实验记录 + 大小模型协作架构图'
    },
    {
      t: '端侧部署与产品化', w: [22, 26],
      goal: '把领域小模型部署到真实设备或私有服务器上，形成一个可演示的小产品。',
      tech: [
        '把微调模型量化成 GGUF，用 llama.cpp / Ollama 发布为本地服务',
        '用 vLLM 部署成 OpenAI 兼容接口，测吞吐与并发'
      ],
      prod: [
        '写一个“私有化部署方案”：硬件配置、报价、运维、数据不出域的卖点',
        '做 5 分钟 Demo 视频，讲清楚场景、效果、成本'
      ],
      res: [
        ['llama.cpp', 'https://github.com/ggml-org/llama.cpp'],
        ['vLLM', 'https://github.com/vllm-project/vllm'],
        ['小模型做端侧 Agent（2026 指南）', 'https://www.digitalapplied.com/blog/small-language-models-on-device-agents-2026-guide']
      ],
      out: '可演示的私有化领域小模型 + 部署方案'
    }
  ],
  frontier: [
    { t: '小模型做 Agent 的主力', d: '3–9B 模型已能完成大部分工具调用和格式化步骤，大模型只在关键决策时介入（大小模型路由）。', l: [['SLM 做端侧 Agent', 'https://www.digitalapplied.com/blog/small-language-models-on-device-agents-2026-guide'], ['LEASH：弱到强升级路由', 'https://huggingface.co/papers/2610.22280']] },
    { t: '端侧多模态', d: 'Gemma 4 E2B/E4B、MiniCPM-V 4.x、LFM2.5 等让手机和电脑上的离线多模态成为现实。', l: [['2026-10 本地模型推荐', 'https://techpilot.ai/best-local-ai-models/']] },
    { t: '合成数据与环境合成', d: '用多智能体自动合成训练数据和任务环境（如 Data World、Cowork-Gym），小团队也能训出强的专用模型。', l: [['Data World', 'https://huggingface.co/papers/2610.21656'], ['Cowork-Gym', 'https://huggingface.co/papers/2610.17670']] },
    { t: 'Gartner 判断', d: '到 2027 年，企业使用专用小模型的量将至少是通用大模型的 3 倍（行业白皮书转引，作为方向参考）。' }
  ],
  biz: {
    fresh: [
      { t: '私有化行业小模型', d: '给医院、律所、券商、制造企业做“数据不出域”的专用模型 + 一体机。客户为合规和隐私买单。', l: [['领域小模型构建流水线（MDPI 2026）', 'https://www.mdpi.com/2076-3417/16/13/6630']] },
      { t: '端侧 AI 硬件', d: '录音卡片、学习机、车机、工业质检终端，本地小模型带来零延迟与零云成本。' },
      { t: '模型定制服务', d: '“数据整理 + 微调 + 评估 + 部署”打包服务，适合中小企业。' }
    ],
    old: [
      { t: '传统 NLP 流程替换', d: '工单分类、合同要素抽取、舆情监控，过去靠规则 + BERT。用微调小模型重做，准确率更高、维护成本更低。' },
      { t: '老软件加 AI 能力', d: 'ERP、OA、CRM 内嵌本地小模型做搜索、填表和摘要，卖“AI 增值模块”。' }
    ]
  }
});
