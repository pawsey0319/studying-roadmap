/* 板块四：量化（个人量化，零基础起步） */
HUB.track({
  id: 'quant', name: '量化', short: '量化', color: '#7A3FB8', hours: 2,
  goal: '从零开始，做到能用 Python 获取数据、回测策略、小资金合规实盘，并能用大模型和智能体辅助投研。重点是个人量化：小资金、免费数据、本地回测、券商接口。',
  note: '风险提示：本板块只用于学习，不构成投资建议。回测收益不代表实盘收益，个人量化先跑模拟盘，再用亏得起的小资金试。监管规则以证监会和交易所官网原文为准。',
  live: { hf: 'quantitative trading LLM', hn: 'algorithmic trading', gh: 'quantitative-trading' },
  stages: [
    {
      t: '金融市场与指标常识', w: [1, 4],
      goal: '零基础补齐“交易什么、怎么交易、怎么衡量好坏”。',
      tech: [
        '搞懂 A 股规则：T+1、涨跌停、集合竞价、佣金与印花税、复权（前复权/后复权）',
        '用概率论知识理解收益率、波动率、相关性，手算一遍夏普比率与最大回撤',
        '学 Datawhale whale-quant 前几章，建立量化交易的整体框架'
      ],
      prod: [
        '画出个人量化的“用户旅程”：学习 → 选平台 → 拿数据 → 回测 → 模拟 → 实盘，标出每一步的痛点',
        '对比 聚宽 / 米筐 / BigQuant / 果仁 等平台：面向谁、怎么收费、门槛在哪'
      ],
      res: [
        ['Datawhale whale-quant（量化入门，中文）', 'https://github.com/datawhalechina/whale-quant'],
        ['上海证券交易所（交易规则与投教）', 'https://www.sse.com.cn/'],
        ['深圳证券交易所（交易规则与投教）', 'https://www.szse.cn/'],
        ['2026-07-06 起沪深北交易新规讨论', 'https://linux.do/t/topic/2508684'],
        ['Investopedia（英文金融词典，浏览器打开）', 'https://www.investopedia.com/'],
        ['《聪明的投资者》（本杰明·格雷厄姆）'],
        ['《打开量化投资的黑箱》（里什·纳兰）'],
        ['聚宽 JoinQuant', 'https://www.joinquant.com/'],
        ['米筐 RiceQuant', 'https://www.ricequant.com/'],
        ['BigQuant', 'https://bigquant.com/'],
        ['果仁网', 'https://guorn.com/']
      ],
      out: '个人量化名词表 + 平台对比表'
    },
    {
      t: 'Python 数据分析与行情数据', w: [5, 8],
      goal: '把基础 Python 升级到 pandas 数据分析，能稳定拿到免费行情数据。',
      tech: [
        '读《Python for Data Analysis》的 pandas 与时间序列章节',
        '用 AKShare / BaoStock 拉取沪深 300 成分股日线，存成本地 Parquet 或 SQLite',
        '计算并画出均线、MACD、RSI、布林带，理解每个指标在描述什么'
      ],
      prod: [
        '评估免费数据源：覆盖范围、更新时间、稳定性、是否允许商用，写一页数据源选型说明'
      ],
      res: [
        ['Python for Data Analysis（免费在线版）', 'https://wesmckinney.com/book/'],
        ['AKShare 文档', 'https://akshare.akfamily.xyz/'],
        ['AKShare GitHub', 'https://github.com/akfamily/akshare'],
        ['BaoStock', 'http://baostock.com/'],
        ['Tushare Pro', 'https://tushare.pro/'],
        ['yfinance（美股/港股数据）', 'https://github.com/ranaroussi/yfinance'],
        ['Kaggle Python 微课程', 'https://www.kaggle.com/learn/python']
      ],
      out: '本地行情数据库 + 指标可视化笔记本'
    },
    {
      t: '回测与第一个策略', w: [9, 13],
      goal: '写出并正确回测第一个策略，学会识别“看起来赚钱其实是假的”回测。',
      tech: [
        '用 backtesting.py 或 Backtrader 实现双均线策略，再用 vectorbt 做参数扫描',
        '实现一个 ETF 动量轮动策略（个人量化最常见、门槛最低的策略类型）',
        '专门检查四个坑：未来函数、幸存者偏差、交易成本与滑点、过拟合（样本内外切分）'
      ],
      prod: [
        '设计一份标准回测报告模板：年化收益、波动率、夏普、最大回撤、换手、与基准对比',
        '写一篇《为什么 90% 的回测曲线不可信》短文'
      ],
      res: [
        ['backtesting.py', 'https://github.com/kernc/backtesting.py'],
        ['Backtrader', 'https://www.backtrader.com/'],
        ['vectorbt', 'https://github.com/polakowo/vectorbt'],
        ['QuantConnect（含教程与 LEAN 引擎）', 'https://www.quantconnect.com/'],
        ['Quantopian 研究笔记本合集', 'https://github.com/quantopian/research_public'],
        ['《量化交易：如何建立自己的算法交易事业》（Ernest Chan）'],
        ['The Probability of Backtest Overfitting（SSRN，浏览器打开）', 'https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2326253']
      ],
      out: '两个策略的回测报告 + 回测避坑清单'
    },
    {
      t: '多因子与机器学习选股', w: [14, 19],
      goal: '理解机构主流的多因子框架，用机器学习做截面选股。',
      tech: [
        '学因子三件套：IC/IR、分层回测、因子中性化；用 Fama-French 数据理解经典因子',
        '读《101 Formulaic Alphas》，挑 5 个因子在 A 股上复现',
        '跑通微软 Qlib 的 LightGBM 基线（Alpha158 因子 + 沪深 300）',
        '读《An Introduction to Statistical Learning》的回归、树模型章节补统计学习基础'
      ],
      prod: [
        '思考：因子在公开后会衰减，个人投资者的优势和劣势各在哪里（资金小、灵活 vs 数据和算力弱）'
      ],
      res: [
        ['101 Formulaic Alphas', 'https://arxiv.org/abs/1601.00991'],
        ['Fama-French 数据库', 'https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html'],
        ['Microsoft Qlib', 'https://github.com/microsoft/qlib'],
        ['An Introduction to Statistical Learning（免费）', 'https://www.statlearning.com/'],
        ['Machine Learning for Trading（代码库）', 'https://github.com/stefan-jansen/machine-learning-for-trading'],
        ['MIT 18.S096 金融数学专题', 'https://ocw.mit.edu/courses/18-s096-topics-in-mathematics-with-applications-in-finance-fall-2013/'],
        ['《主动投资组合管理》（Grinold & Kahn）'],
        ['《Advances in Financial Machine Learning》（López de Prado）'],
        ['awesome-quant（中文资源合集）', 'https://github.com/thuquant/awesome-quant'],
        ['awesome-quant（英文资源合集）', 'https://github.com/wilsonfreitas/awesome-quant']
      ],
      out: '5 个复现因子的检验报告 + Qlib 基线结果'
    },
    {
      t: '个人实盘：券商接口与合规', w: [20, 23],
      goal: '用合规的方式把策略接上真实账户，从模拟盘到小资金实盘。',
      tech: [
        '了解个人量化的三条路：券商 QMT / miniQMT、PTrade、vn.py；弄清开通门槛（各券商对资产要求不同，需逐一咨询）',
        '在 QMT 模拟盘跑通“行情订阅 → 信号 → 下单 → 成交回报 → 日志”全流程',
        '写风控模块：单票仓位上限、单日亏损熔断、断线重连、异常下单拦截'
      ],
      prod: [
        '学习程序化交易监管：2025 年 7 月 7 日起施行的沪深北《程序化交易管理实施细则》要求程序化交易先报告，并对高频交易（如单账户每秒申报撤单达 300 笔以上或单日达 2 万笔以上）有额外要求。个人低频策略也要先向券商报告',
        '设计一个“个人量化工具”的产品方案：目标用户、核心功能、合规边界、收费方式'
      ],
      res: [
        ['迅投 QMT / xtquant 文档', 'https://dict.thinktrader.net/'],
        ['vn.py', 'https://github.com/vnpy/vnpy'],
        ['PTrade 从零到实盘', 'https://cloud.tencent.com/developer/article/2752236'],
        ['QMT 与 PTrade 区别', 'https://www.cnblogs.com/bigleft/p/18286458'],
        ['miniQMT + Backtrader 实践', 'https://juejin.cn/post/7518950408272068648'],
        ['中国证监会（规章原文）', 'https://www.csrc.gov.cn/'],
        ['上交所《程序化交易管理实施细则》（在上交所官网“规则”栏目搜索）'],
        ['个人 QMT 策略实盘经验帖（2026）', 'https://linux.do/t/topic/2525120']
      ],
      out: '模拟盘稳定运行 4 周的日志 + 风控模块 + 合规笔记'
    },
    {
      t: 'AI + 量化：大模型与智能体投研', w: [24, 26],
      goal: '把前三个板块学到的东西用到量化上，这是你的差异化方向。',
      tech: [
        '跑通 TradingAgents（多智能体：分析师、研究员、交易员、风控），换成国产模型对比决策质量',
        '跑通 RD-Agent(Q)：用 Agent 自动挖因子、调模型',
        '用大模型做研报/公告情绪因子，接入 Qlib 检验 IC',
        '试用 Kronos 做 K 线预测，和传统模型对比'
      ],
      prod: [
        '批判性评估：LLM 选股回测常有数据泄漏（模型训练时已见过未来新闻），写出你的检验方法',
        '设计一个“AI 投研助手”产品：给个人投资者的是信息整理与纪律提醒，而不是荐股（合规红线）'
      ],
      res: [
        ['TradingAgents', 'https://github.com/TauricResearch/TradingAgents'],
        ['RD-Agent', 'https://github.com/microsoft/RD-Agent'],
        ['R&D-Agent-Quant 论文', 'https://arxiv.org/abs/2505.15155'],
        ['FinRL（强化学习交易）', 'https://github.com/AI4Finance-Foundation/FinRL'],
        ['FinRobot（金融 Agent 平台）', 'https://github.com/AI4Finance-Foundation/FinRobot'],
        ['AI-Trader（大模型交易对比）', 'https://github.com/HKUDS/AI-Trader'],
        ['Kronos（金融 K 线基础模型）', 'https://github.com/shiyu-coder/Kronos'],
        ['quantlab（Qlib + RD-Agent + LLM 的 A 股流水线）', 'https://github.com/sqyangx/quantlab'],
        ['LLM 引导强化学习交易论文', 'https://arxiv.org/abs/2508.02366']
      ],
      out: '一个 AI 投研 Demo + 产品方案'
    }
  ],
  frontier: [
    { t: '多智能体交易框架', d: 'TradingAgents 2026-10 发布 v0.6.0，支持按角色分配不同档位模型、HTML 报告与决策复盘。', l: [['TradingAgents', 'https://github.com/TauricResearch/TradingAgents']] },
    { t: 'Agent 自动化投研', d: 'RD-Agent(Q) 用多智能体联合优化因子与模型，论文报告以更少因子获得更高年化收益。', l: [['R&D-Agent-Quant', 'https://arxiv.org/abs/2505.15155']] },
    { t: '金融基础模型', d: 'Kronos 等 K 线基础模型把“预训练 + 微调”带进时间序列预测。', l: [['Kronos', 'https://github.com/shiyu-coder/Kronos']] },
    { t: '市场规则变化', d: '2026-07-06 起沪深北实施新版交易规则（风险警示股涨跌幅放宽到 10%，沪市基金收盘集合竞价，盘后固定价格交易扩容）。纳斯达克计划 2026-12 起实行每天 23 小时交易。规则变化会让旧策略的历史数据失效。', l: [['A 股新规讨论', 'https://linux.do/t/topic/2508684'], ['纳斯达克 23/5 交易', 'https://www.okx.com/pt/orbit/insight/84151002578784']] }
  ],
  biz: {
    fresh: [
      { t: '个人量化工具与社区', d: '自然语言写策略（vibe trading）、一键回测、策略体检。个人量化人群在增长，但工具门槛仍然高。' },
      { t: 'AI 投研信息服务', d: '公告/研报/新闻的摘要、事件提醒、情绪指标，卖给个人投资者和小型私募。注意不能变成荐股。' }
    ],
    old: [
      { t: '券商投顾与 App 升级', d: '券商 App 内嵌 AI 投研助手、智能条件单、QMT 策略模板市场，提升活跃度和交易量。' },
      { t: '小型私募投研提效', d: '用 RD-Agent 类工具替代部分研究员的因子挖掘与报告撰写工作。' }
    ]
  }
});
