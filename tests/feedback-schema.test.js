// Static migration regressions only: NOT evidence of PostgreSQL/RLS runtime behavior.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createQualityPreview, authorizeQualityFeedback } from '../src/core/learning-session.js';
import { createReleaseCandidate } from '../src/core/agent-release.js';
const sql = readFileSync(new URL('../cloudbase/agent-feedback.sql', import.meta.url), 'utf8');
const client = readFileSync(new URL('../src/ai/feedback-client.js', import.meta.url), 'utf8');
const functions = [...sql.matchAll(/create or replace function ([\w.]+)\(([^)]*)\)([\s\S]*?)end \$\$;/g)];
const body = name => { const f = functions.find(f => f[1] === `public.${name}`); assert.ok(f, name); return f[3]; };
const signatures = {
  agent_feedback_submit: 'p_payload jsonb', agent_feedback_list: '', agent_feedback_delete: 'p_id text',
  agent_feedback_admin_list: '', agent_feedback_review: 'p_id text, p_status text',
  agent_release_list: '', agent_release_candidate: 'p_candidate jsonb',
  agent_release_advance: 'p_id text, p_action text, p_options jsonb'
};
test('all eight client RPCs have exact SQL argument names and hardened definer boundary', () => {
  assert.deepEqual([...client.matchAll(/rpc\('(\w+)'/g)].map(m => m[1]).sort(), Object.keys(signatures).sort());
  for (const [name, args] of Object.entries(signatures)) {
    const f = functions.find(f => f[1] === `public.${name}`);
    assert.equal(f?.[2], args);
    assert.match(body(name), /security definer set search_path = pg_catalog/);
    assert.match(body(name), /agent_feedback_private\.require_(user|admin)\(\)/);
  }
  assert.match(sql, /u varchar\(64\) := auth\.uid\(\)/);
  assert.doesNotMatch(sql, /\buuid\b|auth\.role\(\)|request\.jwt|current_setting/i);
});
test('private RLS tables and identity sequence have no direct client privileges', () => {
  for (const table of ['agent_feedback_admins','agent_feedback','agent_release_candidates','agent_release_audit']) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security;`));
  }
  assert.match(sql, /revoke all on public\.agent_feedback_admins, public\.agent_feedback,\s*public\.agent_release_candidates, public\.agent_release_audit from public, anon, authenticated;/);
  assert.match(sql, /revoke all on sequence public\.agent_release_audit_id_seq from public, anon, authenticated/);
  assert.doesNotMatch(sql, /create policy|grant\s+(?:all|insert|update|delete|select|usage)/i);
  assert.match(sql, /revoke all on all functions in schema agent_feedback_private from public, anon, authenticated/);
  assert.match(sql, /grant execute on function[\s\S]*to authenticated;/);
  assert.match(sql, /revoke all on function[\s\S]*from public, anon, authenticated;/);
});
test('every sensitive read/write checks ownership or SQL-only administrator membership', () => {
  assert.match(body('agent_feedback_list'), /where f\.owner_id = u/);
  assert.match(body('agent_feedback_delete'), /delete from public\.agent_feedback where id = p_id and owner_id = u/);
  assert.match(body('agent_feedback_delete'), /if not found then raise exception 'FEEDBACK_NOT_FOUND'/);
  for (const name of ['agent_feedback_admin_list','agent_feedback_review','agent_release_list','agent_release_candidate','agent_release_advance']) {
    assert.match(body(name), /require_admin\(\)/);
  }
  assert.match(sql, /select 1 from public\.agent_feedback_admins where user_id = u/);
  assert.doesNotMatch(sql, /(?:insert into|update|delete from) public\.agent_feedback_admins/i);
  assert.doesNotMatch(sql, /create or replace function public\.[^(]*(?:grant|admin_set|role)/i);
});
test('feedback schema is exact and consent equals actual whitelisted material', () => {
  const p = authorizeQualityFeedback(createQualityPreview({ id:'q-1', sessionId:'s-1', at:1,
    feedback:{rating:'up',note:'safe',src:['title'],spec:'v1'}, fields:['rating','note','sourceTitles'] }),
    { confirmed:true, previewId:'q-1', fields:['rating','note','sourceTitles'] });
  assert.deepEqual(Object.keys(p), ['schema','id','sessionId','spec','at','fields','material','consent']);
  assert.match(sql, /array\['schema','id','sessionId','spec','at','fields','material','consent'\]/);
  assert.match(sql, /array\['rating','reason','note','excerpt','context','sourceTitles'\]/);
  assert.match(sql, /v \?& keys and \(v - keys\) = '\{\}'::jsonb/);
  assert.match(sql, /p#>'\{consent,confirmed\}' is distinct from 'true'::jsonb/);
  assert.match(sql, /p#>'\{consent,previewId\}' is distinct from p->'id'/);
  assert.match(sql, /p#>'\{consent,fields\}' is distinct from p->'fields'/);
  assert.match(sql, /count\(distinct value\)/);
  assert.match(sql, /exact_keys\(p->'material',array\(select jsonb_array_elements_text/);
  assert.match(sql, /jsonb_array_length\(f\) > 8/);
  assert.match(sql, /valid_text\(title,0,120\)/);
  assert.match(sql, /when k = 'excerpt' then 1000 else 600/);
  assert.match(sql, /16384/);
  assert.match(sql, /data:\|blob:\|;base64,/);
  assert.match(sql, /jsonb_typeof\(v\) = 'string'/);
});
test('candidate input cannot elevate state, roles, credentials, history or evaluation', () => {
  const c = createReleaseCandidate({id:'c1',spec:'s1',modelRevision:'m1',at:1});
  assert.deepEqual(Object.keys(c), ['schema','id','spec','modelRevision','summary','state','evaluation','rollout','history','productionCredentials']);
  const b = body('agent_release_candidate');
  assert.match(b, /exact_keys\(p_candidate,/);
  for (const [key,value] of [['state',"'candidate'"], ['evaluation',"'null'::jsonb"],['rollout',"'0'::jsonb"],['productionCredentials',"'false'::jsonb"]]) {
    assert.ok(b.includes(`p_candidate->${key === 'state' ? '>' : ''}'${key}' is distinct from ${value}`));
  }
  assert.match(b, /jsonb_array_length\(p_candidate->'history'\) <> 1/);
  assert.match(b, /'actorId',u,'at',floor\(extract\(epoch from clock_timestamp\(\)\)/);
});
test('evaluate and approve fail closed before parsing untrusted options; no passed trust', () => {
  const b = body('agent_release_advance');
  assert.match(b, /if p_action = 'evaluate' then raise exception 'EVALUATOR_NOT_CONFIGURED'; end if;/);
  assert.match(b, /if p_action = 'approve' then raise exception 'TRUSTED_EVALUATION_REQUIRED'; end if;/);
  assert.ok(b.indexOf("raise exception 'EVALUATOR_NOT_CONFIGURED'") < b.indexOf('if p_options'));
  assert.match(b, /p_options \? 'evaluation' and p_options->'evaluation' <> 'null'::jsonb/);
  assert.match(b, /p_options - array\['at','evaluation','rollout','previousReleaseId'\]/);
  assert.doesNotMatch(b, /->>?\s*'passed'|state',\s*'evaluated'|n := 'approved'/);
  assert.match(b, /for update/);
  assert.match(b, /insert into public\.agent_release_audit/);
  assert.match(b, /'recordOnly',true/);
  assert.match(b, /ROLLBACK_TARGET_IMMUTABLE/);
  assert.match(b, /'rollbackNotice','仅回退后续配置，不撤销已执行的数据变更'/);
});
