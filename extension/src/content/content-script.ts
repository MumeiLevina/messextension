/**
 * Content script entry point.
 *
 * Runs inside the Messenger page. It owns the monitoring lifecycle and
 * reports state to the side panel through the extension message channel.
 * It performs no network calls and never sends messages.
 */
import {
  extractConversation,
  ADAPTER_VERSION,
  threadKeyFromUrl,
} from './messenger-adapter';
import { NewMessageSession } from '../core/new-message-session';
import { MonitoringController } from './mutation-monitor';
import {
  DEFAULT_SCAN_INTERVAL,
  SCAN_INTERVAL_OPTIONS,
  type Diagnostics,
  type MonitoringState,
  type ScanIntervalMs,
  emptyDiagnostics,
} from '../core/models';

const state = new NewMessageSession();
const diagnostics: Diagnostics = { ...emptyDiagnostics(), adapterVersion: ADAPTER_VERSION };

let monitor: MonitoringController | null = null;
let monitoring: MonitoringState = 'idle';
let scanInterval: ScanIntervalMs = DEFAULT_SCAN_INTERVAL;
let conversationChanged = false;
let observedTarget: Node | null = null;
let lastUrl = location.href;
let lastSignature = '';
let navigationBaseline: string | null = null;
let lastContainer: HTMLElement | null = null;
let navigationContainer: HTMLElement | null = null;
let awaitingThreadContent = false;
let sequence = 0;
let lifecycle = 0;
let lastAcknowledged = 0;
const inertTarget = document.createDocumentFragment();

function checkNavigation(): boolean {
  if (location.href === lastUrl) return false;
  const previousThread = threadKeyFromUrl(lastUrl);
  const nextThread = threadKeyFromUrl(location.href);
  lastUrl = location.href;
  if (previousThread !== null && previousThread === nextThread) return false;
  navigationBaseline = lastSignature;
  navigationContainer = lastContainer;
  awaitingThreadContent = true;
  lifecycle += 1;
  state.forgetConversation();
  conversationChanged = true;
  diagnostics.lastStatus = 'loading';
  diagnostics.lastSent = 0;
  diagnostics.lastSuccessAt = null;
  pushState();
  return true;
}

function isMessengerPage(): boolean {
  return location.hostname === 'www.facebook.com' && location.pathname.startsWith('/messages');
}

function postToPanel(type: string, payload: unknown = {}): void {
  try {
    chrome.runtime.sendMessage({ source: 'echo-content', type, ...(payload as object) }, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    /* the extension context may be gone during reload */
  }
}

function snapshot() {
  Object.assign(diagnostics, state.statistics, { monitoringSessionStatus: monitoring });
  return {
    contentReady: true,
    sequence,
    monitoring,
    scanInterval,
    conversation: state.active,
    messages: state.activeMessages,
    diagnostics: { ...diagnostics },
    conversationChanged,
  };
}

function pushState(): void {
  const sentSequence = ++sequence;
  const generation = lifecycle;
  diagnostics.deliveryState = 'pending';
  try {
    chrome.runtime.sendMessage({ source: 'echo-content', type: 'state', ...snapshot() }, (ack) => {
      const error = chrome.runtime.lastError;
      if (generation !== lifecycle || sentSequence < lastAcknowledged) return;
      lastAcknowledged = sentSequence;
      if (error) {
        diagnostics.deliveryState = 'failed';
        diagnostics.lastDeliveryError = 'Không liên lạc được với service worker. Tải lại tiện ích và trang Messenger.';
        diagnostics.lastStatus = 'communication-failed';
      } else if (ack?.delivered === true && ack.sequence === sentSequence && Number.isInteger(ack.received)) {
        diagnostics.deliveryState = 'delivered';
        diagnostics.lastSent = ack.received;
        diagnostics.lastSentAt = Date.now();
        diagnostics.lastDeliveryError = null;
      } else {
        diagnostics.deliveryState = ack?.reason === 'panel-unavailable' ? 'panel-unavailable' : 'failed';
        diagnostics.lastDeliveryError = ack?.reason === 'panel-unavailable'
          ? 'Bảng điều khiển chưa xác nhận nhận dữ liệu. Mở Echo Assistant.'
          : 'Không nhận được xác nhận chuyển dữ liệu tới bảng điều khiển.';
        if (diagnostics.deliveryState === 'failed') diagnostics.lastStatus = 'communication-failed';
      }
    });
  } catch {
    diagnostics.deliveryState = 'failed';
    diagnostics.lastStatus = 'communication-failed';
    diagnostics.lastDeliveryError = 'Ngữ cảnh tiện ích đã hết hiệu lực. Tải lại Messenger.';
  }
}

/**
 * Performs one extraction pass.
 *
 * Only runs while monitoring is explicitly enabled, and only on the active
 * Messenger tab.
 */
function scan(_reason: 'observer' | 'interval'): void {
  if (monitoring !== 'running') return;
  if (document.visibilityState === 'hidden') return;

  const started = performance.now();
  try {
    checkNavigation();
    const extracted = extractConversation();
    const target = extracted.container ?? inertTarget;
    if (target !== observedTarget) {
      monitor?.retarget(target);
      observedTarget = target;
    }

    // Counters describe what actually happened in this pass.
    diagnostics.lastCandidates = extracted.candidates;
    diagnostics.lastParsed = extracted.parsed;
    diagnostics.lastRejected = extracted.rejected;
    diagnostics.lastStatus = extracted.status;
    diagnostics.domSupported = !extracted.unsupported && extracted.container !== null;
    diagnostics.strategy = extracted.strategy;
    diagnostics.containerFound = extracted.container !== null;
    diagnostics.lastDuplicates = 0;

    const signature = JSON.stringify([
      extracted.messages.map((m) => [m.domId, m.text]),
    ]);
    if (navigationBaseline !== null && signature === navigationBaseline && extracted.container === navigationContainer) {
      diagnostics.lastStatus = 'loading';
      diagnostics.lastError = 'Đang chờ nội dung cuộc trò chuyện mới.';
      return;
    }
    navigationBaseline = null;
    lastSignature = signature;
    lastContainer = extracted.container;

    if (extracted.unsupported || ['loading', 'no-conversation', 'all-rejected'].includes(extracted.status)) {
      // The DOM layout is not recognised. This is an extraction failure, not an
      // empty conversation, and must not be reported as "0 messages".
      state.markUnavailable();
      if (extracted.unsupported || extracted.status === 'all-rejected') diagnostics.parseErrors += 1;
      diagnostics.lastError = extracted.warning;
      diagnostics.lastScanAt = Date.now();
      return;
    }

    // A newly navigated pane may be momentarily empty before older history is
    // hydrated. Do not promote that transient empty pane to an empty baseline.
    if (state.active && state.active.key !== extracted.conversation.key && extracted.messages.length === 0) {
      state.forgetConversation(); awaitingThreadContent = true;
    }
    if (awaitingThreadContent && extracted.messages.length === 0) {
      diagnostics.lastStatus = 'loading';
      diagnostics.lastError = 'Đang chờ cửa sổ tin nhắn đầu tiên để tạo mốc cho cuộc trò chuyện mới.';
      state.markUnavailable();
      return;
    }
    awaitingThreadContent = false;

    const changed = state.select(extracted.conversation);
    if (changed) {
      conversationChanged = true;
      diagnostics.messagesDetected = 0;
    }

    const added = state.ingest(extracted.messages, { atBottom: extracted.atBottom });
    diagnostics.messagesDetected += added.length;
    diagnostics.duplicatesPrevented += state.lastDuplicateCount();
    diagnostics.lastDuplicates = state.lastDuplicateCount();
    diagnostics.changesProcessed += 1;
    diagnostics.lastError = extracted.warning;
    if (extracted.status === 'ok') diagnostics.lastSuccessAt = Date.now();
    if (extracted.parsed > 0 && added.length === 0) diagnostics.lastStatus = 'already-ingested';
    if (state.lastIngestKind === 'baseline') diagnostics.lastStatus = 'baseline';
    if (state.lastIngestKind === 'backfill') diagnostics.lastStatus = 'historical-backfill';
    if (state.lastIngestKind === 'unanchored') diagnostics.lastStatus = 'unanchored';
  } catch (error) {
    diagnostics.parseErrors += 1;
    diagnostics.lastStatus = 'error';
    diagnostics.lastError = error instanceof Error ? error.message : String(error);
  } finally {
    const latency = performance.now() - started;
    diagnostics.lastLatencyMs = latency;
    diagnostics.avgLatencyMs =
      diagnostics.avgLatencyMs === 0
        ? latency
        : diagnostics.avgLatencyMs * 0.8 + latency * 0.2;
    diagnostics.lastScanAt = Date.now();
    diagnostics.scanCount += 1;
    pushState();
  }
}

function startMonitoring(): void {
  if (monitoring === 'running') return;

  monitor?.stop();
  lifecycle += 1;
  state.beginSession();
  Object.assign(diagnostics, emptyDiagnostics(), { adapterVersion: ADAPTER_VERSION });
  lastUrl = location.href;
  lastSignature = '';
  navigationBaseline = null;
  lastContainer = null;
  navigationContainer = null;
  awaitingThreadContent = false;
  monitor = new MonitoringController({
    intervalMs: scanInterval,
    onScan: scan,
    onError: (e) => {
      diagnostics.lastError = e instanceof Error ? e.message : String(e);
    },
  });

  // Observe the conversation region, not the whole page.
  const target = inertTarget;
  monitor.start(target);
  observedTarget = target;
  monitoring = 'running';
  conversationChanged = false;

  // Read immediately to establish a silent historical baseline. Only later
  // arrivals may enter the panel's tracked-message output.
  scan('interval');
}

function pauseMonitoring(): void {
  if (monitoring !== 'running') return;
  monitor?.pause();
  monitoring = 'paused';
  pushState();
}

function resumeMonitoring(): void {
  if (monitoring !== 'paused') return;
  monitor?.resume(inertTarget);
  observedTarget = inertTarget;
  monitoring = 'running';
  scan('interval');
  pushState();
}

function stopMonitoring(): void {
  monitor?.stop();
  monitor = null;
  monitoring = 'stopped';
  lifecycle += 1;
  state.reset();
  diagnostics.messagesDetected = 0;
  diagnostics.lastStatus = 'stopped';
  diagnostics.lastCandidates = 0;
  diagnostics.lastParsed = 0;
  diagnostics.lastRejected = 0;
  diagnostics.lastDuplicates = 0;
  diagnostics.lastSent = 0;
  diagnostics.lastError = null;
  conversationChanged = false;
  pushState();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return;

  switch (message.type) {
    case 'echo:start':
      startMonitoring();
      sendResponse(snapshot());
      return true;
    case 'echo:pause':
      pauseMonitoring();
      sendResponse(snapshot());
      return true;
    case 'echo:resume':
      resumeMonitoring();
      sendResponse(snapshot());
      return true;
    case 'echo:stop':
      stopMonitoring();
      sendResponse(snapshot());
      return true;
    case 'echo:setInterval':
      if (!SCAN_INTERVAL_OPTIONS.includes(message.interval)) {
        sendResponse(snapshot());
        return;
      }
      scanInterval = message.interval as ScanIntervalMs;
      monitor?.setInterval(scanInterval);
      pushState();
      sendResponse(snapshot());
      return true;
    case 'echo:getState':
      sendResponse(snapshot());
      return true;
    case 'echo:clearConversation':
      state.clearActive();
      pushState();
      sendResponse(snapshot());
      return true;
    case 'echo:ackConversationChange':
      conversationChanged = false;
      pushState();
      sendResponse(snapshot());
      return true;
    default:
      return undefined;
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && monitoring === 'running') {
    scan('interval');
  }
});

// A URL change means the selected conversation may have switched.
const urlWatcher = setInterval(() => {
  if (!checkNavigation()) return;
  if (monitoring === 'running') {
    // Wait for the new pane to settle; never label the old pane with a new URL.
    setTimeout(() => scan('interval'), 300);
  }
}, 1000);

window.addEventListener('pagehide', () => {
  clearInterval(urlWatcher);
  monitor?.stop();
});

postToPanel('ready', { isMessenger: isMessengerPage() });
