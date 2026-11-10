// 独立显式配置，不连接旧私人feedback文档，不接受前端admin开关作为权限。
import { rest, signedIn } from '../store/cloud.js';
import { authorizeQualityFeedback } from '../core/learning-session.js';
let enabled = false;
export function setupFeedback(config = {}) { enabled = config.agentFeedbackEnabled === true && (config.backend === 'cloudbase' || (!config.backend && !!config.cloudbaseEnv)); }
export const qualityFeedbackAvailable = () => enabled;
async function rpc(name, args = {}) {
  if (!enabled) throw Object.assign(new Error('质量反馈后台尚未配置或启用'), { code: 'FEEDBACK_DISABLED' });
  if (!signedIn()) throw Object.assign(new Error('请先登录'), { code: 'AUTH_REQUIRED' });
  return rest('/rpc/' + name, { method: 'POST', body: JSON.stringify(args) });
}
export function submitQualityFeedback(payload) {
  // 仅已明确批准的预览可提交；服务器再次校验白名单与授权。
  const safe = authorizeQualityFeedback(payload, payload?.consent);
  return rpc('agent_feedback_submit', { p_payload: safe });
}
export const listQualityFeedback = () => rpc('agent_feedback_list');
export const deleteQualityFeedback = id => rpc('agent_feedback_delete', { p_id: id });
export const listAdminFeedback = () => rpc('agent_feedback_admin_list');
export const reviewQualityFeedback = (id, status) => rpc('agent_feedback_review', { p_id: id, p_status: status });
export const listReleaseCandidates = () => rpc('agent_release_list');
export const submitReleaseCandidate = candidate => rpc('agent_release_candidate', { p_candidate: candidate });
export const advanceRelease = (id, action, options = {}) => rpc('agent_release_advance', { p_id: id, p_action: action, p_options: { at: options.at, evaluation: options.evaluation, rollout: options.rollout, previousReleaseId: options.previousReleaseId } });
