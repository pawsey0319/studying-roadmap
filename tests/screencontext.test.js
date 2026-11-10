import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createScreenContext } from '../src/core/screencontext.js';
import { screenContext } from '../src/native.js';

function fixture() {
  let time = 100000;
  const frame = { sessionId: 'session', frameId: 'frame1', hash: 'sha', capturedAt: time, mimeType: 'image/jpeg', base64: 'YWJj', packageName: 'guessed', url: 'guessed' };
  let status = { status: 'paused-consultation', sessionId: 'session', frameId: 'frame1' };
  let stops = 0;
  const bridge = { start: async x => x, status: async () => ({ ...status }), preview: async () => ({ ...frame }),
    requestFrame: async () => { status.frameId = null; }, stop: async () => { stops++; status.status = 'stopped'; } };
  const c = createScreenContext({ bridge, now: () => time });
  return { c, frame, status, setTime: t => { time = t; }, stops: () => stops, bridge };
}
const approve = (c, id = 'frame1', dest = '本机视觉服务') => {
  c.confirm({ frameId: id, sourceLabel: '用户确认的文章页面' }); c.authorize({ frameId: id, destination: dest });
};
test('web native screen bridge rejects unsupported instead of silently reading', async () => {
  await assert.rejects(screenContext.start({ consent: true }), { code: 'UNSUPPORTED' });
});
test('preview has no guessed identity; explicit per-frame approval and destination required', async () => {
  const { c } = fixture(); const p = await c.preview(); assert.equal(p.live, false); assert.equal(p.url, null); assert.equal(p.packageName, null);
  await assert.rejects(c.attachment({ destination: '本机视觉服务' }), { code: 'CONFIRM_REQUIRED' });
  c.confirm({ frameId: p.frameId, sourceLabel: '来源' });
  await assert.rejects(c.attachment({ destination: '本机视觉服务' }), { code: 'UPLOAD_CONSENT_REQUIRED' });
  approve(c); await assert.rejects(c.attachment({ destination: '其他云' }), { code: 'UPLOAD_CONSENT_REQUIRED' });
  const a = await c.attachment({ destination: '本机视觉服务' }); assert.equal(a.base64, 'YWJj'); assert.equal(a.source.identityVerified, false);
  await assert.rejects(c.attachment({ destination: '本机视觉服务' }), { code: 'UPLOAD_CONSENT_REQUIRED' });
});
test('stale, future, changed, revoked frames cannot be used', async () => {
  for (const kind of ['stale', 'future', 'changed', 'revoked', 'session']) {
    const { c, status, setTime } = fixture(); await c.preview(); approve(c);
    if (kind === 'stale') setTime(130001);
    if (kind === 'future') setTime(99999);
    if (kind === 'changed') status.frameId = 'new';
    if (kind === 'revoked') status.status = 'stopped';
    if (kind === 'session') status.sessionId = 'new-session';
    await assert.rejects(c.attachment({ destination: '本机视觉服务' }));
  }
});
test('new preview and refresh clear permissions; never inherit page authorization', async () => {
  const { c, frame, status } = fixture(); await c.preview(); approve(c);
  frame.frameId = status.frameId = 'frame2'; await c.preview();
  assert.throws(() => c.authorize({ frameId: 'frame2', destination: '本机视觉服务' }), { code: 'CONFIRM_REQUIRED' });
  approve(c, 'frame2'); await c.refresh(); await assert.rejects(c.attachment({ destination: '本机视觉服务' }), { code: 'NO_FRAME' });
});
test('stop and disposal clear data; late preview cannot restore it', async () => {
  const { c, bridge, frame, stops } = fixture(); let resolve;
  bridge.preview = () => new Promise(r => { resolve = r; });
  const pending = c.preview(); await c.stop(); resolve(frame);
  await assert.rejects(pending, { code: 'CANCELLED' }); assert.equal(stops(), 1);
  await assert.rejects(c.attachment({ destination: '本机视觉服务' }), { code: 'NO_FRAME' });
});
test('concurrent attachments atomically consume one upload grant', async () => {
  const { c, bridge, status } = fixture(); await c.preview(); approve(c);
  let release; bridge.status = () => new Promise(resolve => { release = resolve; });
  const first = c.attachment({ destination: '本机视觉服务' });
  await assert.rejects(c.attachment({ destination: '本机视觉服务' }), { code: 'UPLOAD_CONSENT_REQUIRED' });
  release(status); const result = await first; assert.equal(result.source.destination, '本机视觉服务');
});

test('stop during async attachment blocks export', async () => {
  const { c, bridge, status } = fixture(); await c.preview(); approve(c); let resolve;
  bridge.status = () => new Promise(r => { resolve = r; });
  const pending = c.attachment({ destination: '本机视觉服务' }); await c.stop(); resolve(status);
  await assert.rejects(pending);
});
test('invalid or overlarge frame rejected without retaining evidence', async () => {
  for (const patch of [{ mimeType: 'image/png' }, { base64: 'not base64!' }, { base64: 'a'.repeat(2800001) }, { sessionId: null }, { capturedAt: NaN }]) {
    const { c, frame } = fixture(); Object.assign(frame, patch); await assert.rejects(c.preview(), { code: 'INVALID_FRAME' });
  }
});
test('native source contract: OS consent, foreground, lock/stop cleanup and no network/file/accessibility', () => {
  const service = readFileSync(new URL('../app/native/ScreenCaptureService.java', import.meta.url), 'utf8');
  const plugin = readFileSync(new URL('../app/native/ScreenContextPlugin.java', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../app/native/MainActivity.java', import.meta.url), 'utf8');
  for (const text of ['START_NOT_STICKY', 'startForeground', 'onStop()', 'ACTION_SCREEN_OFF', 'isKeyguardLocked', 'display.release()', 'reader.close()', 'p.stop()', 'clearFrame()', 'INTERVAL = 2000', 'ScreenContextPlugin.ownVisible', 'onTaskRemoved', 'setOngoing(true)', '"STOP".equals']) assert.ok(service.includes(text), text);
  assert.match(plugin, /createConfigForUserChoice/); assert.match(plugin, /startActivityForResult/); assert.match(plugin, /NOTIFICATION_REQUIRED/);
  assert.match(plugin, /@PermissionCallback private void notificationResult/);
  assert.match(plugin, /requestPermissionForAlias\("screenNotifications", call, "notificationResult"\)/);
  assert.match(plugin, /APP_NOT_VISIBLE/);
  assert.match(service, /!ScreenContextPlugin.ownVisible \|\| System.currentTimeMillis\(\) - capturedAt > TTL/);
  assert.match(main, /registerPlugin\(ScreenContextPlugin.class\)/); assert.match(main, /onStop/);
  assert.doesNotMatch(service + plugin, /HttpURLConnection|FileOutputStream|AccessibilityService|getString\("(?:path|intent|url)"/);
});
test('build-only pipeline has actual Android compilation and lint without release credentials', () => {
  const workflow = readFileSync(new URL('../.github/workflows/android-check.yml', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../app/verify-android.sh', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_dispatch:/); assert.match(workflow, /pull_request:/);
  assert.match(workflow, /java-version: '21'/); assert.match(workflow, /node-version: '22'/);
  assert.match(workflow, /contents: read/); assert.doesNotMatch(workflow, /secrets\.|assembleRelease|gh release|contents: write/);
  assert.match(script, /:app:assembleDebug :app:lintDebug/);
  assert.match(script, /env -u ANDROID_KEYSTORE_FILE/);
  assert.doesNotMatch(script, /assembleRelease|publish\.sh|git push/);
});

test('patch executes idempotently on fake generated project and installs private service', () => {
  const temp = mkdtempSync(join(tmpdir(), 'screen-patch-'));
  try {
    cpSync(new URL('../app/patch-android.py', import.meta.url), join(temp, 'patch-android.py'));
    cpSync(new URL('../app/native', import.meta.url), join(temp, 'native'), { recursive: true });
    const app = join(temp, 'android/app'); mkdirSync(join(app, 'src/main'), { recursive: true });
    writeFileSync(join(app, 'build.gradle'), 'versionCode 1\nversionName "1.0"\n    buildTypes {\n        release {\n        }\n    }');
    writeFileSync(join(app, 'src/main/AndroidManifest.xml'), '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application></application></manifest>');
    execFileSync('python3', [join(temp, 'patch-android.py'), '2', '1.1']); execFileSync('python3', [join(temp, 'patch-android.py'), '2', '1.1']);
    const manifest = readFileSync(join(app, 'src/main/AndroidManifest.xml'), 'utf8');
    assert.equal((manifest.match(/android:name=".ScreenCaptureService"/g) || []).length, 1);
    assert.match(manifest, /android:exported="false" android:foregroundServiceType="mediaProjection"/);
    assert.match(manifest, /android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION/);
    assert.ok(manifest.lastIndexOf('<uses-permission') < manifest.indexOf('<application'), 'permissions must precede application');
    assert.doesNotMatch(manifest, /BIND_ACCESSIBILITY_SERVICE|SYSTEM_ALERT_WINDOW/);
    assert.match(readFileSync(join(app, 'src/main/java/io/github/pawsey0319/learninghub/MainActivity.java'), 'utf8'), /ScreenContextPlugin.class/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
