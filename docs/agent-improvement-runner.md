# Agent 改进候选：人工/CI 调用说明

本工具只产生**管理员离线审查用的数据**，不是自动开发/发布 Agent。没有安装或创建本机定时任务，没有修改工作流，没有运行生产模型，没有生产密钥；不会执行模型输出的 shell/patch、抓取反馈里的 URL、修改应用或自动 approve/deploy。

## 1. 输入和授权

使用 Node.js 20+（内置 fetch），无需安装依赖。在仓库根目录运行。输入与产物放在仓库外的受限目录，**不要提交包含反馈的文件**。

输入必须由有权限的管理员显式导出为 UTF-8 JSONL：每行一个 `lh-quality-feedback/1` 对象，与核心质量反馈预览/逐字段同意协议一致；不能读取旧私人 feedback、浏览器库、聊天历史或直接抓数据库。导出后管理员人工检查去标识、脱敏、删除敏感摘录，在每条记录增加 `redaction: {reviewed:true,method:"manual"}`。此声明仅表明审核操作，不证明不可能泄漏；检测器只能拦截少量明显邮件/密钥形式。

合成示例（不是用户真实数据）：

```json
{"schema":"lh-quality-feedback/1","id":"example-1","sessionId":"","spec":"unknown","at":1794268800000,"fields":["reason","note"],"material":{"reason":"来源已变更","note":"旧行号被当作当前引用"},"consent":{"confirmed":true,"previewId":"example-1","fields":["reason","note"]},"redaction":{"reviewed":true,"method":"manual"}}
```

- `id/spec/at/sessionId` 必须存在；未知历史版本保留 `unknown`，不得用当前版本替代。
- `fields/material/consent.fields` 必须完全对应，`consent.previewId` 必须等于记录 ID；`confirmed` 必须严格为 `true`。
- `material` 仅允许 `rating/reason/note/excerpt/context/sourceTitles`；不同意摘录就不要导出，不要用整段会话替代字段。
- 未知顶层字段/附件直接拒绝，整批失败，不静默丢弃未经授权的内容继续跑。删除用户反馈时，管理员依照输出的反馈 ID 同步清理关联候选/评测样本；runner 不自建长期数据库。
- 上限：输入 256 KiB、200 条、不重复 ID；模型响应 128 KiB、最多 8 项建议；请求最长 30 秒（可调低，最低 100ms）。少于 20 条显著提示证据不足，并不自动修改。

## 2. 默认离线 dry run

```bash
node tools/agent_improvement.mjs \
  --input /safe/reviewed-quality.jsonl \
  --out /safe/agent-improvement-artifacts
```

即使给了 `--endpoint`，没有 `--invoke-model` 仍不调用网络。默认只检查输入、固定评测集结构并输出空建议。不会读取 `~/.config`、浏览器/全局收费模型配置或自动探测可用供应商。

每次输出一个新目录，包含：

- `candidate.json`：候选 ID、模型 ID（dry run 为 null）、输入指纹、反馈 ID、历史 Spec 版本、JSON 建议、强制专项审核标记；不复制输入正文。
- `input-fingerprint.json`：原始 JSONL 的 SHA-256、字节数和反馈 ID。指纹用于关联输入，不是安全签名。
- `evaluation-manifest.json`：候选/固定集指纹和分层评测状态。产物文件权限为 600；管理员仍需确保目录和 CI artifact 访问策略、保留期限安全，已有输出绝不覆盖。

候选建议是**不可信文本**，不得在 shell/网页执行，也不能自动应用；即使提示词要求“prose only”，描述仍可能包含恶意代码。结构验证不证明内容安全或质量。

## 3. 显式调用模型（会向该地址发送已审核材料）

管理员自行决定供应商、数据去向、费用与授权。`--endpoint` 是完整 OpenAI-compatible chat completions URL，不会自动添加路径。仅本机 `localhost/127.0.0.1/::1` 允许 HTTP；其他地址必须 HTTPS。不允许 URL 内凭据、查询参数、fragment，不跟随重定向。

本地模型示意（需自行启动并验证兼容的服务，本工具不启动服务器）：

```bash
node tools/agent_improvement.mjs --input /safe/reviewed-quality.jsonl \
  --out /safe/agent-improvement-artifacts --invoke-model \
  --endpoint http://127.0.0.1:1234/v1/chat/completions --model YOUR_EXACT_MODEL
```

自配远程地址示意（占位符不是可用服务）：

```bash
# 在 CI secret/进程环境中自行设置 IMPROVEMENT_MODEL_TOKEN；不要把真实值写在仓库或命令参数。
node tools/agent_improvement.mjs --input /safe/reviewed-quality.jsonl \
  --out /safe/agent-improvement-artifacts --invoke-model \
  --endpoint https://YOUR_MODEL_HOST/v1/chat/completions --model YOUR_EXACT_MODEL \
  --token-env IMPROVEMENT_MODEL_TOKEN --timeout-ms 20000
```

只有显式指定 `--token-env` 才读对应环境变量；不会读取其他通用 Key。token 不落盘、不写请求日志。错误只打印通用提示，避免服务错误文本泄漏输入/凭据。上游供应商自身日志和数据保留不由本工具保证。

模型明确报告非 `stop` 的结束原因（包括预算耗尽、内容过滤、工具调用及未知值）或拒绝回答时整次失败，不因正文碰巧是合法JSON而保存候选。旧兼容接口可以省略或返回null结束原因，但这不证明自然结束，更不代表行为通过。

模型只能返回 `lh-agent-suggestions/1` 的 JSON 文本（不接受 markdown 代码围栏），建议字段为 `title/rationale/kind/description/risks/evidenceIds/evalCaseIds`，kind 为 `prompt/policy/tool_schema/test`。证据和用例必须引用本批已知 ID。拒绝额外 shell、patch、tool、self-score、passed、approve/deploy 字段和模型 tool_calls；没有工具执行循环，URL 仅作普通文本。没有任何生产服务 RPC、代码写入或发布密钥。

## 4. 评测不是“JSON 对了就质量通过”

固定集有 16 个人工定义场景，覆盖权限/撤权/新会话、陈旧来源、任务不等于掌握、真实音频不静默降级、转写留草稿、录音取消、逐字段反馈同意、注入、结果证据、手机读屏、纯本地不转云、金融敏感操作。

当前 runner **不会运行 Agent 行为回放**：

- `structural.status = completed / passed = true` 仅指 schema/同意声明/固定集覆盖和候选 JSON 合法，不代表隐私充分或行为正确。
- `behavioral.status = not_run / passed = null`，每例 `passed = null`。
- 总 `passed = null`、`releaseEligible = false`。模型的自评/“已通过”不能改变这些字段。

管理员后续需将候选实现到隔离 harness，在模拟工具中执行固定用例与更多非计算机场景，独立记录真实输入、逐例观察结果、断言、模型 revision、工具/schema/policy 版本、成本/延迟、评测者及证据指纹。不能重放真实删除/外发/付款，也不把另一个模型自评当可信通过。固定集中的自然语言 expected/forbidden 是待实现断言的验收标准，不是自动完成的断言代码。

交给发布管理服务时，只能离线**登记候选**：由管理员映射候选 ID、Spec 版本、模型 revision、摘要和 manifest 引用。此工具的评测不可作为 approve 所需的 passed=true。审批、签名、灰度、回滚由独立有权限服务和人工完成；本工具不调用核心 release API，也不产生生产钥匙。

## 5. 人工与 CI 定时接入

可以由管理员在现有 CI 的人工触发或定时触发中调用同一命令；本次**不创建任何 workflow、launchd、cron 或 scheduled task**。建议 CI 最小权限仅允许读取审核好的反馈文件、调用显式 endpoint、写受限临时 artifact，不需要仓库写入/生产密钥；不要自动提交候选或建自动合并路径。先有质量服务授权导出，再运行此工具，不能把 runner 当作绕过管理者接口的导出器。

建议节奏：每周或新增 20 条有效反馈时由 CI 调用，严重权限/隐私事件另走人工告警和禁用流程，不等待周报。此为运行建议，不是已启用调度。

```bash
node --test tests/improvement.test.js
node --check tools/agent_improvement.mjs
```

这些测试使用合成数据和本机 mock HTTP，包括无网 dry run、授权/未知字段拒绝、prompt injection 数据边界、无模型工具执行、超时/响应大小/重定向拒绝。**不是实际模型质量验收，也不证明安卓/桌面真实设备通过。**
