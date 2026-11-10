import test from 'node:test';
import assert from 'node:assert/strict';
import { audioBudget, understandAudio } from '../src/ai/providers.js';
import { parseMediaPreset } from '../src/core/media-preset.js';
const cfg = {audioBase:'http://127.0.0.1:8790/v1',audioModel:'local-audio',audioMaxTokens:128,audioContextChars:256,audioMaxSeconds:30};
const wav = new Blob(['wav'], {type:'audio/wav'});
test('preset maps strict explicit audio budgets',()=>{
 const out=parseMediaPreset({schema:'lh-local-media/1',audio:{base:cfg.audioBase,model:'local-audio',key:'token',maxTokens:128,contextChars:256,maxSeconds:30}});
 assert.equal(out.audioMaxTokens,128); assert.equal(out.audioContextChars,256); assert.equal(out.audioMaxSeconds,30);
 assert.throws(()=>audioBudget({audioMaxTokens:0})); assert.throws(()=>audioBudget({audioMaxSeconds:1.5}));
});
test('audio budget rejects complete prompt overhead and excess duration without sending',async()=>{
 await assert.rejects(understandAudio(cfg,wav,{context:'字'.repeat(256),durationMs:1000}),/完整提示/);
 await assert.rejects(understandAudio(cfg,wav,{durationMs:30001}),/不超过/);
 await assert.rejects(understandAudio(cfg,wav,{durationMs:1000,maxTokens:129}),/不会自动降低/);
 await assert.rejects(understandAudio(cfg,wav),/不超过/);
});
test('explicit audio output budget is sent, generic default stays 2048',async t=>{
 const old=globalThis.fetch; t.after(()=>globalThis.fetch=old); const seen=[];
 globalThis.fetch=async(_url,init)=>{seen.push(JSON.parse(init.body).max_tokens);return new Response(JSON.stringify({choices:[{message:{content:'回答'}}]}),{headers:{'content-type':'application/json'}});};
 await understandAudio(cfg,wav,{durationMs:1000});
 await understandAudio({audioBase:cfg.audioBase,audioModel:'generic'},wav);
 assert.deepEqual(seen,[128,2048]);
});
