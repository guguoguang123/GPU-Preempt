// Offline checks of scheduling and stop conditions; does not access AutoDL.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').join(__dirname, 'autodl_gpu_watch.user.js'), 'utf8');
const tick = source.slice(source.indexOf('  function tick() {'), source.indexOf("  panel.querySelector('[data-action=\"check\"]')"));
function run(overrides = {}) {
  const events = [];
  const context = {
    active: true, config: { start: 0, end: Date.now() + 60000, target: 'test', machine: '253机', interval: 30000 },
    pending: false, nextAttempt: 0, submittedAt: 0, confirmationClicked: false, modeClicked: false, attempts: 0, lastState: '',
    findRow: () => ({ text: '253机 已关机' }), textOf: el => el.text,
    document: { querySelectorAll: () => [], title: 'AutoDL' }, panel: { contains: () => false },
    visible: () => true, shortage: /资源不足/, log: message => events.push(message),
    stop: message => events.push('STOP:' + message),
    exactAction: () => ({ click: () => events.push('CLICK') }), ...overrides
  };
  vm.runInNewContext(tick + '\ntick();', context);
  return { events, context };
}
const expired = run({ config: { start: 0, end: Date.now() - 1 }, findRow: () => { throw Error('must not locate'); } });
assert.match(expired.events[0], /结束时间/);
assert.equal(expired.events.includes('CLICK'), false);
assert.equal(run({ config: { start: Date.now() + 60000, end: Date.now() + 120000 } }).events.length, 0);
const running = run({ findRow: () => ({ text: '253机 运行中' }) });
assert.match(running.events[0], /已在页面确认/);
assert.equal(running.events.includes('CLICK'), false);
assert.equal(run({ findRow: () => ({ text: '253机 开机中' }) }).events.includes('CLICK'), false);
assert.equal(run().events.filter(event => event === 'CLICK').length, 1);
assert.equal(run({ pending: true, submittedAt: Date.now() }).events.includes('CLICK'), false);
assert.match(run({ pending: true, submittedAt: Date.now() - 91000 }).events[0], /90 秒/);
assert.equal(run({ nextAttempt: Date.now() + 60000 }).events.includes('CLICK'), false);
const clock = Date.now();
class FixedDate extends Date { static now() { return clock; } }
const noticeDocument = text => ({ querySelectorAll: selector => selector.includes('.el-message,') ? [{ text }] : [], title: 'AutoDL' });
const failed = run({ Date: FixedDate, pending: true, submittedAt: clock - 2000,
  config: { start: 0, end: clock + 60000, interval: 5000 }, document: noticeDocument('资源不足') });
assert.equal(failed.context.pending, false);
assert.equal(failed.context.nextAttempt, clock + 3000);
assert.equal(failed.events.includes('CLICK'), false);
const slowFailure = run({ Date: FixedDate, pending: true, submittedAt: clock - 7000,
  config: { start: 0, end: clock + 60000, interval: 5000 }, document: noticeDocument('资源不足') });
assert.equal(slowFailure.context.nextAttempt, clock);
const limited = run({ pending: true, submittedAt: clock, document: noticeDocument('请求频繁，资源不足') });
assert.match(limited.events[0], /限流/);
assert.equal(limited.events.includes('CLICK'), false);
const manifest = JSON.parse(fs.readFileSync(require('node:path').join(__dirname, 'extension/manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, ['storage']);
assert.deepEqual(manifest.content_scripts[0].matches, ['https://www.autodl.com/console/*']);
assert.equal(source, fs.readFileSync(require('node:path').join(__dirname, 'extension/content.js'), 'utf8'));
console.log('Passed 8 original checks plus 5-second retry, rate-limit priority, and extension-package checks.');
