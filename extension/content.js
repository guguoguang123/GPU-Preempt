// ==UserScript==
// @name         AutoDL 指定机器定时开机
// @namespace    local.autodl.gpu.watch
// @version      1.2.2
// @description  在指定时间窗口重试已有普通容器实例的有卡开机
// @match        https://www.autodl.com/console/*
// @grant        none
// ==/UserScript==

(() => {
  'use strict';
  if (location.hostname !== 'www.autodl.com') {
    alert('请在已登录的 www.autodl.com 容器实例列表页面运行。');
    return;
  }
  if (window.__autodlGpuWatch) {
    window.__autodlGpuWatch.show();
    return;
  }
  if (document.getElementById('local-autodl-gpu-watch')) return;
  const panel = document.createElement('section');
  panel.id = 'local-autodl-gpu-watch';
  panel.style.cssText = 'position:fixed;right:16px;bottom:16px;width:350px;max-width:calc(100vw - 64px);max-height:85vh;overflow:auto;z-index:2147483647;background:white;color:#172033;padding:18px;border:2px solid #395aff;border-radius:12px;box-shadow:0 5px 28px #0003;font:14px/1.6 sans-serif;text-align:left';
  panel.innerHTML = `
    <b style="font-size:17px">AutoDL 定时抢指定机器</b> <button data-action="collapse">收起</button> <button data-action="close">关闭</button>
    <div data-status role="status" style="margin:8px 0;padding:9px;background:#eef2ff;border-radius:6px;font-weight:bold">已停止 · 未开始</div>
    <div data-detail style="font-size:12px;color:#48556a;margin-bottom:8px">v1.2.2</div><div data-body>
    <div>实例名或完整实例 ID（精确匹配）</div>
    <input data-field="target" value="sim">
    <div>机器标识（同时核对，如 253机）</div>
    <input data-field="machine" value="018机">
    <div>开始时间（本机时区）</div><input data-field="start" type="datetime-local" step="1">
    <label><input data-field="stopAtEnd" type="checkbox" checked> 到结束时间停止（默认开启）</label>
    <div>结束时间（本机时区）</div><input data-field="end" type="datetime-local" step="1">
    <div>重试间隔（秒，最少 5）</div><input data-field="interval" type="number" min="5" value="5">
    <div style="margin:10px 0"><button data-action="check">检查目标</button> <button data-action="start">开始等待</button> <button data-action="stop">停止</button></div>
    <div>仅已有实例；有卡开机会计费。保持此页打开、电脑不休眠。停止不会关机或撤回已提交请求。</div>
    <pre data-log style="white-space:pre-wrap;max-height:150px;overflow:auto;font:12px/1.5 monospace;background:#f2f4fa;padding:8px"></pre></div>`;
  document.body.appendChild(panel);
  panel.querySelectorAll('input').forEach(el => {
    el.style.cssText = 'box-sizing:border-box;width:100%;padding:5px;border:1px solid #b8c2dc;border-radius:4px;color:#172033;background:white';
  });
  panel.querySelector('[data-field="stopAtEnd"]').style.width = 'auto';
  const body = panel.querySelector('[data-body]');
  panel.querySelector('[data-action="collapse"]').onclick = () => {
    const collapsed = body.style.display !== 'none';
    body.style.display = collapsed ? 'none' : 'block';
    panel.querySelector('[data-action="collapse"]').textContent = collapsed ? '展开' : '收起';
  };
  const showPanel = () => {
    panel.style.display = 'block'; body.style.display = 'block';
    panel.querySelector('[data-action="collapse"]').textContent = '收起';
  };
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener(message => {
      if (message.type === 'SHOW_GPU_PANEL') showPanel();
    });
  }
  const input = key => panel.querySelector(`[data-field="${key}"]`);
  const localDate = date => {
    const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return adjusted.toISOString().slice(0, 19);
  };
  input('start').value = localDate(new Date(Date.now() + 1000));
  input('end').value = localDate(new Date(Date.now() + 2 * 3600000));
  // Save only settings, never the armed/running state.
  const fields = ['target', 'machine', 'start', 'end', 'interval', 'stopAtEnd'];
  let settingsEdited = false;
  const saveSettings = () => {
    settingsEdited = true;
    const settings = Object.fromEntries(fields.map(key => [key, key === 'stopAtEnd' ? input(key).checked : input(key).value]));
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ gpuPreemptSettings: settings }).catch(() => log('保存设置失败，当前任务不受影响。'));
    } else {
      try { localStorage.setItem('gpuPreemptSettings', JSON.stringify(settings)); } catch {}
    }
  };
  const restoreSettings = settings => {
    if (!settings || settingsEdited || active) return;
    input('stopAtEnd').checked = settings.stopAtEnd !== false;
    for (const key of ['target', 'machine', 'interval']) {
      if (typeof settings[key] === 'string') input(key).value = settings[key];
    }
    if (new Date(settings.end).getTime() > Date.now()) {
      for (const key of ['start', 'end']) if (typeof settings[key] === 'string') input(key).value = settings[key];
    }
  };
  fields.forEach(key => input(key).addEventListener('input', saveSettings));
  const norm = value => (value || '').replace(/\s+/g, '');
  const visible = el => !!(el && el.isConnected && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  const textOf = el => norm(el.innerText || el.textContent);
  const log = message => {
    const el = panel.querySelector('[data-log]');
    el.textContent = `${new Date().toLocaleTimeString()} ${message}\n${el.textContent}`.slice(0, 4500);
  };
  const actions = root => [...root.querySelectorAll('button,a,[role="button"],.el-button,.ant-btn')]
    .filter(el => visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
  const exactAction = (root, labels) => {
    const found = actions(root).filter(el => labels.includes(textOf(el)));
    // Nested spans are not considered actions, and ambiguous buttons never get clicked.
    return found.length === 1 ? found[0] : null;
  };
  let active = false, config = null, timer = null;
  let statusState = { kind: 'stopped', message: '未开始', attempts: 0 };
  const labels = { scheduled: '等待开始', retrying: '运行中 · 等待重试', submitting: '运行中 · 请求中', starting: '运行中 · 开机中', cooldown: '运行中 · 限流冷却', recovering: '运行中 · 自动恢复', offline: '运行中 · 等待联网', blocked: '运行中 · 等待恢复', success: '抢卡成功', stopped: '已停止', expired: '已结束', error: '已停止 · 需处理' };
  function renderStatus() {
    const left = statusState.until ? Math.max(0, Math.ceil((statusState.until - Date.now()) / 1000)) : 0;
    const badge = panel.querySelector('[data-status]');
    badge.textContent = (labels[statusState.kind] || statusState.kind) + (left ? ' · ' + left + ' 秒' : '');
    badge.style.background = statusState.kind === 'success' ? '#dcfce7' : ['error', 'blocked', 'offline'].includes(statusState.kind) ? '#fff1d6' : '#eef2ff';
    panel.querySelector('[data-detail]').textContent = 'v1.2.2 · 已尝试 ' + statusState.attempts + ' 次 · ' + statusState.message;
    panel.querySelector('[data-action="start"]').disabled = active;
    panel.querySelector('[data-action="stop"]').disabled = !active;
    panel.querySelectorAll('input').forEach(el => { el.disabled = active; });
  }
  const closeTimes = new WeakMap();
  function closeKnown(item, cancelOnly = false) {
    const previous = closeTimes.get(item.el) || 0;
    if (Date.now() - previous < 1500) return;
    let button = exactAction(item.el, cancelOnly ? ['取消', '关闭'] : ['确定', '知道了', '关闭', '我知道了', '取消']);
    if (!button) {
      const closes = [...item.el.querySelectorAll('.el-dialog__headerbtn,.el-message-box__headerbtn,.ant-modal-close,[aria-label="Close"],[aria-label="close"],[aria-label="关闭"],[title="关闭"]')].filter(visible);
      if (closes.length === 1) button = closes[0];
    }
    closeTimes.set(item.el, Date.now());
    if (button) button.click();
    else item.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  }
  const engine = globalThis.GpuPreemptEngine.createEngine({
    log,
    status: state => {
      statusState = state; active = state.active;
      if (!active) { clearInterval(timer); timer = null; }
      if (state.kind === 'success') document.title = '✅ GPU 已开机 — ' + document.title;
      renderStatus();
    },
    read: settings => {
      const candidates = [...document.querySelectorAll('[role="dialog"],.el-message-box,.el-dialog,.ant-modal-content')]
        .filter(el => visible(el) && !panel.contains(el));
      const dialogs = candidates.filter(el => !candidates.some(other => other !== el && el.contains(other))).map(el => {
        const text = textOf(el);
        return { el, text, startPrompt: /开机/.test(text) && !/失败|错误|异常|不足|删除|释放实例|购买|租用新实例|充值|欠费/.test(text) };
      });
      const notices = [...document.querySelectorAll('.el-message,.el-notification,.ant-message-notice,.ant-notification-notice,[role="alert"]')]
        .filter(el => visible(el) && !panel.contains(el)).map(el => ({ el, text: textOf(el) }));
      let row = null;
      try { row = findRow(settings.target, settings.machine); } catch {}
      const t = row ? textOf(row) : '';
      const state = /无卡|CPU模式/.test(t) && /已开机|运行中/.test(t) ? 'no-gpu' : /已开机|运行中/.test(t) ? 'running' : /开机中|启动中/.test(t) ? 'starting' : /已关机/.test(t) ? 'stopped' : 'unknown';
      return { online: navigator.onLine !== false, row: state, el: row, canStart: row && !!exactAction(row, ['开机']), dialogs, notices };
    },
    dismiss: item => closeKnown(item), cancel: item => closeKnown(item, true),
    hasGpuAction: item => !!exactAction(item.el, ['有卡开机', 'GPU开机']),
    gpu: item => exactAction(item.el, ['有卡开机', 'GPU开机'])?.click(),
    hasConfirm: item => !!exactAction(item.el, ['确定', '确认', '确认开机', '开机']),
    confirm: item => exactAction(item.el, ['确定', '确认', '确认开机', '开机'])?.click(),
    start: page => exactAction(page.el, ['开机'])?.click(),
    reload: settings => {
      if (settings.pagePath && settings.pagePath !== location.pathname) return false;
      sessionStorage.setItem('gpuPreemptAutoRecovery', JSON.stringify({ ...settings, savedAt: Date.now() }));
      location.reload();
      return true;
    }
  });
  const stop = message => {
    try { sessionStorage.removeItem('gpuPreemptAutoRecovery'); } catch {}
    engine.stop(message);
  };
  function findRow(target, machine) {
    // First locate a leaf carrying exactly the requested name / ID, then its smallest row.
    const leaves = [...document.querySelectorAll('td,span,div,a,p')].filter(el =>
      !panel.contains(el) && visible(el) && textOf(el) === target &&
      ![...el.children].some(child => textOf(child) === target));
    const rows = new Set();
    for (const leaf of leaves) {
      for (let row = leaf.parentElement; row && row !== document.body; row = row.parentElement) {
        const t = textOf(row);
        if (t.length > 1600) break;
        const machineTokens = t.match(/\d+机/g) || [];
        if (machineTokens.length && (machineTokens.length !== 1 || machineTokens[0] !== machine)) break;
        if (machineTokens.length === 1 && machineTokens[0] === machine && /已关机|已开机|运行中|开机中|启动中/.test(t) &&
            (exactAction(row, ['开机']) || /已开机|运行中|开机中|启动中/.test(t))) {
          rows.add(row); break;
        }
      }
    }
    if (rows.size !== 1) throw new Error('无法唯一定位实例与机器。请核对名称/完整ID、机器号，并保持该行显示在列表中。');
    return [...rows][0];
  }
  function tick() { engine.tick(); renderStatus(); }
  panel.querySelector('[data-action="check"]').onclick = () => {
    try {
      const row = findRow(norm(input('target').value), norm(input('machine').value));
      log('已定位目标：' + (row.innerText || row.textContent).replace(/\s+/g, ' ').slice(0, 220));
    } catch (error) { log(error.message); }
  };
  panel.querySelector('[data-action="start"]').onclick = () => {
    if (active) return;
    try {
      const candidate = {
        target: norm(input('target').value), machine: norm(input('machine').value), pagePath: location.pathname,
        start: new Date(input('start').value).getTime(), end: new Date(input('end').value).getTime(), stopAtEnd: input('stopAtEnd').checked,
        interval: Number(input('interval').value) * 1000
      };
      if (!candidate.target || !/^\d+机$/.test(candidate.machine)) throw new Error('填写实例名/完整ID，以及形如 253机 的机器号。');
      if (!Number.isFinite(candidate.start)) throw new Error('请填写有效的开始时间。');
      if (candidate.stopAtEnd && (!Number.isFinite(candidate.end) || candidate.end <= Math.max(Date.now(), candidate.start))) throw new Error('结束时间必须晚于现在和开始时间。');
      if (!Number.isFinite(candidate.interval) || candidate.interval < 5000) throw new Error('重试间隔至少 5 秒。');
      findRow(candidate.target, candidate.machine);
      saveSettings();
      config = candidate;
      engine.start(config);
      panel.querySelectorAll('input').forEach(el => { el.disabled = true; });
      log(`已安排：${config.target} / ${config.machine}\n${new Date(config.start).toLocaleString()} 开始；${config.stopAtEnd ? '截止 ' + new Date(config.end).toLocaleString() : '持续抢卡直到目标有卡开机成功'}。`);
      timer = setInterval(tick, 250);
      tick();
    } catch (error) { log(error.message); }
  };
  panel.querySelector('[data-action="stop"]').onclick = () => stop('已手动停止；已提交的开机请求不会撤回。');
  panel.querySelector('[data-action="close"]').onclick = () => { stop('已关闭面板并停止任务。'); panel.style.display = 'none'; };
  window.addEventListener('online', () => { if (active) tick(); });
  document.addEventListener('visibilitychange', () => { if (active) tick(); });
  renderStatus();
  window.__autodlGpuWatch = { stop: () => stop('已停止。'), show: showPanel };
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.get('gpuPreemptSettings').then(result => restoreSettings(result.gpuPreemptSettings)).catch(() => {});
  } else {
    try { restoreSettings(JSON.parse(localStorage.getItem('gpuPreemptSettings'))); } catch {}
  }
  window.addEventListener('pagehide', () => engine.stop());
  try {
    const saved = JSON.parse(sessionStorage.getItem('gpuPreemptAutoRecovery'));
    sessionStorage.removeItem('gpuPreemptAutoRecovery');
    if (saved && (!saved.stopAtEnd || saved.end > Date.now()) && Date.now() - saved.savedAt < 300000 && saved.pagePath === location.pathname && typeof saved.target === 'string' && /^\d+机$/.test(saved.machine) && saved.interval >= 5000) {
      settingsEdited = true;
      config = saved;
      input('target').value = saved.target; input('machine').value = saved.machine;
      input('start').value = localDate(new Date(saved.start)); input('end').value = localDate(new Date(saved.end));
      input('interval').value = saved.interval / 1000;
      input('stopAtEnd').checked = saved.stopAtEnd === true;
      engine.start(config);
      timer = setInterval(tick, 250);
      log('自动恢复刷新已完成，正在核对目标状态并继续抢卡。');
      tick();
    }
  } catch { log('恢复信息不可用，请重新开始。'); }
  if (!active) log('先检查目标，再设置时间并开始。脚本触发的恢复刷新会自动续抢。');
})();
