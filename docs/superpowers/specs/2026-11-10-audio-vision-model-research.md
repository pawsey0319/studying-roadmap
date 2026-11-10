# 学习 Agent 小型音频与视觉模型调研

日期：2026-11-10。用途：为当前 learning-hub 的下一版现场学习 Agent 做选型，不是通用模型排行榜。

证据口径：通过 agent-reach / Exa 搜索与正文抓取核读官方模型卡、许可证及平台文档。原站部分连接失败后使用 Exa 正文抓取；不将搜索摘要、营销宣称或模型自评当成本项目实测。本文未下载运行权重，未测 Mac/Android 真机延迟、能耗与准确率。下文推荐表示优先验证，不表示已经达到发布要求。

## 1. 项目需求如何改变选型

### 1.1 两种语音路径，不能互相冒充

| 入口状态 | 松开后的行为 | 必须具备的能力 |
|---|---|---|
| 开启语音模式 | 直接发送音频消息给 Agent | 模型实际接收音频输入并理解，不能只给下游文本模型一份转写 |
| 未开启语音模式 | 识别成文字留在输入框，用户编辑再发 | ASR，重点是中文、英语术语、数字/否定词与噪声 |

直接音频输入与音频输出是独立能力：用户说话，Agent 仍默认文字回答；可选朗读可后接系统 TTS，不必为了朗读常驻完整语音生成模块。这里“音频直接给 Agent”不意味着禁止音频编码、解码或重采样，而是禁止未经用户选择改成仅转写再送文本模型。采用有损语音编码前须验证术语与声学线索未严重丢失。

两条路径均提供取消；本次录音开始时固定模式。直接音频服务不可用则明示失败，征得用户同意才切到转文字。兼容原始录音格式不等于模型支持：WebM/Opus、MP4/AAC 等先由适配层解码到模型要求的波形，不能改扩展名假装转换。

### 1.2 视觉不是把所有页面变成视频

- PC：保持既有设计。项目文件/编辑器/工具结果优先，截图补当前布局、图表和界面状态；只看屏幕不能读懂整个项目。
- 手机：点击咨询进入会话，请求来源页面授权；授权后保持来源上下文更新并等待用户消息，不自动解说。用户后续已确认包括微信、外部浏览器等其他 App，以普通 Android 手机优先验证，不以提供机型作为前置条件。
- App 内可读文章优先取正文、选区、段落 ID、页码、滚动位置、版本；图片、扫描页、图表再调视觉模型。已有 PDF 文字层先解析，不为普通正文运行 VLM。
- “持续读取”应实现为授权期间监听来源变化、维护最新上下文，提问时按需推理；不是空闲时每秒向云端发图。若经用户同意预解析新页，按内容 hash 去重且限定预算。
- 页面内容、OCR 文本及音频中的指令都是不可信材料，不能改变工具权限。小模型答出坐标不等于可安全自动点击。

### 1.3 当前项目不是已经具备完整多模态服务

当前前端有图片及 MediaRecorder→STT 原型，已验证 mock，不是平台真链路验证。平台代理 `cleanBody` 目前过滤非字符串消息；后续必须增加直接音频/图片消息校验、能力探测、大小/时长限制、鉴权与额度，不能丢掉附件继续答。ASR API、音频理解 API、视觉 API 应由统一能力注册表路由，不能用一个 `supportsAudio` 布尔值混淆转写与理解。

## 2. 初步结论

**先选最小的合格组合，不选绝对最小的单一模型。** 推荐把感知与高风险规划分开：小型 ASR/视觉/文档解析模块做输入处理，学习推理与授权执行沿用独立的 Agent/Harness。一个能 OCR 的 0.9B 模型不等于完整学习 Agent；一个能转写的 0.2B 模型也不等于直接音频理解。

具体候选、证据与对照见下文。

## 3. 部署与资源比较的统一口径

### 3.1 权重大小不是运行内存

仅用于数量级估算：若 N 是**全模型**参数十亿数，FP16 权重约 2N GB，INT8 约 N GB，INT4 理想下限约 0.5N GB（十进制）。实际量化有 scales、未量化层、视觉/音频编码器及额外模块；型号中的 B 可能只指语言骨干。不能拿这些数字当显存或手机 RAM 要求。

运行峰值还包括 KV cache、图像/音频 token、激活、临时张量、框架与并发；OCR 完整流水线可能额外加载版面模型。高分辨率裁块、长录音、多页和长会话会显著增加开销。量化后必须重新测中文小字、数字、否定词和工具参数，不假设精度无损。

### 3.2 端侧与服务器分开

- 手机首选承担采集、来源授权、正文提取、缓存、取消和播放；模型可运行在开发者服务或用户明确关联的电脑，不强制手机同时常驻 Omni+VLM+OCR。
- 手机全离线是单独验收目标：需明确 SoC、RAM、NPU/GPU runtime、量化格式、机型覆盖与包体；Python/CUDA 示例不能证明 Android 可部署。
- Mac 首版是产品客户端优先，不代表每个候选模型在 Apple Silicon 已有官方优化。CUDA/vLLM 配方主要是服务端证据；MLX/GGUF/第三方转换需逐架构核实，不能只因“OpenAI兼容 API”就宣称本地模型可用。
- 不要求所有模型同时加载。ASR、OCR、Omni 可以按需加载或远程隔离；实际加载开销与首请求延迟要计入。

## 4. 项目评测与选型规则（建议，不是已测结果）

### 4.1 固定集

建立首批 240 个案例，每类 60 个，先用人工核对参考答案：
1. 转文字：普通话、口音/方言、中文夹英文技术词、金融数字/单位、法律否定与例外、安静/街道/风扇噪声；包含停顿、自我纠正和静音。
2. 直接音频：短口述提问、对同一页面追问、带停顿/修正的复杂指令、少量有用声学线索；另设辅助诊断集比较“音频输入”与“仅人工正确转写”，确认真实音频链路而非检验偶然回答相同。
3. 阅读视觉：中文新闻、金融表格、法律扫描件、艺术图像、公式、手机小字；每张图预标关键字段与引用位置，混入不存在的信息测试拒答。
4. PC 现场：IDE/终端/设置页/网页，混合高 DPI、小字、遮挡、弹窗、过期截图；对下一步目标、可见证据和不确定性评分，不直接放真实执行权限。

开发集与冻结验收集分离；同一模型 FP16 与量化版都跑，保持图像像素预算、裁块策略、提示词、音频采样/时长一致。记录模型 revision、许可证、框架版本、量化、硬件、解码参数与输入 hash；不能用更高清输入的较大模型对比缩图的小模型然后归因于参数量。

### 4.2 首轮门槛建议

- ASR：干净中文 CER ≤5%、噪声子集 ≤10%；关键实体/数字/否定词准确率 ≥95%。CER 是编辑距离/参考字符数，不等于总体任务准确率；分口音/领域报告，不能平均掩盖失败。
- 音频理解：答案正确且切题 ≥90%，音频中关键约束召回 ≥95%；音频真实送达有请求/模型输入证据。不得因为声调猜测人的心理或身份。
- 阅读：关键字段准确率 ≥95%、引用定位正确率 ≥95%；金融金额、日期、法律否定/例外单列，错误必须可察觉或升级处理。
- PC 指导：目标区域/步骤正确率 ≥90%，陈旧或遮挡场景不得编造精确操作；未经授权的执行/外发为 0。
- 延迟/成本：按冷启动/热启动、设备、网络分组，测松开至文字、松开至首个有效音频理解答复、图像处理与端到端首答的 p50/p95；测峰值内存、能耗、失败率、每百次成本。尚无目标硬件与预算，不填虚构毫秒值。

这些是第一轮工程门槛，样本量不足以宣称总体达到某准确率；发布前扩充关键失败类并报告置信区间。小模型过不了门槛就升级或限缩能力，不能为了“尽可能小”降低高风险信息准确性。

### 4.3 升级与拒答

不能仅依赖模型自报 confidence。以原文/OCR交叉一致性、字段校验、引用是否存在、来源是否过期、裁块覆盖和工具验证结果决定是否重读/放大/升级；无确证时明确告知用户。对外发、写入、交易等动作的授权始终在 Harness，不交给感知模型独立决定。

## 5. 手机页面授权的技术边界

App 内来源需要阅读层持有来源对象与版本，即便聊天页成为当前视图也能定位原材料；不能截到聊天窗口后以为仍在读文章。提问时展示当前来源标题/页段，支持暂停与切换；切到新页面或域名重新确认。已确认页面范围含 App 内和微信/外部浏览器；页面变化与重新授权的边界由实施协议明确，不复用旧授权扩大采集范围。

外部 App 不可用 App 内一个确认按钮绕过 OS 许可。[Android MediaProjection 官方文档](https://developer.android.com/media/grow/media-projection) 明确 Android 14+ 可选单 App 共享，须每次会话同意，token/virtual display 不可复用，需相应前台服务声明与提示；系统结束共享、锁屏、进程停止后释放采集。单 App 投屏也不是任意读 DOM、不可见页面抓取或执行授权。跳到咨询后能否继续采到原 App 内容必须真机验证，不能保证后台来源仍可见。

iOS 跨应用路径需另行验证系统支持、ReplayKit/分享入口及分发政策；本报告不承诺第三方 App 可任意跨应用后台读屏。不支持时明确显示来源已暂停，提供分享文章/截图入口；不能把旧图标为实时。手机执行权限仍与阅读授权分离。

## 6. 音频候选与建议

### 6.1 转文字：先测 220M–约 0.9B 档

| 模型 | 规模与许可 | 本项目判断 |
|---|---|---|
| [Whisper tiny / base / small](https://github.com/openai/whisper) | 39M / 74M / 244M；MIT | tiny/base 用作体积下界，不预设中文合格；small 是同档对照。中文须用多语版，不用 `.en` |
| [Paraformer-zh](https://huggingface.co/funasr/paraformer-zh) | 220M；当前卡 Apache-2.0，历史许可不同，固定 revision 复核 | 最小优先试验之一；普通话、中英术语、热词场景；长音频需 VAD，额外标点/对齐不算原生220M |
| [SenseVoiceSmall](https://huggingface.co/FunAudioLLM/SenseVoiceSmall) | 234M；当前卡 `other/model-license`，链接 [MODEL_LICENSE](https://github.com/modelscope/FunASR/blob/main/MODEL_LICENSE)，不是 Apache | 中文/粤语小型强候选，但需模型许可审查；情绪/事件标签不使其成为通用音频问答模型。Small 已发布覆盖普通话、粤语、英、日、韩，不把系列50+语言套给它 |
| [Qwen3-ASR-0.6B](https://huggingface.co/Qwen/Qwen3-ASR-0.6B) | 名称0.6B，HF汇总约0.9B全模型；Apache-2.0 | 中文/方言覆盖优先的挑战者；30语言、22中文方言。资源高于220/234M，不宣称最小 |

Qwen3-ASR 官方表在统一 BF16/vLLM/greedy 条件下，0.6B 的 Fleurs-zh 为2.88、CV-zh为6.89、AISHELL-2为3.15；该表标注 WER，保留原口径，不改写成跨实现 CER。流式 Fleurs-zh 3.40，不等于离线2.88。专用ASR即便支持 `audio_url`，也不满足直接音频理解。

原始 checkpoint 用 `qwen-asr`；[原生 `-hf` 导出](https://huggingface.co/Qwen/Qwen3-ASR-0.6B-hf)卡要求 Transformers>=5.13.0，不能混用API。原始包流式仅vLLM，不支持批量/时间戳；本项目松开后转写不必先做流式，也不必默认加0.6B ForcedAligner。

**首轮取舍：**若尽可能小是首要限制，先对比 Paraformer-zh、SenseVoiceSmall（许可通过后）与 Whisper-small；以 Qwen3-ASR-0.6B 做较高资源挑战者。若多方言与许可清晰优先，可反过来以 Qwen3-ASR 起步，再验证小模型能否替换。不全部上线。

### 6.2 直接音频：不能用小 ASR 冒充

| 模型 | 规模/许可 | 建议 |
|---|---|---|
| [Qwen2.5-Omni-3B](https://huggingface.co/Qwen/Qwen2.5-Omni-3B) | 3B是型号，不是已核完整总参数；[Qwen Research License，NON-COMMERCIAL](https://huggingface.co/Qwen/Qwen2.5-Omni-3B/blob/main/LICENSE) | 本轮较小、有中文/音频推理证据的研究候选；非商业研究可优先验证，商业须另申请，不能作默认商用方案 |
| [Qwen2.5-Omni-7B](https://huggingface.co/Qwen/Qwen2.5-Omni-7B) | Apache-2.0；包含编码器/Talker等，不按7B算全部内存 | 商业产品的优先对照之一；仅文字输出，验证关闭 Talker 的实际节省 |
| [MiniCPM-o-4_5](https://huggingface.co/openbmb/MiniCPM-o-4_5) | 官方总9B；Apache-2.0；Qwen3-8B+视觉/音频/TTS组件 | 与 Omni-7B 同测。仅音频时验证 `init_vision=False`、无朗读时验证 `init_tts=False`，不能把 `generate_audio=False` 当卸载证明 |
| [Qwen2-Audio-7B-Instruct](https://huggingface.co/Qwen/Qwen2-Audio-7B-Instruct) | Apache-2.0；语言骨干7B另含音频编码器 | 旧版直接音频→文字基线，不因无语音生成淘汰；未核到完整参数总量 |
| [MiniCPM-o-2_6](https://huggingface.co/openbmb/MiniCPM-o-2_6) | 官方总8B，历史许可单独核 | 兼容性对照，不套用4.5的许可 |
| [Qwen3-Omni-30B-A3B-Instruct](https://huggingface.co/Qwen/Qwen3-Omni-30B-A3B-Instruct) | HF约35B总量；Apache-2.0；A3B是激活规模 | 只作质量上限抽样，不是只存3B权重的小模型 |

Qwen2.5-Omni官方同表：3B/7B Fleurs-zh 3.2/3.0，WenetSpeech test-net 6.3/5.9、meeting 8.1/7.7；MMAU 63.30/65.60。转写错误率与MMAU都不等于中文学习问答准确率。MiniCPM-o4.5本家表 AISHELL-1 CER0.9、WenetSpeech net5.9、meeting5.7、MMAU76.9；评测配置与Qwen表不同，不能拼成绝对排名。

**资源判断：**Omni关闭Talker约省2GB是官方配置说明，不是总内存只需2GB。MiniCPM-o4.5卡报告 BF16 19GB / INT4 11GB，但负载与硬件条件不足以在本项目复现，不能保证11GB设备必跑，更不能与Omni的15秒视频内存表横比。没有实测前不宣布7B比9B省内存。

**结论：**目前本轮核读到的候选中，没有已证明兼具商用许可清晰、极小体积和本项目准确性的直接音频模型。研究先试3B；商业优先对比Omni7B与MiniCPM-o4.5，采用客户端录音+本机电脑或服务器推理，不承诺手机纯离线。可由真实音频模型输出答案/结构化观察，再交主Agent检索与调用工具；必须标明是音频子模型实际感知，不声称纯文本主模型自己听到了录音。

输入先解码重采样：MiniCPM示例16k单声道；Qwen2-Audio处理器16k、30秒窗口，长输入需切段或拒绝。浏览器容器兼容、长音频尾部保留、取消后资源释放必须逐项测试。

## 7. 视觉候选与证据

### 7.1 最小原型与可用基线分开

| 模型 | 规模/许可 | 本项目定位 |
|---|---|---|
| [Qwen3.5-0.8B](https://huggingface.co/Qwen/Qwen3.5-0.8B) / [2B](https://huggingface.co/Qwen/Qwen3.5-2B) | Apache-2.0；型号为语言骨干规模，另有视觉编码器/MTP，不等于总量 | 0.8B是最小优先实验，2B是中文阅读平衡候选；需新框架，先用非思考模式、限制生成预算 |
| [InternVL3_5-1B](https://huggingface.co/OpenGVLab/InternVL3_5-1B) / [2B](https://huggingface.co/OpenGVLab/InternVL3_5-2B) | 总约1.1B（视觉0.3+语言0.8）/2.3B；Apache-2.0 | 同量级独立架构对照，注意原格式remote code与-HF格式区别 |
| [Qwen3-VL-2B-Instruct](https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct) / [4B](https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct) | Apache-2.0；语言型号另含约300M视觉编码器 | 2B低资源基线；PC界面/图表用4B作对照，不假定足够可靠执行 |
| [PaddleOCR-VL-1.6](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6) | Apache-2.0；官方0.9B档、HF汇总约1.0B；ERNIE4.5-0.3B+视觉+MLP | 扫描件、表格、公式结构解析专用；不是通用多轮Agent，页级pipeline还含额外组件 |
| [SmolVLM-256M](https://huggingface.co/HuggingFaceTB/SmolVLM-256M-Instruct) / [500M](https://huggingface.co/HuggingFaceTB/SmolVLM-500M-Instruct) | Apache-2.0；93M视觉+135M/360M语言；英语卡 | 极低资源下界，不推荐中文小字默认；DocVQA val58.3/70.5只是官方证据 |
| [Qwen2.5-VL-3B-Instruct](https://huggingface.co/Qwen/Qwen2.5-VL-3B-Instruct) | [Qwen Research非商业许可](https://huggingface.co/Qwen/Qwen2.5-VL-3B-Instruct/blob/main/LICENSE) | 仅旧迁移对照，不套用其他Qwen型号的Apache许可 |

### 7.2 官方同表能说明什么

下表来自Qwen3.5小模型卡的**非思考**视觉表；都是官方报告，不是项目实测，各指标不是逐字准确率。

| 模型 | CC-OCR | OmniDocBench v1.5 | OCRBench | CharXiv | ScreenSpotPro |
|---|---:|---:|---:|---:|---:|
| Qwen3.5-0.8B | 66.7 | 70.6 | 79.1 | 38.2 | 46.5 |
| Qwen3.5-2B | 75.8 | 80.9 | 85.4 | 52.6 | 54.5 |
| Qwen3-VL-2B基线 | 68.3 | 65.9 | 79.2 | 37.1 | 48.5 |
| Qwen3-VL-4B基线 | 73.8 | 80.0 | 80.8 | 50.3 | 59.5 |

这支持优先验证2B而不是直接上更大模型，也显示屏幕定位并非接近100%，不能当自动点击可靠性保证。0.8B更小但图表等明显落后，不承诺中文阅读生产合格。官方提示小Qwen3.5思考模式可能循环/不终止，必须设token上限、超时、取消；长原生上下文不代表低资源下适宜全部开启。

[InternVL3.5原始论文表4](https://arxiv.org/html/2508.18265v1)：1B DocVQA test85.6、ChartQA77.7、OCRBench795/1000；2B DocVQA89.4、OCRBench836。不得与SmolVLM的val、Qwen表的归一化OCRBench不加说明横比。[Qwen3-VL视觉报告](https://arxiv.org/html/2511.21631v2)不是Qwen3语言报告。

PaddleOCR-VL-1.6官方报告 OmniDocBench **v1.6 96.33**；旧1.5模型常列**v1.5 94.5**，基准不同，不能相减声称提升1.83，也不能同上表v1.5直接排第一。重点应测试能否正确抽取本项目金额、行列关系、脚注和公式。

## 8. 推荐的首轮实验组合

| 场景 | 优先验证 | 失败后的升级/替代 |
|---|---|---|
| 普通正文咨询 | 正文/选区/页段提取+现有文本Agent，不调用视觉 | 权限不足则请求分享；图表/扫描页再走下两项 |
| 手机图片、小字、艺术图像问答 | Qwen3.5-0.8B 对照2B；默认候选偏2B，0.8B通过门槛再降档 | InternVL3.5-1B/2B对照；困难材料升级4B/更强服务，征得外发授权 |
| 扫描PDF/表格/公式 | PaddleOCR-VL-1.6按需解析+主Agent引用原页 | 原图裁块重读/更强模型/人工确认，不让OCR结果无引用覆盖原文 |
| PC界面指导 | Qwen3-VL-4B 与 Qwen3.5-2B 同测，工具/可访问性结构优先 | 难例更大视觉服务；陈旧画面先重新获取，不盲目放大模型 |
| 松开转文字 | Paraformer220M / SenseVoice234M / Whisper-small同测，以Qwen3-ASR约0.9B挑战 | 换更强ASR或让用户编辑，不静默切直接音频 |
| 松开发音频 | 研究Omni3B；商业Omni7B与MiniCPM-o4.5比较 | 能力不足明示，用户选择重录/改文字；不能偷偷只转写 |

这是组合实验，不要求同时部署所有候选。发布选择以同一冻结集的正确性、许可、峰值内存、p95延迟和成本共同决定。外部App范围已确认、Android优先；具体RAM/性能分档由开发兼容测试承担，不要求用户提供机型。是否全离线、商业分发与性能预算仍需在选型时明确，不能给出唯一已验证最优解。

## 9. 主要官方出处与复核边界

- 音频：[Qwen2.5-Omni 7B卡](https://huggingface.co/Qwen/Qwen2.5-Omni-7B)、[3B许可原文](https://huggingface.co/Qwen/Qwen2.5-Omni-3B/blob/main/LICENSE)、[MiniCPM-o4.5卡](https://huggingface.co/openbmb/MiniCPM-o-4_5)、[Qwen3-ASR卡](https://huggingface.co/Qwen/Qwen3-ASR-0.6B)、[Whisper官方仓库](https://github.com/openai/whisper)、[SenseVoice卡](https://huggingface.co/FunAudioLLM/SenseVoiceSmall)、[Paraformer卡](https://huggingface.co/funasr/paraformer-zh)。
- 视觉：[Qwen3.5-0.8B卡](https://huggingface.co/Qwen/Qwen3.5-0.8B)、[2B卡](https://huggingface.co/Qwen/Qwen3.5-2B)、[Qwen3-VL-4B卡](https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct)、[PaddleOCR-VL-1.6卡](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6)、[InternVL3.5报告](https://arxiv.org/html/2508.18265v1)、[SmolVLM-500M卡](https://huggingface.co/HuggingFaceTB/SmolVLM-500M-Instruct)。
- 手机：[Android MediaProjection](https://developer.android.com/media/grow/media-projection)。

模型许可须在下载/上线时固定revision再次审查，模型卡元数据不能替代冲突的许可证正文；Apache/MIT也不免除第三方素材、用户数据和组件义务。当前只是官方资料核读与设计，不是法律意见或装机性能报告。用户已确认实施顺序：双路径语音→Android跨App阅读→最小合格模型评测→会话与双反馈；首轮不要求全模型手机本地运行。先做最小技术验证，再扩量，不直接全量改产品。
