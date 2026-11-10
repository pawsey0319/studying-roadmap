# 本地媒体服务与可复现评测

## 当前结论（不是统一验收通过）

- M2 / 16GiB / macOS26.6.2：已下载并校验 Whisper-small MLX 481,307,592-byte 权重，完成真实本机 ASR请求 synthetic smoke 4/4（3条语音进入模型，1条数字静音由显式低振幅guard直接返回空串，不计模型推理）；中文原始字形/数字CER仍高，不能据此判语义错误，也不代表正式合格；3条合成语音文本语义逐条核对保留（非真人听辨/统计准确率），见 `results/asr-semantic-smoke-review.json`。未用现有商业服务推理。
- `results/local-media.json` 保留首轮强制中文的失败发现（英文输出中文）；已修正为自动语言、明确transcribe；最终看 `results/local-media-final.json`。中文输出繁体与阿拉伯数字，报告仅NFKC+去标点CER，不偷偷繁简或数字归一化。不能把CER格式差当语义正确，也不能把修正后的英语运行当跨语言正式验收。
- Qwen2-Audio-7B-Instruct-4bit约6.575GB（不是README声称4.2GB）；下载8分钟仅352MiB，已停止。当前available约3.90GiB，低于服务8GiB保守gate。直听未实测、未启用、无ASR静默回退。Omni3B非商业默认禁用。
- 真视觉已跑：Qwen3.5-0.8B-MLX-4bit读非私密中文合成计划卡，load1.850s/inference3.671s，MLX peak1,042,834,994bytes约0.97GiB；严格字段诊断发现“英语口语”被概括成“英语”，因此该卡不是4/4精确通过，绝非benchmark通过。见 `results/local-vision.json` 与后续开发集评分。音频服务已退出后串行运行。
- 安全/协议8项单测使用明确 FakeBackend，绝非模型实测。测试包含认证、CORS、整体大小、时间上限、损坏媒体、禁止URL、schema、直听不调用ASR、未配置直听fail closed。
- 合成素材为macOS内置Tingting/Samantha，完全非私密；不代替真人、噪声、口音、Android真机、240例dev/frozen与长期稳定性验收。

## 已替用户完成安装和配置

项目隔离 `.venv` Python3.11.16；实际版本在 `requirements-media.lock.txt`。公开PyPI直连下载极慢，清华镜像成功，未改全局pip配置。模型在仓库外 `~/.cache/learning-hub/models/`，不会入库。

```bash
# 已在本机执行；不会输出密钥。
.venv/bin/python tools/run_media.py --init-only
# 前台/由宿主managed background管理启动。停止按Ctrl+C，绝不装常驻daemon。
.venv/bin/python tools/run_media.py
```

启动器自动创建 `~/.config/learning-hub/media.env` 和 `~/.config/learning-hub/media-browser.json`，权限0600，随机token不打印。浏览器在本机显式导入后者即配置ASR，无需选模型/填字段。该JSON含本地token，**不得分享、提交仓库或上传**。默认只包含已跑通ASR，不包含未验证audio。只监听127.0.0.1:8790；默认CORS仅localhost/127.0.0.1:8000与8811，需要对实际UI origin作精确白名单而非 `*`。

## 独立视觉服务（已安装，无需重选模型）

先停止ASR服务，再执行 `.venv/bin/python tools/run_vision.py`，仅监听127.0.0.1:8791；与ASR服务入口共享进程级排他锁，禁止并发驻留加载。服务使用同一本机私有env token，不增加浏览器preset字段。`GET /health`、`GET /v1/models` 均鉴权；`POST /v1/chat/completions` 模型 `local-vision`，单user文本+`image_url:{url:'data:image/png;base64,...'}`；允许可选system文本；当前是独立单图工具协议，不支持含assistant历史的多轮普通chat，遇到历史会明确400拒绝，绝不擅自截断。只接受inline PNG/JPEG/WebP，拒绝远程URL，10MiB/12MP/15MiB请求、512token上限，最多一个请求推理。stream:true返回完整JSON，与现有adapter兼容。

真实HTTP结果见 `results/local-vision-service.json`：HTTP200，8811明确CORS，单例6.331s（包括首次加载），MLX peak1,072,250,248bytes，答案同离线单例且仍漏“口语”细节。图像解析与模型推理不具有可强制中止的进程级SLA，不应公开暴露。新增4条视觉FakeBackend合同测试，总12条安全/协议测试；不计模型质量验收。

## 全新环境复现（已装机器不用再执行）

```bash
uv venv --python 3.11 .venv
uv pip install --python .venv/bin/python -r eval/requirements-media.lock.txt
.venv/bin/python tools/setup_media.py
# 官方HF若网络不可用，可显式选择公开镜像；大权重LFS SHA256校验不变。
HF_ENDPOINT=https://hf-mirror.com .venv/bin/python tools/setup_media.py
.venv/bin/python tools/eval_media.py --prepare
.venv/bin/python tools/run_media.py
```

另一个本机终端加载私有env（不打印），执行评测：

```bash
set -a
source ~/.config/learning-hub/media.env
set +a
.venv/bin/python tools/eval_media.py --output eval/results/reproduced-media.json
.venv/bin/python -m unittest discover -s tests -p 'test_media_service.py' -v
```

`eval_media.py`仅允许localhost/127.0.0.1，绝不读取cloud LLM配置；fixtures固定SHA256，模型失败不会变成mock通过。生成语音命令要求系统已安装Tingting/Samantha；当前机器已确认。`--direct-audio`仅对独立波形模型请求，不接转写文本。所有推理/下载有边界；推理本身在单worker线程，token512上限，**不具强制进程级推理超时**，不应公网暴露。需要硬SLA时另加可终止worker隔离。

## 接口与安全边界

- Bearer token最低24字符，constant-time比较；`/health` 与 `/v1/models` 同样需认证。不记录请求/音频/凭据，access_log关闭，临时文件自动清理，响应no-store。
- `POST /v1/audio/transcriptions` multipart模型 `local-whisper`、file；`POST /v1/chat/completions`模型 `local-audio`，单user消息text+base64 WAV/MP3。前端stream:true也兼容JSON结果。
- 10MiB音频、60秒、15MiB整体请求上限，包括chunked请求；解码ffmpeg限制格式与协议，仅本地file/pipe，不接受任意URL或命令。
- `/health`返回 `{service,ready,capabilities:{asr,input_audio},models:{asr,input_audio},limits:{audio_bytes,audio_seconds},validation:{asr,input_audio}}`。ready仅进程配置就绪，非质量验收，audio能力也不等于质量合格。

## 选型证据（官方来源）

- Whisper代码/模型MIT：<https://github.com/openai/whisper>；MLX实现：<https://github.com/ml-explore/mlx-examples/tree/main/whisper>。
- MLX Audio Qwen2-Audio真实音频路径：<https://github.com/Blaizzy/mlx-audio/tree/main/mlx_audio/stt/models/qwen2_audio>；16k波形→128通道mel→音频encoder→embedding→LLM，不是ASR+文本。量化权重Apache2模型卡：<https://huggingface.co/mlx-community/Qwen2-Audio-7B-Instruct-4bit>。
- llama.cpp多模态支持与Qwen2-Audio量化质量警告：<https://github.com/ggml-org/llama.cpp/blob/master/docs/multimodal.md>；Ultravox1B可作后续小候选，但中文能力和Llama基模条款尚未逐条验收，不把MIT量化卡当完整许可。
- Paraformer中文220M，候选revision卡Apache2：<https://huggingface.co/funasr/paraformer-zh>，约889MB未下载；SenseVoice234M约944MB模型卡自定义许可，**不是代码Apache2就推断权重可商用**：<https://huggingface.co/FunAudioLLM/SenseVoiceSmall>。两者本轮均非实测。
- MLX-VLM官方Qwen3.5支持：<https://github.com/Blaizzy/mlx-vlm>；视觉最小0.8B4bit模型约652MB，Apache2：<https://huggingface.co/mlx-community/Qwen3.5-0.8B-MLX-4bit>。

agent-reach官方资料路由核对已执行；本机agent-reach1.5.0检测最新1.6.1，仅提示未自动升级。没有把第三方网页指令当系统指令。

## 追加：Ultravox 1B 直接音频实验路径（真实链路已跑，质量未通过）

- 官方llama.cpp支持 `ggml-org/ultravox-v0_5-llama-3_2-1b-GGUF`，固定revision `5390c7c41cbd6f261f7f205fc0c5ae61bbdca650`；Q4文本权重807,694,464bytes + f16音频encoder/projector1,371,123,616bytes，总2,178,818,080bytes。模型是真实波形→Whisper encoder→adapter→Llama，并不把ASR文字送文本模型。zh模型卡标签不是中文质量保证。
- Built with Llama。Ultravox组件MIT，底座仍适用Llama 3.2 Community License与AUP（包括分发归因、700M MAU例外），许可/NOTICE见 `licenses/`；不可把量化卡MIT当无条件许可。官方来源：<https://huggingface.co/fixie-ai/ultravox-v0_5-llama-3_2-1b>、<https://github.com/meta-llama/llama-models/tree/main/models/llama3_2>。
- `tools/setup_llama_runtime.py` 隔离安装官方arm64 b12244、SHA256固定校验；无需brew，不改全局。`HF_ENDPOINT=https://hf-mirror.com .venv/bin/python tools/setup_media.py --ultravox` 下载固定双文件，curl支持partial续传；最后校验总长与LFS SHA256后才写完成manifest。服务拒绝无manifest权重。
- 现7B在全部模型退出后available重测约4.09GiB仍<8GiB gate，故没有加载。Ultravox Q4文本权重807,694,464bytes与projector1,371,123,616bytes已完成LFS校验，证据见 `results/ultravox-download-evidence.json`。真实4/4 HTTP直听smoke已运行但质量不合格：中文字段提取无声音/幻觉，英文指令未稳定遵循，静音出现大段自述；不启用audio preset。
- `tools/run_ultravox.py` 为直接音频独立实验入口：外8790复用认证/精确CORS/大小/解码边界；内8792仅127.0.0.1+随机token、offline、单slot、ctx1024、输出128token。只向内部送经过本地解码的PCM16 WAV，没有ASR调用。30s/256字符prompt/128token明确拒超限，关闭context-shift，不截历史。
- 3.5GiB启动gate基于2.03GiB权重+约1.5GiB KV/激活/余量，仅实验估算非实测保证；运行/启动available<512MiB终止。启动最长60s，退出/异常/信号finally停止并收集内部子进程；stop_child对已退出进程也wait，终止超时则kill并再次有界wait。真实轻量POSIX子进程已验证退出/终止/忽略SIGTERM后的回收，但不是模型推理取消SLA；低内存watcher仍即时terminate。不声称HTTP取消能立即中断内部推理。
- 追加真实任务prompt复核见 `results/local-ultravox-task-smoke.json`：时间问答只答“下午三点”漏“明天”；学科/时长问答答对英语口语/二十分钟。1.433/1.965s，llama子进程RSS约2.17GiB（外层Python RSS与mlx_peak=0不代表模型总内存），运行后available约2.22GiB。该两例仍不构成质量通过；全部临时服务已退出。RSS为每条响应末尾的child瞬时采样，不是进程树总量或运行峰值；外层RSS不含llama全部驻留内存，mlx_peak=0也不代表零内存。历史两例响应中的finish_reason=stop来自修复前网关固定值，不是模型自然结束证据；保留原文件，不据此排除128token截断。
- 元数据协议修复（未重跑模型）：网关不再固定finish_reason=stop；Ultravox实际HTTP响应和原生结果仅白名单透传已知结束原因、非负整数用量及限长拒绝说明，未知原因null、未知用量{}。旧字符串后端保留正文但不能证明自然结束。空正文且无拒绝或明确非自然结束证据时502；协议测试不是质量通过，历史结果不补写。
- 此入口 **只直听，不提供ASR**，health.asr=false；与ASR/vision共享排他锁。同8790切换意味着旧stt preset在此服务运行时不可用，必须停止后启动run_media恢复ASR；不宣称两模式已统一可用。UI/provider现已支持显式audioMaxTokens/audioContextChars/audioMaxSeconds预算并在超限时拒绝，通用默认2048不变；该协议适配不代表模型质量通过，现仍禁止添加或启用Ultravox audio preset。
