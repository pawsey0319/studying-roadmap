# LH-005：0.8B失败后的下一档视觉对照

日期：2026-11-10。状态：2B指令模型固定权重已校验；单图HTTP推理尝试触发资源保护而停止，未获得可评分答复，未运行24卡批次。此记录为研发选择，不是用户新增需求或生产选择。

## 依据与选择

当前Qwen3.5-0.8B在同一24卡开发集、v1和v2提示上均0/24严格通过。完整MLX processor模板已验证原样保留指令。输出存在格式/来源定位问题，不等于全部文字识别错误；不能靠清理围栏改写严格结果。

下一实验优先选择明确命名的 **mlx-community/Qwen3-VL-2B-Instruct-4bit**，而非直接采用基础模型身份待核实的2B候选。选择理由是需要验证指令型模型能否遵循字段＋行定位契约，不是声称其一定更准确。

## 只读网络证据与未决点

- mlx-vlm 0.7.12源码固定提交：[官方tag对应源码](https://github.com/Neywa-Labs/mlx-vlm/tree/7230940302cbe602054650f18a2f77db945bc57a)，含qwen3_vl与qwen3_5实现。[PyPI版本元数据](https://pypi.org/pypi/mlx-vlm/0.7.12/json)直接示例Qwen3.5-2B-4bit。架构存在不等于具体权重运行成功。
- [Qwen3-VL-2B-Instruct-4bit镜像API](https://hf-mirror.com/api/models/mlx-community/Qwen3-VL-2B-Instruct-4bit?blobs=true)：固定revision `9c4f5209e57b31f4b9dfba735de3fb983739c9cc`；权重1,782,040,921 bytes；仓库文件合计1,798,023,774 bytes；卡片标Apache-2.0。尚需下载时复核文件SHA256、许可与模型卡，未核验运行表现。
- [Qwen3.5-2B-4bit镜像API](https://hf-mirror.com/api/models/mlx-community/Qwen3.5-2B-4bit?blobs=true)：revision `674aaa7240b91e8012fcad5d791b7dfe5ba90207`；权重1,722,271,785 bytes，LFS SHA256 `713fe7e5d3c3965f7106b0d0ee17615f7869c23c8d327996df8c1196fbcf07d5`；全12文件1,749,081,927 bytes。但cardData.base_model写 `Qwen/Qwen3.5-2B-Base`，与指令用途存在身份疑点；本轮README/config/权重附带LICENSE获取失败，不静默认作Instruct。
- HF官方API本轮连接reset，Jina超时；上述大小与revision来自显式镜像，不能描述为官方独立直连核实。官方[Qwen3.5代码仓库LICENSE](https://github.com/QwenLM/Qwen3.5/blob/main/LICENSE)为Apache2，但代码许可不替代具体权重附带条款。

### 补充候选（不改变本次指令型对照）

镜像还存在不同的准确repo `mlx-community/Qwen3.5-2B-MLX-4bit`，revision `93760be4f1f69842a46bc13dbdc0f19e291392a3`，cardData.base_model为 `Qwen/Qwen3.5-2B`（无Base），含Qwen3_5ForConditionalGeneration及chat template。它不是上面身份有疑点的同名近似repo；不能把一个repo的疑点推给另一个。此候选仅缓存元数据，尚未拉取文件/核验许可/运行，不影响先做明确Instruct独立对照的选择。

## 下载与单图实测结果

下载证据：[固定2B文件校验](../../../eval/results/vision-2b-instruct-download-evidence.json)。15个实际选中文件共1,798,022,204 bytes；镜像metadata总和包含未选文件，不能与实际下载字节混用。2个LFS SHA256与13个普通文件git blob SHA1匹配。README源模型明确为Qwen3-VL-2B-Instruct，配置qwen3_vl/affine 4bit/group64。固定仓库没有独立LICENSE，上游完整许可/NOTICE审查仍未完成，卡片声明不是完整商用清关。

单图实验触发 `memory_guard_stopped_experiment` 后服务器SIGTERM退出（-15），父任务退出1；已检查无残留实验进程。保护条件为可用内存低于512MiB或系统swap较启动时增长超过512MiB；初版监控未保存精确触发指标，因此不能声称是哪一项触发，也不能推断模型峰值。见[停止证据](../../../eval/results/vision-2b-instruct-smoke-stopped.json)。没有可评分答复，不算模型质量失败/通过；不降低安全阈值重试、不继续24卡、不改默认服务。

## 后续实验纪律

1. 只从公开权重下载，不读取收费服务配置；外部cache，固定revision、总长与LFS校验后记录证据。
2. M2 16GiB单模型、单请求串行；不与ASR、原音频或0.8B并发。先做单图smoke并记录RSS/MLX/内存压力，再同一24卡对照；任何内存风险停止。
3. 保留原900×520 PNG、manifest、严格评分器，v1提示作为跨模型对照；不覆盖旧响应。若改prompt须另版本，不能混作只换模型对照。
4. 模型选择与提示调整均发生在开发集，不能抵充正式240例/真人/冻结集。即使24/24正确，production_eligible仍false。
5. 不自动改默认服务、发布或声称真机通过。
