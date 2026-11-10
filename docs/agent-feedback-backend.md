# 质量反馈与候选记录后台（LH-006 / LH-007）

日期：2026-11-10。范围沿用既有 [PRD](<PRD.md>) LH-006/007；只新增迁移、静态回归、本说明，不改前端。

## 当前完成与未完成

提供 [增量 SQL](<../cloudbase/agent-feedback.sql>)，与现有 [反馈客户端](<../src/ai/feedback-client.js>) 的八个 RPC 名称、参数名一致。**未部署、未连接真实 CloudBase 数据库，未验证其 API 暴露/角色配置；静态回归通过不代表真实鉴权/RLS 验收。** 没有收费调用、提交或发布。

不实现可信评估系统：任何 `evaluate` 都返回 `EVALUATOR_NOT_CONFIGURED`；任何 `approve` 都返回 `TRUSTED_EVALUATION_REQUIRED`。前端提供的 `evaluation`（包括 `passed`）不能产生可信结果。普通候选只能到 candidate → reviewed / rejected，因此新安装正常链路无法到 approved/canary/released。后续可信评测需独立设计、迁移及验收，不可在浏览器填 passed 解锁。

## 契约

RPC 仅 authenticated 可执行，全部 security definer、固定 pg_catalog search_path、显式 auth.uid() 校验。CloudBase 用户 ID 使用 varchar(64)，不是 UUID。

|RPC|参数|返回|
|---|---|---|
|agent_feedback_submit|p_payload jsonb|{id,status}|
|agent_feedback_list|无|{feedback: [...]}，仅本人|
|agent_feedback_delete|p_id text|{id,deleted:true}，逐条本人所有权|
|agent_feedback_admin_list|无|{feedback: [...]}，管理员|
|agent_feedback_review|p_id text, p_status text|{id,status}，管理员；reviewed/rejected|
|agent_release_list|无|{candidates: [...]}，管理员|
|agent_release_candidate|p_candidate jsonb|完整候选，管理员|
|agent_release_advance|p_id text, p_action text, p_options jsonb|完整候选，管理员|

反馈主键由账号和客户端预览 ID 组成，同时 ID 全局唯一以适配管理员仅传 p_id 的客户端。重复提交不覆盖，唯一冲突返回数据库错误。所有权不接受前端声明；删除无权或不存在均报 FEEDBACK_NOT_FOUND。反馈物理删除包括其 payload/consent；本版没有样本、媒体或外部供应商存储，不宣称清除不存在的下游数据。私有会话 sessionId 只是用户同意分享的定位文本，不代表服务器已认证该本机会话。

## 白名单与边界

payload 必须且只能含 schema/id/sessionId/spec/at/fields/material/consent；schema 固定 lh-quality-feedback/1。fields 不重复且仅 rating/reason/note/excerpt/context/sourceTitles，material 的实际键必须完全相同；consent 必须且只能含 confirmed=true、对应 previewId、与 fields 完全相同的数组（含顺序）。

ID 为 ASCII 字母数字与 `_.:-`，1–100 字；sessionId 可空。spec 1–100 字。at 为 0–9007199254740991 的 JSON number。rating 仅 up/down；reason/note/context 600 字、excerpt 1000 字；sourceTitles 最多8条，每条120字；总 payload UTF-8 JSON 上限16KiB。未知字段、嵌套对象、媒体字段、data:/blob:/base64 标记拒绝。文本白名单不是自动脱敏器，也无法判定任意普通文本是否描述隐私；用户仍需预览并清除敏感内容。

候选只接收现有 createReleaseCandidate 的完整结果；state 必须 candidate，evaluation=null、rollout=0、productionCredentials=false，初始 history 仅 action=candidate/at。未知键（包括 role/admin/passed）拒绝。初始及后续 history 的 actor/time 由数据库写入，不信任客户端时钟。

advance 只允许 options 的 at/evaluation/rollout/previousReleaseId；非 null evaluation 拒绝，passed 等额外键拒绝。review/reject 依合法状态变更。保留 canary/release/rollback 记录逻辑，仅可作用于由未来可信迁移或 SQL 控制台预置的合法状态，**不会执行任何真实部署或配置写出**。canary 要求1–99整数且不递减、上一目标存在且 released、不可自身、开始后不能偷换回滚目标；release 记100%；rollback 记目标及“仅回退后续配置，不撤销已执行的数据变更”。行锁串行化状态变更，独立 audit 同事务保留 actor、旧/新状态和数据库时间；异常事务不写成功审计。

## 权限与人工操作（本次没有执行）

在 CloudBase SQL 控制台以可信数据库所有者审查并执行迁移。依赖已有 auth.uid()、anon/authenticated 角色；函数和表必须由可信控制台所有者持有，不能将 definer owner 交给客户端角色。private helper schema 撤销客户端 USAGE/EXECUTE；四张表启用默认拒绝 RLS，无客户端 policy，并撤销 PUBLIC/anon/authenticated 全部表和审计序列权限。仅八个 public RPC 单独开放 EXECUTE，不通过 JWT role 元数据、前端 admin 开关或可写配置鉴权。

管理员只能由可信 SQL 控制台人工授予/撤销，**没有授予管理员的 RPC，也不会自动将首位调用者升级**：

```sql
-- 先从可信账号记录核实 CloudBase 文本用户ID；不要填浏览器自行声称的身份。
insert into public.agent_feedback_admins(user_id) values ('verified-cloudbase-user-id');
-- 撤销：
delete from public.agent_feedback_admins where user_id = 'verified-cloudbase-user-id';
```

不要向 authenticated 授予这些表的直接写入或序列权限；不要为“解决权限错误”增加宽松 policy。保持 agentFeedbackEnabled 默认关闭；真实数据库验收后才由维护者单独决定启用。候选/审计没有生产凭据、webhook 或部署执行器。

## 验证

[静态测试](<../tests/feedback-schema.test.js>) 可用 `node --test tests/feedback-schema.test.js` 运行：锁定8个RPC签名、varchar auth UID、definer鉴权、私有RLS/撤权、本人删除、SQL-only管理员、白名单/长度/consent、候选禁提升、evaluate/approve fail-closed 和回滚审计。它检查SQL源结构而非运行SQL，不能证明查询实际权限、安全上下文或CloudBase兼容性。

补充本机验证：使用仓库外 `/tmp` 隔离安装的 `@electric-sql/pglite@0.5.16`（WASM PostgreSQL），模拟 varchar auth.uid() 与 anon/authenticated 角色，实际执行完整迁移及重复执行均成功。实测匿名调用拒绝、用户A/B隔离、四表直接 SELECT/INSERT/DELETE 均拒绝、普通账号管理拒绝、管理员收件箱/审核权限、管理员不能删A反馈、本人可删除、未知字段/媒体标记/超长/错误同意/重复fields拒绝、候选提升拒绝、evaluate/approve fail-closed、review/reject及3条候选审计通过。可复跑脚本已保存在 [PG回归工具](<../tools/check_feedback_pg.mjs>)；使用独立临时依赖运行：`PGLITE_MODULE=file:///tmp/lh-feedback-pgcheck/node_modules/@electric-sql/pglite/dist/index.js node tools/check_feedback_pg.mjs`。依赖未加入项目。这是实际PG引擎上的模拟鉴权测试，**不是CloudBase真实认证、PostgREST或部署验收**。全仓 `node --test tests/*.test.js` 144/144通过。

上线前必须在隔离的真实 CloudBase PG 以匿名、用户A/B、管理员逐项验证：匿名RPC/直接表读写均拒绝；A的列表不含B且不能删B；管理员仍不能删别人的反馈；普通用户不能管理/授予角色；恶意未知字段/媒体/超限/不同意/错 previewId/错 fields 被拒绝；伪造passed和候选approved不生效；合法提交/审核/撤回、并发状态、回滚目标校验及审计原子性。还需验证迁移重复执行、权限默认值、函数owner和PostgREST schema cache。尚未完成这些真实数据库验收。
