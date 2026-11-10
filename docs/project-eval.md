# 项目视觉开发评测（LH-005）

## 数据与结论边界

本轮固定24张 **人工编写的合成开发卡**，不是公开数据、真人采集或冻结验收集。分6类：细粒度学习信息/更正、数字单位、否定例外、信息缺失、来源与时效、小字技术/公式。每张4个字段，共96字段；缺失字段必须为null。答案是作者定义，尚未独立复核。中文字体为macOS STHeiti，字体仅在本机渲染使用、不随项目分发。

- 固定样本：[manifest](../eval/fixtures/zh-reading-dev-v1/manifest.json)，记录PNG SHA256、900×520像素、字体大小/字体哈希、Pillow版本、类别、逐字段原文与行定位。
- 工具：[eval_project.py](../tools/eval_project.py)；测试：[test_eval_project.py](../tests/test_eval_project.py)。不修改原单卡工具及其历史结果。
- 正式目标仍是240例（ASR/直接音频/阅读视觉/PC场景各60）；当前正式已验收样本0，冻结集0，真人0，公开许可集0。这24例不抵充正式配额。ASR/直接音频能力不能用视觉结果替代。
- 正式集须另行获取许可/真人明确同意、独立参考答案复核、开发与冻结集先拆分后调优、受限访问冻结集；记录噪声口音、数值否定、艺术公式、真实PC遮挡高DPI陈旧来源等覆盖，不能将本轮普通卡片声称为真实设备分布。

## 离线使用（不加载模型）

从项目根目录运行，使用已有 `.venv`，不使用系统Python。固定24PNG已经生成。重新生成必须指定全新目录；同Pillow/字体环境下测试验证像素hash可复现，跨平台字体不同不得静默视为同输入。

```bash
.venv/bin/python tools/eval_project.py prepare --directory /tmp/zh-reading-new
.venv/bin/python -m unittest discover -s tests -p test_eval_project.py -v
.venv/bin/python tools/eval_project.py score \
  --manifest eval/fixtures/zh-reading-dev-v1/manifest.json \
  --responses /path/to/explicit-run.jsonl --output /path/to/new-score.json
```

所有写入采用排他新建，不覆盖历史结果。score无网络。响应JSONL每行包含：

```json
{"id":"study-specific","manifest_sha256":"整个manifest文件的SHA256","image_sha256":"该卡PNG的SHA256","text":"{\"fields\":{\"科目\":{\"value\":\"英语口语\",\"locator\":\"L2\"}}}","run_metadata":{"model_id":"实际模型","revision":"实际revision"}}
```

示例仅展示一字段；真实回答必须包含指定的全部四字段，不接受额外字段、markdown、模型评分。value逐Unicode字符严格比较（保留限定词、数字、单位、否定），locator严格比行号。格式/语义可分看schema_correct与value_correct/locator_correct；严格匹配不等于完整语义质量，合理同义改写在本提取任务仍计错。请求错误是request_error/passed:null，不是模型答错；没有响应为not_run/passed:null。总体passed永远null、production_eligible为false，即使24张开发卡全对也不能宣称生产合格。评分新增termination=stop/non_stop/unknown：明确非stop结束时保留字段正确率诊断，但该例passed=false；缺失/null结束原因只记unknown，保持历史字段诊断兼容，不从正确答案或token计数推断自然结束。不重写历史评分或补填不存在的结束证据。

不要用人工抄答案响应伪造模型表现。测试中的完美/错误答案只验证评分器本身，不保存为真实推理结果。

开发提示对照汇总见 [v1/v2比较](../eval/results/vision-prompt-comparison-v1-v2.json)：两个提示各24次真实推理均0/24严格通过，v2不能称为质量提升。下一档模型应沿用原图与原评分器，并在正式冻结验收前确定提示，不能依样本逐条改答案或规则。

## 既有0.8B遗漏诊断

```bash
.venv/bin/python tools/eval_project.py diagnose-legacy \
  --result eval/results/local-vision.json --image eval/fixtures/study-card.png \
  --output /path/to/new-legacy-diagnostic.json
```

已保存 [旧单卡离线严格诊断](../eval/results/legacy-vision-strict-diagnostic.json)：原始输出“英语”遗漏参考“英语口语”的“口语”，完整字段只对3/4，field_check_passed:false。原先4个子串true只表示宽松字符串命中，不能证明字段完整。诊断验证旧图hash，保留旧结果不改；它没有调用新模型，也不是24卡新批次。原输出无行定位，因此locator_passed:null；behavioral_passed:null，不推导生产结论。

## 真实视觉开发批次与提示版本

已串行运行24卡真实0.8B视觉开发批次，服务退出并回收；未并发运行ASR/直接音频。响应见 `eval/results/vision-dev-24-v1.jsonl`，严格评分见 `eval/results/vision-dev-24-score-v1.json`：24/24请求获得输出，但0/24满足完整JSON结构、精确值和行定位联合要求。不能将结构解析失败造成的0/96可评分字段说成文字全部识别错误。独立只读诊断 `eval/results/vision-dev-24-diagnostic-v1.json` 明示移除精确markdown围栏、接受平面JSON、忽略定位：15张可解析卡的60/60值精确匹配，其余9张不在该分母；该宽松诊断不改变严格失败。请求延迟p50 1.0829s、p95最近秩1.9418s，包含首请求冷加载但仅24个合成开发样本。结论是结构/行定位指令遵循不合格，不是正式生产准确率。工具本身不加载权重、不启动服务，后续批次仍须串行协调。

```bash
.venv/bin/python tools/eval_project.py infer \
  --manifest eval/fixtures/zh-reading-dev-v1/manifest.json \
  --endpoint http://127.0.0.1:8791/v1/chat/completions \
  --metadata /path/to/actual-model-metadata.json \
  --token-env EXPLICIT_LOCAL_VISION_TOKEN --output /path/to/new-run.jsonl
```

metadata必须包含非空字符串：model_id、revision、quantization、hardware、framework（含版本）、license、input_policy（含像素/裁块策略）。工具固定temperature0、max_tokens512、同一提示版本，内联PNG；输出每行样本/manifest/prompt hash、完整输出和耗时。必须填写真实服务模型信息，不用路径名猜revision；许可仍需独立审查。只允许显式localhost HTTP、拒绝重定向/URL凭据/查询参数、不使用代理，不读取全局收费配置。token只读取显式指定环境变量，不写结果。超时1–120秒，每响应上限256KiB；没有URL工具或shell执行。换模型保持同样图片、裁块策略、提示和预算，分别保留新响应及评分报告。

独立v2实验可显式传 `--prompt-version strict-fields-locators-v2`，默认仍为v1；v2仅由requested_fields构造空JSON结构，不读取reference答案。固定原始Unicode/缺失null/正文同名字段而非L1标题的指令更明确，评分器未改。真实v2批次已完成并回收服务：`eval/results/vision-dev-24-v2.jsonl`及`vision-dev-24-score-v2.json`仍为24/24请求返回、0/24严格通过；输出仍为markdown围栏及L行号→文本的平面对象，而不是要求的fields/value/locator。此次提示调整未解决输出契约，不能标为改进成功。该实验在同一开发集调参，不是冻结集验证；v1输出不覆盖。离线文本tokenizer模板探针确认测试指令保留、图像token在前且输出显式空think段；没有发现模板直接丢提示的证据。直接AutoProcessor探针因环境缺Torchvision而失败（服务内MLX加载路径已完成真实推理），随后直接复用了实际 `mlx_vlm.load` 完整加载路径，成功获得Qwen3VLProcessor，完整processor模板也逐字保留v2提示，证据 `eval/results/vision-template-fullprocessor-v2.json`。直接AutoProcessor的失败仅属于不同初始化路径，不能据此认定运行服务缺依赖；无需额外安装依赖。该模板探针不生成回答，不能证明模型遵循指令。首次v2启动因测试脚本未给health附token而超时，已回收服务；这是鉴权探测错误，不是模型失败，修正后重跑。

本工具记录单请求耗时。后续响应若含服务端evidence，仅白名单保存非负有限数值inference_seconds/process_rss_bytes/mlx_peak_bytes，标记为server_reported_resources；这是服务自报而非独立采样。旧v1/v2没有保存该信息，不回填猜测。finish_reason也仅记录服务端已知枚举，不推断实际是否耗尽token。历史v1/v2运行时本机vision_service固定返回stop，未提取真实结束原因，历史字段不能排除512 token截断，不回填或改写评分。现已保留MLX GenerationResult并透传真实finish_reason和usage计数；无元数据时记录null/空usage，不凭计数推测原因。已安装mlx-vlm0.7.12先判EOS再判循环耗尽，因此EOS恰在输出上限时仍是stop；新增3项FakeBackend HTTP回归覆盖该情形、真实报告length与未知/非法元数据。此修复仅有协议测试，尚未重跑真实模型，不能补证历史自然结束。另补不加载权重的LocalVision适配层测试，确认原生结果对象未被.text提前剥离；评测JSONL以server_reported_usage白名单保留非负整数prompt_tokens/completion_tokens/total_tokens，排除bool/负数/额外字段，缺失不猜测，未知原因仍不由计数推断。后续真实批次仍须独立资源测量、许可证复核和延迟分位数，方可与正式验收目标比较。
