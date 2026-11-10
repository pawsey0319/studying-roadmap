import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMediaPreset } from '../src/core/media-preset.js';
import { chatSnapshot } from '../src/core/chat-snapshot.js';
test('local media preset only imports known loopback fields and no arbitrary settings', () => {
 const p=parseMediaPreset({schema:'lh-local-media/1',stt:{base:'http://127.0.0.1:8790/v1',model:'local-whisper',key:'local-secret'},provider:'evil'});
 assert.equal(p.sttModel,'local-whisper');assert.equal(p.provider,undefined);
 for (const base of ['https://evil.test/v1','http://user:pass@localhost/v1','file:///tmp/local','http://localhost/v1?x=1']) assert.throws(()=>parseMediaPreset({schema:'lh-local-media/1',stt:{base,model:'x',key:'k'}}));
 assert.throws(()=>parseMediaPreset({schema:'lh-local-media/1'}));
});
test('every persistence snapshot strips temporary screen pixels without mutating live request',()=>{
 const msgs=[{role:'user',media:[{kind:'image',ephemeral:true,data:'private-screen',source:{frameId:'f1'}},{kind:'image',data:'chosen-upload'}]}];
 const snapshot=chatSnapshot(msgs);
 assert.equal(JSON.stringify(snapshot).includes('private-screen'),false);assert.equal(msgs[0].media[0].data,'private-screen');assert.equal(snapshot[0].media[0].source.frameId,'f1');assert.equal(snapshot[0].media[1].data,'chosen-upload');
});
