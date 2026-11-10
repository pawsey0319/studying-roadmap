import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav } from '../src/core/wav.js';
test('WAV mixes stereo to mono PCM16 and writes actual header', async () => {
 const b = encodeWav([new Float32Array([-1, 0, 1]), new Float32Array([-1, 0, 1])], 16000);
 const v = new DataView(await b.arrayBuffer());
 assert.equal(b.type, 'audio/wav'); assert.equal(b.size, 50);
 assert.equal(v.getUint32(24,true),16000); assert.equal(v.getUint16(22,true),1);
 assert.equal(v.getInt16(44,true),-32768); assert.equal(v.getInt16(48,true),32767);
});
test('WAV rejects empty audio and mismatched channels', () => {
 assert.throws(() => encodeWav([],16000));
 assert.throws(() => encodeWav([new Float32Array(1), new Float32Array(2)],16000));
});
