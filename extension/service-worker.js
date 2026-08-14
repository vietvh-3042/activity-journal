const NATIVE_HOST = 'com.activity_journal.host';
let port;
let reconnectTimer;

function browserName() {
  return navigator.userAgent.includes('Edg/') ? 'edge' : 'chrome';
}

function connect() {
  if (port) return port;
  try {
    port = chrome.runtime.connectNative(NATIVE_HOST);
    port.onDisconnect.addListener(() => {
      port = undefined;
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 5_000);
    });
    port.onMessage.addListener(() => undefined);
  } catch {
    port = undefined;
  }
  return port;
}

function sanitizeTab(tab) {
  if (!tab || !tab.active || tab.incognito) return null;
  let hostname;
  try {
    const parsed = new URL(tab.url || '');
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') hostname = parsed.hostname.toLowerCase();
  } catch {
    hostname = undefined;
  }
  const title =
    String(tab.title || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 512) || undefined;
  if (!hostname && !title) return null;
  return {
    browser: browserName(),
    title,
    hostname,
    timestamp: new Date().toISOString(),
  };
}

async function emitActiveTab(windowId) {
  try {
    const targetWindow =
      windowId === undefined
        ? await chrome.windows.getLastFocused({ populate: false })
        : await chrome.windows.get(windowId, { populate: false });
    if (!targetWindow.focused || targetWindow.incognito) return;
    const [tab] = await chrome.tabs.query({ active: true, windowId: targetWindow.id });
    const message = sanitizeTab(tab);
    if (message) connect()?.postMessage(message);
  } catch {
    // Browser may be shutting down or no normal window exists.
  }
}

chrome.runtime.onStartup.addListener(() => emitActiveTab());
chrome.runtime.onInstalled.addListener(() => emitActiveTab());
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) emitActiveTab(windowId);
});
chrome.tabs.onActivated.addListener(({ windowId }) => emitActiveTab(windowId));
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (
    tab.active &&
    (changeInfo.title !== undefined || changeInfo.url !== undefined || changeInfo.status === 'complete')
  ) {
    emitActiveTab(tab.windowId);
  }
});

connect();
emitActiveTab();
