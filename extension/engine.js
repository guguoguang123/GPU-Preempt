/* GPU-Preempt recovery state machine. No network calls; io owns page interaction. */
(function (root) {
  'use strict';
  function createEngine(io) {
    let cfg, active = false, pending = false, attempts = 0, sent = 0, next = 0;
    let sawStarting = false, failed = false, rateCount = 0, rateVisible = false;
    let confirmed = false, modeSelected = false, recoveryUntil = 0, blockedSince = null, recovering = false;
    let state = { kind: 'stopped', message: '未开始', attempts: 0 };
    const shortage = /无可用.*(GPU|显卡|资源)|暂无.*(GPU|显卡|资源)|没有.*(GPU|显卡|资源)|GPU.*(不足|占用|用完)|显卡.*(不足|占用)|资源不足|库存不足|无空闲|没有空闲|暂无空闲/i;
    const fatal = /验证码|余额不足|欠费|充值|登录失效|重新登录|请.*登录|权限不足|访问受限/;
    const limited = /频繁|限流|请求过多|429|too many requests/i;
    const transient = /网络.*(异常|错误|失败)|连接.*(失败|中断)|请求超时|服务.*(繁忙|不可用)|稍后重试|network error|timeout/i;
    function publish(kind, message, until = 0) {
      if (state.kind !== kind || state.message !== message) io.log(message);
      state = { kind, message, until, attempts, active, pending };
      io.status(state);
    }
    function stop(message = '已手动停止；不会撤回已提交请求。', kind = 'stopped') {
      active = false;
      publish(kind, message);
    }
    function start(config) {
      if (active) return;
      cfg = config; active = true; pending = false; attempts = config.initialAttempts || 0; sent = 0; next = config.retryNotBefore || 0;
      sawStarting = failed = rateVisible = confirmed = modeSelected = false;
      rateCount = 0; recoveryUntil = 0; blockedSince = null; recovering = false;
      publish('scheduled', '已安排，等待开始时间。', cfg.start);
    }
    function tick(now = Date.now()) {
      if (!active) return;
      if (cfg.stopAtEnd !== false && now >= cfg.end) { stop('已到你设定的结束时间，停止后续请求。', 'expired'); return; }
      if (now < cfg.start) { publish('scheduled', '等待开始时间。', cfg.start); return; }
      function recover(message, delay = 15000) {
        if (blockedSince === null) blockedSince = now;
        publish('recovering', message, blockedSince + delay);
        if (now - blockedSince >= delay && !recovering && io.reload) {
          recovering = true;
          try {
            if (io.reload({ ...cfg, initialAttempts: attempts, retryNotBefore: Math.max(next, now + cfg.interval) }) === false) {
              recovering = false; blockedSince = now;
            }
          } catch { recovering = false; blockedSince = now; }
        }
      }
      try {
        const page = io.read(cfg);
        if (!page.online) { publish('offline', '网络已断开，恢复后自动继续；未确认请求不会重复提交。'); return; }
        const dialogs = page.dialogs || [], notices = page.notices || [];
        const all = [...dialogs, ...notices];
        if (page.row === 'running') { stop('已确认目标实例运行，抢卡完成。', 'success'); return; }
        if (page.row === 'no-gpu') { publish('blocked', '目标为无卡运行，不算抢卡成功；请切回有卡开机，任务保持运行。'); return; }
        if (all.some(item => fatal.test(item.text))) {
          if (pending) { pending = false; failed = true; next = Math.max(next, now + 60000); }
          dialogs.filter(item => fatal.test(item.text)).forEach(item => io.cancel(item));
          publish('blocked', '登录、余额或验证暂不可用，任务保持运行；处理完成后自动继续。', next); return;
        }
        const rateItems = all.filter(item => limited.test(item.text));
        if (rateItems.length) {
          if (!rateVisible) {
            rateCount += 1;
            next = now + Math.min(300000, 60000 * 2 ** (rateCount - 1));
            if (pending) { pending = false; failed = true; }
          }
          rateVisible = true;
          dialogs.filter(item => limited.test(item.text)).forEach(item => io.dismiss(item));
          if (now >= next) { recover('限流提示未关闭，刷新后核对并继续。', 0); return; }
          publish('cooldown', '平台限流，等待冷却后自动继续。', next); return;
        }
        rateVisible = false;
        if (page.row === 'starting') {
          sawStarting = true;
          publish('starting', '目标正在开机，等待确认运行；不重复提交。'); return;
        }
        if (!page.row || page.row === 'unknown') {
          dialogs.forEach(item => io.cancel(item));
          recover('目标行暂不可用，稍后刷新列表恢复。', 30000); return;
        }
        if (sawStarting && page.row === 'stopped') {
          sawStarting = false; pending = false; failed = true;
          next = Math.max(next, now + cfg.interval);
          publish('retrying', '开机后回到已关机状态，准备重试。', next);
        }
        const lack = all.filter(item => shortage.test(item.text));
        if (lack.length) {
          if (pending) {
            pending = false; failed = true;
            next = Math.max(next, sent + cfg.interval);
            recoveryUntil = now + 2000;
          }
          dialogs.filter(item => shortage.test(item.text)).forEach(item => io.dismiss(item));
          recover('当前机器缺卡，正在关闭提示并准备重试。');
          return;
        }
        // After a failure, the underlying confirmation may outlive the shortage overlay.
        // Cancel that old confirmation, never confirm it a second time.
        if (dialogs.length) {
          if (failed) {
            dialogs.forEach(item => io.cancel(item));
            recover('正在自动关闭残留弹窗，持续卡住将刷新续抢。');
            return;
          }
          if (!pending || dialogs.length !== 1 || !dialogs[0].startPrompt) {
            dialogs.forEach(item => io.cancel(item));
            recover('正在自动关闭其他弹窗，持续卡住将刷新续抢。'); return;
          }
          const item = dialogs[0];
          if (io.hasGpuAction(item) && !modeSelected) {
            modeSelected = true; sent = now; io.gpu(item);
            publish('submitting', '已选择有卡开机，等待结果。'); return;
          }
          if (/无卡/.test(item.text) && !modeSelected) {
            io.cancel(item);
            recover('无法确认有卡模式，取消弹窗后刷新重试。'); return;
          }
          if (!confirmed && io.hasConfirm(item)) {
            confirmed = true; sent = now; io.confirm(item);
            publish('submitting', '已确认开机，等待结果。'); return;
          }
          if (now - sent >= 90000) { io.cancel(item); recover('开机弹窗超时，刷新核对实例状态。', 0); return; }
          publish('submitting', '等待开机弹窗完成，不重复点击。'); return;
        }
        if (pending) {
          if (now - sent >= 90000) {
            recover('请求结果超时，刷新核对状态后继续。', 0); return;
          }
          if (all.some(item => transient.test(item.text))) {
            publish('submitting', '网络提示异常，等待当前请求结果；超时将刷新核对。'); return;
          }
          if (all.some(item => /失败|错误|异常/.test(item.text))) {
            publish('blocked', '出现未识别错误，等待明确开机结果或人工检查。'); return;
          }
          publish('submitting', '开机请求已提交，等待结果。'); return;
        }
        if (now < Math.max(next, recoveryUntil)) {
          blockedSince = null;
          publish(rateCount && now < next ? 'cooldown' : 'retrying', '等待下一次尝试。', Math.max(next, recoveryUntil)); return;
        }
        if (notices.some(item => transient.test(item.text))) {
          recover('网络或服务错误提示持续存在，稍后刷新恢复。', 30000); return;
        }
        if (page.row !== 'stopped' || !page.canStart) {
          recover('开机按钮暂不可用，稍后刷新恢复。', 30000); return;
        }
        blockedSince = null;
        failed = false; confirmed = false; modeSelected = false;
        pending = true; sent = now; attempts += 1;
        publish('submitting', `第 ${attempts} 次：正在尝试有卡开机。`);
        io.start(page);
      } catch (error) {
        recover('页面暂不可用，稍后刷新恢复：' + error.message, 30000);
      }
    }
    return { start, stop, tick, getState: () => ({ ...state }) };
  }
  if (typeof module === 'object' && module.exports) module.exports = { createEngine };
  else root.GpuPreemptEngine = { createEngine };
})(globalThis);
