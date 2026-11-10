import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createReleaseCandidate,transitionRelease} from '../src/core/agent-release.js';
import {createSession,appendSessionEvent,createCheckpoint,planSessionResume,deleteSession,createQualityPreview,authorizeQualityFeedback} from '../src/core/learning-session.js';
test('client manifest and self-reported pass cannot authorize release',()=>{
 const c=createReleaseCandidate({id:'c1',spec:'v1',modelRevision:'r1',at:1});
 assert.throws(()=>transitionRelease(c,'review',{actor:{id:'u',role:'user'},at:2}),/ADMIN_REQUIRED/);
 const r=transitionRelease(c,'review',{actor:{id:'a',role:'admin'},at:2});
 assert.throws(()=>transitionRelease(r,'evaluate',{actor:{id:'a',role:'admin'},at:3,evaluation:{id:'e1',manifest:'arbitrary',passed:true}}),/EVALUATOR_NOT_CONFIGURED/);
 assert.throws(()=>transitionRelease(r,'approve',{actor:{id:'a',role:'admin'},at:4}),/INVALID_RELEASE_TRANSITION/);
 assert.throws(()=>transitionRelease({...r,state:'evaluated',evaluation:{passed:true}},'approve',{actor:{id:'a',role:'admin'},at:5}),/EVALUATOR_NOT_CONFIGURED/);
});
test('session resume never grants authority, deleted sessions cannot append',()=>{
 let s=createSession({id:'s1',spec:'v1',at:1});
 s=appendSessionEvent(s,{id:'m1',type:'message',at:2,summary:'read'});
 s=createCheckpoint(s,{id:'cp1',at:3,summary:'saved'});
 assert.equal(planSessionResume(s).canExecute,false);assert.equal(planSessionResume(s).requiresAuthorization,true);
 const d=deleteSession(s,4);assert.throws(()=>appendSessionEvent(d.session,{id:'m2',type:'answer',at:5}),/SESSION_DELETED/);
});
test('quality sharing requires exact field consent, strips injected media',()=>{
 const p=createQualityPreview({id:'q1',sessionId:'s1',feedback:{spec:'old',note:'share only this',secret:'never'},fields:['note'],at:1});
 assert.throws(()=>authorizeQualityFeedback(p,{confirmed:true,previewId:'q1',fields:['note','context']}),/QUALITY_CONSENT_MISMATCH/);
 const safe=authorizeQualityFeedback({...p,media:'pixels'},{confirmed:true,previewId:'q1',fields:['note']});
 assert.deepEqual(safe.material,{note:'share only this'});assert.equal(safe.media,undefined);assert.equal(safe.spec,'old');
});
