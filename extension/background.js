chrome.action.onClicked.addListener(async tab => {
  if (!tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'SHOW_GPU_PANEL' });
  } catch {
    await chrome.action.setBadgeText({ tabId: tab.id, text: '刷新' });
    await chrome.action.setTitle({ tabId: tab.id, title: '请打开 AutoDL 容器实例列表并刷新页面' });
  }
});
