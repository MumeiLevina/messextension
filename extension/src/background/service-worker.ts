import { MSG } from '../core/messaging';

let monitoredTab: number | null = null;
const isMessenger = (url?: string) => !!url && /^https:\/\/www\.facebook\.com\/messages(?:\/|\?|$)/.test(url);

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});
chrome.action.onClicked.addListener((tab) => {
  if (tab.windowId !== undefined) void chrome.sidePanel.open({ windowId: tab.windowId });
});

async function selectedTab(windowId?: number): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query(windowId === undefined
    ? { active: true, lastFocusedWindow: true }
    : { active: true, windowId });
  return tab?.id && isMessenger(tab.url) ? tab : null;
}

async function stopPrevious(next: number | null): Promise<void> {
  if (monitoredTab !== null && monitoredTab !== next) {
    await chrome.tabs.sendMessage(monitoredTab, { type: MSG.stop }).catch(() => undefined);
    monitoredTab = null;
  }
}

async function toContent(message: { type: string; windowId?: number; expectedTabId?: number }): Promise<unknown> {
  const tab = await selectedTab(message.windowId);
  await stopPrevious(tab?.id ?? null);
  if (!tab?.id) return null;
  if (message.type === MSG.insertDraft) {
    // stopPrevious can await another tab. Recheck after that boundary.
    const current = await selectedTab(message.windowId);
    if (message.expectedTabId !== tab.id || current?.id !== tab.id) {
      return { ok: false, error: 'conversation-changed' };
    }
  }
  try {
    const result = await chrome.tabs.sendMessage(tab.id, message);
    if (message.type === MSG.start || message.type === MSG.resume) monitoredTab = tab.id;
    if (message.type === MSG.stop) monitoredTab = null;
    return { ...result, tabId: tab.id, messengerTabFound: true, contentReady: true, connectionError: null };
  } catch {
    return { messengerTabFound: true, contentReady: false,
      connectionError: 'Tab Messenger đã mở nhưng content script chưa phản hồi. Tải lại trang sau khi nạp hoặc cập nhật tiện ích.' };
  }
}

chrome.tabs.onActivated.addListener(({ tabId }) => { void stopPrevious(tabId); });
chrome.tabs.onRemoved.addListener((tabId) => { if (monitoredTab === tabId) monitoredTab = null; });

const commands: string[] = [MSG.start, MSG.pause, MSG.resume, MSG.stop, MSG.getState,
  MSG.setInterval, MSG.clearConversation, MSG.ackConversationChange,
  MSG.composerStatus, MSG.insertDraft];
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return;
  if (commands.includes(message.type) && message.source !== 'echo-content') {
    toContent(message).then(sendResponse, () => sendResponse(null));
    return true;
  }
  if (message.source === 'echo-content' && message.type === 'state' && sender.tab?.id) {
    const tabId = sender.tab.id;
    const windowId = sender.tab.windowId;
    selectedTab(windowId).then(async (tab) => {
      if (tab?.id !== tabId) return { delivered: false, reason: 'inactive-tab' };
      try {
        const ack = await chrome.runtime.sendMessage({ ...message, source: 'echo-worker', tabId, windowId });
        return ack?.delivered === true && ack.sequence === message.sequence
          ? ack : { delivered: false, reason: 'panel-unavailable' };
      } catch { return { delivered: false, reason: 'panel-unavailable' }; }
    }).then(sendResponse, () => sendResponse({ delivered: false, reason: 'relay-failed' }));
    return true;
  }
  if (message.type === 'echo:capture') {
    selectedTab(message.windowId).then(async (tab) => {
      if (!tab) return null;
      return chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }).catch(() => null);
    }).then(dataUrl => sendResponse({ dataUrl }), () => sendResponse({ dataUrl: null }));
    return true;
  }
  return undefined;
});
