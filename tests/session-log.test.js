import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateSessionLog } from '../src/core/session-log.js';
test('chat log builds safe checkpoints, deduplicates, and never persists raw media', () => {
 const opts = { id:'s1',title:'题目',topic:{kind:'free',id:''},spec:'v1',at:100,messages:[{role:'user',ts:1,content:'问',media:[{data:'secret'}]},{role:'assistant',ts:2,content:'答'}] };
 const first = updateSessionLog(null,opts), again = updateSessionLog(first,{...opts,at:200});
 assert.equal(first.events.length,2);assert.equal(again.events.length,2);assert.equal(again.checkpoints.length,1);
 assert.equal(JSON.stringify(first).includes('secret'),false);assert.equal(first.topic.kind,'free');
 assert.equal(first.checkpoints[0].eventCount,2);
});
test('direct audio is recorded as an audio event without raw sound', () => {
 const s=updateSessionLog(null,{id:'s2',title:'音频',topic:{kind:'free'},spec:'v1',at:10,messages:[{role:'user',ts:1,inputMode:'direct_audio',content:'占位',audio:'raw'}]});
 assert.equal(s.events[0].type,'audio');assert.equal(JSON.stringify(s).includes('raw'),false);
});
