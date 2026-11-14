const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createEngine } = require('./extension/engine.js');
let count = 0;
function test(name, fn) { fn(); count++; console.log('PASS ' + name); }
function setup() {
  let now = 100000;
  const page = { online: true, row: 'stopped', canStart: true, dialogs: [], notices: [] };
  const calls = { start: 0, dismiss: 0, cancel: 0, confirm: 0, gpu: 0, reload: 0 };
  const engine = createEngine({ read: () => page, status: () => {}, log: () => {},
    ...Object.fromEntries(Object.keys(calls).map(key => [key, () => { calls[key]++; }])),
    hasGpuAction: item => !!item.gpu, hasConfirm: item => !!item.confirm });
  const config = { start: now, end: now + 10000000, interval: 5000, stopAtEnd: true };
  engine.start(config);
  return { engine, page, calls, config, tick: (delta = 0) => { now += delta; engine.tick(now); }, state: () => engine.getState() };
}
test('scheduled start', () => { const x = setup(); x.config.start += 1000; x.tick(); assert.equal(x.calls.start, 0); });
test('deadline', () => { const x = setup(); x.config.end = 100001; x.tick(2); assert.equal(x.state().kind, 'expired'); assert.equal(x.calls.start, 0); });
test('no overlapping submissions', () => { const x = setup(); x.tick(); x.tick(5000); assert.equal(x.calls.start, 1); });
test('success stops', () => { const x = setup(); x.tick(); x.page.row = 'running'; x.tick(); assert.equal(x.state().kind, 'success'); assert.equal(x.state().active, false); });
test('starting waits', () => { const x = setup(); x.page.row = 'starting'; x.tick(); x.tick(120000); assert.equal(x.calls.start, 0); });
test('lingering shortage modal stays active', () => { const x = setup(); x.tick(); x.page.dialogs = [{ text: 'GPU资源不足' }]; x.tick(1000); x.tick(250); x.tick(5000); assert.equal(x.state().active, true); assert.equal(x.calls.start, 1); });
test('five-second retry', () => { const x = setup(); x.tick(); x.page.notices = [{ text: '资源不足' }]; x.tick(1000); x.page.notices = []; x.tick(3999); assert.equal(x.calls.start, 1); x.tick(1); assert.equal(x.calls.start, 2); });
test('stale shortage toast blocks overlap', () => { const x = setup(); x.tick(); x.page.notices = [{ text: '资源不足' }]; x.tick(1000); x.tick(10000); assert.equal(x.calls.start, 1); });
test('underlying confirmation canceled after failure', () => { const x = setup(); x.tick(); x.page.notices = [{ text: '资源不足' }]; x.page.dialogs = [{ text: '确认开机', startPrompt: true, confirm: true }]; x.tick(1000); x.page.notices = []; x.tick(250); assert.equal(x.calls.cancel, 1); assert.equal(x.calls.confirm, 0); x.page.dialogs = []; x.tick(4000); assert.equal(x.calls.start, 2); });
test('unknown modal auto resumes', () => { const x = setup(); x.page.dialogs = [{ text: '活动公告' }]; x.tick(); assert.equal(x.state().active, true); assert.equal(x.calls.dismiss, 0); x.page.dialogs = []; x.tick(1000); assert.equal(x.calls.start, 1); });
test('empty fading overlay after failure resumes', () => { const x = setup(); x.tick(); x.page.notices = [{ text: '资源不足' }]; x.tick(1000); x.page.notices = []; x.page.dialogs = [{ text: '' }]; x.tick(250); assert.equal(x.state().active, true); x.page.dialogs = []; x.tick(4000); assert.equal(x.calls.start, 2); });
test('missing row recovers', () => { const x = setup(); x.page.row = 'unknown'; x.tick(); assert.equal(x.calls.start, 0); x.page.row = 'stopped'; x.tick(1000); assert.equal(x.calls.start, 1); });
test('offline recovers', () => { const x = setup(); x.page.online = false; x.tick(); assert.equal(x.state().kind, 'offline'); x.page.online = true; x.tick(1000); assert.equal(x.calls.start, 1); });
test('pending request not repeated after reconnect', () => { const x = setup(); x.tick(); x.page.online = false; x.tick(1000); x.page.online = true; x.tick(10000); assert.equal(x.calls.start, 1); });
test('uncertain timeout stays active and observes success', () => { const x = setup(); x.tick(); x.tick(91000); assert.equal(x.state().active, true); assert.equal(x.calls.start, 1); x.page.row = 'running'; x.tick(); assert.equal(x.state().kind, 'success'); });
test('network error not proof of failure', () => { const x = setup(); x.tick(); x.page.notices = [{ text: '网络异常，请求超时' }]; x.tick(1000); x.page.notices = []; x.tick(10000); assert.equal(x.calls.start, 1); });
test('rate-limit priority and 60-second recovery', () => { const x = setup(); x.tick(); x.page.notices = [{ text: '请求频繁，资源不足' }]; x.tick(1000); assert.equal(x.state().kind, 'cooldown'); x.page.notices = []; x.tick(59999); assert.equal(x.calls.start, 1); x.tick(1); assert.equal(x.calls.start, 2); });
test('persistent rate-limit waits', () => { const x = setup(); x.page.notices = [{ text: '请求频繁' }]; x.tick(); x.tick(70000); assert.equal(x.calls.start, 0); });
test('repeated limit doubles cooldown', () => { const x = setup(); x.tick(); x.page.notices = [{ text: '请求频繁' }]; x.tick(1000); x.page.notices = []; x.tick(60000); x.page.notices = [{ text: '429' }]; x.tick(1000); assert.equal(x.state().until, 282000); });
test('CAPTCHA stays armed without interaction', () => { const x = setup(); x.page.dialogs = [{ text: '请完成验证码' }]; x.tick(); assert.equal(x.state().active, true); assert.equal(x.calls.dismiss, 0); x.page.dialogs = []; x.tick(); assert.equal(x.calls.start, 1); });
test('balance problem stays armed', () => { const x = setup(); x.page.notices = [{ text: '余额不足' }]; x.tick(); assert.equal(x.state().active, true); assert.equal(x.calls.start, 0); });
test('starting returns stopped: retry', () => { const x = setup(); x.tick(); x.page.row = 'starting'; x.tick(1000); x.page.row = 'stopped'; x.tick(1000); x.tick(4999); assert.equal(x.calls.start, 1); x.tick(1); assert.equal(x.calls.start, 2); });
test('confirmation clicked once', () => { const x = setup(); x.tick(); x.page.dialogs = [{ text: '确认开机', startPrompt: true, confirm: true }]; x.tick(250); x.tick(250); assert.equal(x.calls.confirm, 1); });
test('ambiguous GPU choice waits', () => { const x = setup(); x.tick(); x.page.dialogs = [{ text: '开机：有卡 无卡', startPrompt: true, confirm: true }]; x.tick(250); assert.equal(x.calls.confirm, 0); });
test('manual stop', () => { const x = setup(); x.engine.stop(); x.tick(); assert.equal(x.calls.start, 0); });
test('manual stop while blocked', () => { const x = setup(); x.page.dialogs = [{ text: '其他操作' }]; x.tick(); x.engine.stop(); x.page.dialogs = []; x.tick(6000); assert.equal(x.calls.start, 0); });
test('unknown modal is actively canceled then refreshed if stuck', () => { const x = setup(); x.page.dialogs = [{ text: '未知弹窗' }]; x.tick(); assert.equal(x.calls.cancel, 1); x.tick(14999); assert.equal(x.calls.reload, 0); x.tick(1); assert.equal(x.calls.reload, 1); x.tick(1000); assert.equal(x.calls.reload, 1); assert.equal(x.state().active, true); });
test('stuck shortage gets refresh fallback', () => { const x = setup(); x.tick(); x.page.dialogs = [{ text: '资源不足' }]; x.tick(1000); x.tick(15000); assert.equal(x.calls.reload, 1); assert.equal(x.calls.start, 1); });
test('request timeout refreshes without blind re-submit', () => { const x = setup(); x.tick(); x.tick(90000); assert.equal(x.calls.reload, 1); assert.equal(x.calls.start, 1); });
test('recovery preserves attempt count and retry delay', () => { const x = setup(); x.engine.stop(); x.engine.start({ ...x.config, initialAttempts: 95, retryNotBefore: 105000 }); x.tick(); assert.equal(x.calls.start, 0); x.tick(5000); assert.equal(x.state().attempts, 96); });
test('recovery checks running before new submit', () => { const x = setup(); x.engine.stop(); x.engine.start({ ...x.config, initialAttempts: 95, retryNotBefore: 105000 }); x.page.row = 'running'; x.tick(); assert.equal(x.calls.start, 0); assert.equal(x.state().kind, 'success'); });
test('deadline stops during recovery', () => { const x = setup(); x.page.dialogs = [{ text: '未知弹窗' }]; x.config.end = 105000; x.tick(); x.tick(5000); assert.equal(x.calls.reload, 0); assert.equal(x.state().kind, 'expired'); });
test('explicitly disabled deadline keeps retrying', () => { const x = setup(); x.config.stopAtEnd = false; x.config.end = 100001; x.tick(2); assert.equal(x.calls.start, 1); assert.equal(x.state().active, true); });
test('default deadline remains enabled', () => { const x = setup(); delete x.config.stopAtEnd; x.config.end = 100001; x.tick(2); assert.equal(x.state().kind, 'expired'); assert.equal(x.calls.start, 0); });
test('no-GPU running is not success', () => { const x = setup(); x.page.row = 'no-gpu'; x.tick(); assert.equal(x.state().active, true); assert.equal(x.calls.start, 0); assert.notEqual(x.state().kind, 'success'); });
test('package and userscript match', () => {
  const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
  const normalize = text => text.replace(/\r\n?/g, '\n');
  const manifest = JSON.parse(read('extension/manifest.json'));
  assert.equal(manifest.version, '1.2.2');
  assert.deepEqual(manifest.content_scripts[0].js, ['engine.js', 'content.js']);
  assert.deepEqual(manifest.permissions, ['storage']);
  const content = normalize(read('extension/content.js'));
  const boundary = content.indexOf('// ==/UserScript==') + '// ==/UserScript=='.length;
  assert.equal(normalize(read('autodl_gpu_watch.user.js')), content.slice(0, boundary) + '\n' + normalize(read('extension/engine.js')) + '\n' + content.slice(boundary));
  assert.ok(content.indexOf('data-status') < content.indexOf('<div data-body>'));
});
console.log(`${count} regression checks passed. No live AutoDL requests.`);
