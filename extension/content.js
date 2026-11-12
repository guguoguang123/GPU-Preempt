// ==UserScript==
// @name         AutoDL 指定机器定时开机
// @namespace    local.autodl.gpu.watch
// @version      1.1.0
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
    <b style="font-size:17px">AutoDL 定时抢指定机器</b> <button data-action="collapse">收起</button><div data-body>
    <div>实例名或完整实例 ID（精确匹配）</div>
    <input data-field="target" value="sim">
    <div>机器标识（同时核对，如 253机）</div>
    <input data-field="machine" value="018机">
    <div>开始时间（本机时区）</div><input data-field="start" type="datetime-local" step="1">
    <div>结束时间（本机时区）</div><input data-field="end" type="datetime-local" step="1">
    <div>重试间隔（秒，最少 5）</div><input data-field="interval" type="number" min="5" value="5">
    <div style="margin:10px 0"><button data-action="check">检查目标</button> <button data-action="start">开始等待</button> <button data-action="stop">停止</button></div>
    <div>仅已有实例；有卡开机会计费。保持此页打开、电脑不休眠。停止不会关机或撤回已提交请求。</div>
    <pre data-log style="white-space:pre-wrap;max-height:150px;overflow:auto;font:12px/1.5 monospace;background:#f2f4fa;padding:8px"></pre></div>`;
  document.body.appendChild(panel);
  panel.querySelectorAll('input').forEach(el => {
    el.style.cssText = 'box-sizing:border-box;width:100%;padding:5px;border:1px solid #b8c2dc;border-radius:4px;color:#172033;background:white';
  });
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
  const fields = ['target', 'machine', 'start', 'end', 'interval'];
  let settingsEdited = false;
  const saveSettings = () => {
    settingsEdited = true;
    const settings = Object.fromEntries(fields.map(key => [key, input(key).value]));
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ gpuPreemptSettings: settings }).catch(() => log('保存设置失败，当前任务不受影响。'));
    } else {
      try { localStorage.setItem('gpuPreemptSettings', JSON.stringify(settings)); } catch {}
    }
  };
  const restoreSettings = settings => {
    if (!settings || settingsEdited || active) return;
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
  let active = false, config = null, timer = null, nextAttempt = 0;
  let pending = false, submittedAt = 0, confirmationClicked = false, modeClicked = false;
  let attempts = 0, lastState = '';
  const stop = message => {
    active = false;
    clearInterval(timer);
    timer = null;
    panel.querySelectorAll('input').forEach(el => { el.disabled = false; });
    if (message) log(message);
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
  const shortage = /无可用.*(GPU|显卡|资源)|暂无.*(GPU|显卡|资源)|没有.*(GPU|显卡|资源)|GPU.*(不足|占用|用完)|显卡.*(不足|占用)|资源不足|库存不足|无空闲|没有空闲|暂无空闲/i;
  function tick() {
    if (!active) return;
    const now = Date.now();
    if (now >= config.end) { stop('已到结束时间，停止提交请求。'); return; }
    if (now < config.start) return;
    try {
      const row = findRow(config.target, config.machine);
      const rowText = textOf(row);
      if (/已开机|运行中/.test(rowText)) {
        stop('已在页面确认目标实例运行，已停止重试。');
        document.title = '✅ GPU 已开机 — ' + document.title;
        return;
      }
      if (/开机中|启动中/.test(rowText)) {
        if (lastState !== 'starting') log('目标正在开机，等待页面确认运行状态。');
        lastState = 'starting';
        return;
      }
      const dialogs = [...document.querySelectorAll('[role="dialog"],.el-message-box,.el-dialog,.ant-modal-content')]
        .filter(el => visible(el) && !panel.contains(el));
      // Framework wrappers can contain the same dialog; keep only innermost candidates.
      const uniqueDialogs = dialogs.filter(el => !dialogs.some(other => other !== el && el.contains(other)));
      const notices = [...document.querySelectorAll('.el-message,.el-notification,.ant-message-notice,.ant-notification-notice,[role="alert"]')]
        .filter(el => visible(el) && !panel.contains(el));
      if (pending && [...uniqueDialogs, ...notices].some(el => /频繁|限流|请求过多|验证码|访问受限|429/.test(textOf(el)))) {
        stop('平台提示限流或验证，已停止，请稍后人工处理。'); return;
      }
      if (pending && [...uniqueDialogs, ...notices].some(el => shortage.test(textOf(el)))) {
        for (const dialog of uniqueDialogs) {
          if (!shortage.test(textOf(dialog))) { stop('出现额外弹窗，已停止，请人工检查。'); return; }
          const close = exactAction(dialog, ['确定', '知道了', '关闭', '我知道了']);
          if (!close) { stop('已识别缺卡，但无法安全关闭弹窗，请手动关闭后重新开始。'); return; }
          close.click();
        }
        pending = false;
        nextAttempt = Math.max(now, submittedAt + config.interval);
        log('当前机器缺卡，等待下次尝试。');
        return;
      }
      if (uniqueDialogs.length) {
        if (!pending || uniqueDialogs.length !== 1) { stop('存在未预期弹窗，已停止，请人工处理。'); return; }
        const dialog = uniqueDialogs[0], message = textOf(dialog);
        if (!/开机/.test(message) || /验证码|余额不足|欠费|充值|删除|释放实例|购买|租用新实例/.test(message)) {
          stop('开机遇到未识别提示，已停止，请查看弹窗。'); return;
        }
        const gpu = exactAction(dialog, ['有卡开机', 'GPU开机']);
        if (gpu && !modeClicked) {
          modeClicked = true; gpu.click(); log('已选择有卡开机。'); return;
        }
        // Never guess the default when a dialog offers both GPU and no-GPU modes.
        if (/无卡/.test(message) && !modeClicked) {
          stop('弹窗需要选择开机模式，请手动选择有卡模式；脚本已停止。'); return;
        }
        const confirm = exactAction(dialog, ['确定', '确认', '确认开机', '开机']);
        if (confirm && !confirmationClicked) {
          confirmationClicked = true; confirm.click(); log('已确认开机，等待结果。'); return;
        }
        if (now - submittedAt > 90000) stop('弹窗未完成，已停止，请人工检查。');
        return;
      }
      if (pending) {
        const error = notices.some(el => /失败|错误|频繁|限制|登录|不足|欠费|异常/.test(textOf(el)));
        if (error) { stop('页面出现非缺卡错误，已停止，请查看提示。'); return; }
        if (now - submittedAt > 90000) stop('90 秒内未确认开机结果，已停止以避免重复提交；请检查页面。');
        return;
      }
      if (now < nextAttempt) return;
      if (!/已关机/.test(rowText)) { stop('实例状态不明确，已停止。'); return; }
      const startButton = exactAction(row, ['开机']);
      if (!startButton) { stop('未找到唯一可点击的开机按钮，已停止。'); return; }
      pending = true;
      submittedAt = now;
      confirmationClicked = false;
      modeClicked = false;
      lastState = '';
      attempts += 1;
      log(`第 ${attempts} 次：${config.target} / ${config.machine}，点击开机。`);
      startButton.click();
    } catch (error) { stop(error.message); }
  }
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
        target: norm(input('target').value), machine: norm(input('machine').value),
        start: new Date(input('start').value).getTime(), end: new Date(input('end').value).getTime(),
        interval: Number(input('interval').value) * 1000
      };
      if (!candidate.target || !/^\d+机$/.test(candidate.machine)) throw new Error('填写实例名/完整ID，以及形如 253机 的机器号。');
      if (!Number.isFinite(candidate.start) || !Number.isFinite(candidate.end) || candidate.end <= Math.max(Date.now(), candidate.start)) throw new Error('结束时间必须晚于现在和开始时间。');
      if (!Number.isFinite(candidate.interval) || candidate.interval < 5000) throw new Error('重试间隔至少 5 秒。');
      findRow(candidate.target, candidate.machine);
      saveSettings();
      config = candidate;
      active = true; pending = false; nextAttempt = 0; attempts = 0; lastState = '';
      panel.querySelectorAll('input').forEach(el => { el.disabled = true; });
      log(`已安排：${config.target} / ${config.machine}\n${new Date(config.start).toLocaleString()} 至 ${new Date(config.end).toLocaleString()}。`);
      timer = setInterval(tick, 250);
      tick();
    } catch (error) { log(error.message); }
  };
  panel.querySelector('[data-action="stop"]').onclick = () => stop('已手动停止；已提交的开机请求不会撤回。');
  window.__autodlGpuWatch = { stop: () => stop('已停止。'), show: showPanel };
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.get('gpuPreemptSettings').then(result => restoreSettings(result.gpuPreemptSettings)).catch(() => {});
  } else {
    try { restoreSettings(JSON.parse(localStorage.getItem('gpuPreemptSettings'))); } catch {}
  }
  window.addEventListener('pagehide', () => stop());
  log('先检查目标，再设置时间并开始。刷新页面后需重新安排。');
})();
