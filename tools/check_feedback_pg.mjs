// Optional isolated test dependency: npm install --prefix /tmp/lh-feedback-pgcheck @electric-sql/pglite@0.5.16
// PGLITE_MODULE may point to that installation's dist/index.js. No project dependency changes.
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create schema auth;
create function auth.uid() returns varchar language sql stable as $$ select nullif(current_setting('test.uid',true),'')::varchar $$;
grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;`);
const sql=readFileSync(new URL('../cloudbase/agent-feedback.sql', import.meta.url),'utf8');
await db.exec(sql); await db.exec(sql);
console.log('PG migration and rerun OK');
const user = async id => db.exec(`reset role; select set_config('test.uid','${id}',false); set role authenticated;`);
const fails=async(query,pattern)=>{await assert.rejects(db.query(query),pattern);};
await user(''); await fails('select public.agent_feedback_list()',/AUTH_REQUIRED/);
await db.exec('reset role; set role anon'); await fails('select public.agent_feedback_list()',/permission denied/);
await user('A');
for(const t of ['agent_feedback','agent_feedback_admins','agent_release_candidates','agent_release_audit']){
 await fails(`select * from public.${t}`,/permission denied/);
 await fails(`delete from public.${t}`,/permission denied/);
 await fails(`insert into public.${t} default values`,/permission denied/);
}
await fails('select public.agent_feedback_admin_list()',/ADMIN_REQUIRED/);
await fails(`select public.agent_release_advance('c','evaluate','{"evaluation":{"passed":true}}')`,/ADMIN_REQUIRED/);
const payload={schema:'lh-quality-feedback/1',id:'q1',sessionId:'s1',spec:'v1',at:1,fields:['note'],material:{note:'safe'},consent:{confirmed:true,previewId:'q1',fields:['note']}};
const call = async (p) => db.query('select public.agent_feedback_submit($1::jsonb)',[JSON.stringify(p)]);
await call(payload);
for(const p of [{...payload,id:'q2',media:'oops'}, {...payload,consent:{...payload.consent,confirmed:false}}, {...payload,material:{note:'data:image/png;base64,AA'}}, {...payload,material:{note:'x'.repeat(601)}}, {...payload,fields:['note','note']}, {...payload,material:{note:'x',audio:'oops'}}]) await assert.rejects(call(p));
await user('B'); assert.equal((await db.query('select public.agent_feedback_list() as r')).rows[0].r.feedback.length,0);
await fails(`select public.agent_feedback_delete('q1')`,/FEEDBACK_NOT_FOUND/);
await db.exec(`reset role; insert into public.agent_feedback_admins(user_id) values ('admin')`);
await user('admin');
assert.equal((await db.query('select public.agent_feedback_admin_list() as r')).rows[0].r.feedback.length,1);
await fails(`select public.agent_feedback_delete('q1')`,/FEEDBACK_NOT_FOUND/);
await db.query(`select public.agent_feedback_review('q1','reviewed')`);
await fails(`select public.agent_release_advance('c','evaluate','{"evaluation":{"passed":true}}')`,/EVALUATOR_NOT_CONFIGURED/);
await fails(`select public.agent_release_advance('c','approve','{}')`,/TRUSTED_EVALUATION_REQUIRED/);
const c={schema:'lh-agent-release/1',id:'c',spec:'v1',modelRevision:'m1',summary:'safe',state:'candidate',evaluation:null,rollout:0,history:[{action:'candidate',at:1}],productionCredentials:false};
await db.query('select public.agent_release_candidate($1::jsonb)',[JSON.stringify(c)]);
await assert.rejects(db.query('select public.agent_release_candidate($1::jsonb)',[JSON.stringify({...c,id:'bad',state:'approved',evaluation:{passed:true}})]));
await fails(`select public.agent_release_advance('c','review','{"evaluation":{"passed":true}}')`,/UNTRUSTED_EVALUATION_OR_OPTIONS/);
await db.query(`select public.agent_release_advance('c','review','{"at":1}')`);
await db.query(`select public.agent_release_advance('c','reject','{}')`);
await user('A'); await db.query(`select public.agent_feedback_delete('q1')`);
await db.exec('reset role');
assert.equal((await db.query(`select count(*)::int as n from public.agent_release_audit`)).rows[0].n,3);
console.log('PG simulated auth, anonymous/owner/admin boundaries, direct read/delete denies, payload rejection, candidate anti-escalation, fail-closed eval/approve, audit and owner deletion OK');
await db.close();
