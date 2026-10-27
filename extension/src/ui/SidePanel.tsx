import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MSG } from '../core/messaging';
import type { Diagnostics, MessengerMessage, MonitoringState, ScanIntervalMs } from '../core/models';
import { SCAN_INTERVAL_OPTIONS, DEFAULT_SCAN_INTERVAL, emptyDiagnostics } from '../core/models';
import { ConversationView } from './ConversationView';
import { VoiceRecorder } from './VoiceRecorder';
import { DraftEditor, type ComposerInfo, type ComposerInsertOutcome } from './DraftEditor';
import { DiagnosticsView } from './DiagnosticsView';
import { SettingsView } from './SettingsView';
import { TtsControls } from './TtsControls';

type Tab = 'dashboard' | 'conversation' | 'voice' | 'draft' | 'diagnostics' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'Tổng quan' },
  { id: 'conversation', label: 'Hội thoại' },
  { id: 'voice', label: 'Giọng nói' },
  { id: 'draft', label: 'Bản nháp' },
  { id: 'diagnostics', label: 'Chẩn đoán' },
  { id: 'settings', label: 'Cài đặt' },
];

export interface PanelState {
  monitoring: MonitoringState;
  scanInterval: ScanIntervalMs;
  conversation: { key: string; label: string; url: string | null } | null;
  messages: MessengerMessage[];
  diagnostics: Diagnostics;
  conversationChanged: boolean;
  messengerTabFound: boolean;
  contentReady: boolean;
  connectionError: string | null;
}

const INITIAL: PanelState = {
  monitoring: 'idle',
  scanInterval: DEFAULT_SCAN_INTERVAL,
  conversation: null,
  messages: [],
  diagnostics: emptyDiagnostics(),
  conversationChanged: false,
  messengerTabFound: false,
  contentReady: false,
  connectionError: null,
};

export function SidePanel() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [state, setState] = useState<PanelState>(INITIAL);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<{ text: string; kind: 'ok' | 'warn' | 'danger' } | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [liveComposer, setLiveComposer] = useState<ComposerInfo | null>(null);
  const [draftRecipient, setDraftRecipient] = useState<ComposerInfo | null>(null);
  const draftRequest = useRef(crypto.randomUUID());
  const [renderReport, setRenderReport] = useState<{ messages: MessengerMessage[]; count: number } | null>(null);
  const onRendered = useCallback((messages: MessengerMessage[], count: number) => setRenderReport({ messages, count }), []);
  const ttsSnapshot = useMemo(() => ({ monitoring: state.contentReady ? state.monitoring : 'idle' as MonitoringState,
    conversationKey: state.conversation?.key ?? null, sessionStartedAt: state.diagnostics.monitoringSessionStartedAt,
    messages: state.messages }), [state.contentReady, state.monitoring, state.conversation?.key, state.diagnostics.monitoringSessionStartedAt, state.messages]);

  const send = useCallback((type: string, extra: Record<string, unknown> = {}) => {
    return new Promise<unknown>((resolve) => {
      void chrome.windows.getCurrent().then((win) => chrome.runtime.sendMessage({ type, windowId: win.id, ...extra }, (response) => {
        void chrome.runtime.lastError;
        resolve(response ?? null);
      })).catch(() => resolve(null));
    });
  }, []);

  // Ask the content script for the current snapshot on mount.
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      const response = (await send(MSG.getState)) as Partial<PanelState> | null;
      if (!alive) return;
      if (!response) { setState(INITIAL); return; }
      if (response.contentReady === false) { setState({ ...INITIAL, ...response }); return; }
      setState((prev) => ({
        ...prev,
        ...response,
        messengerTabFound: true,
        contentReady: true,
        connectionError: null,
        messages: response.messages ?? prev.messages,
      }));
    };
    void pull();
    const timer = setInterval(pull, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [send]);

  // Live updates pushed by the content script.
  useEffect(() => {
    const listener = (
      message: { source?: string; type?: string; [key: string]: unknown },
      sender: chrome.runtime.MessageSender,
      sendResponse: (r?: unknown) => void,
    ) => {
      if (message?.source !== 'echo-worker' || sender.id !== chrome.runtime.id || message.type !== 'state') return;
      void chrome.windows.getCurrent().then((win) => {
        if (message.windowId !== win.id || !Array.isArray(message.messages)) {
          sendResponse({ delivered: false, reason: 'wrong-panel' }); return;
        }
          setState((prev) => ({
            ...prev,
            messengerTabFound: true,
            contentReady: true,
            connectionError: null,
            messages: (message.messages as MessengerMessage[]) ?? [],
            monitoring: message.monitoring as MonitoringState,
            scanInterval: message.scanInterval as ScanIntervalMs,
            conversation: message.conversation as PanelState['conversation'],
            diagnostics: message.diagnostics as Diagnostics,
            conversationChanged: Boolean(message.conversationChanged),
          }));
          sendResponse({ delivered: true, received: message.messages.length, sequence: message.sequence });
      }).catch(() => sendResponse({ delivered: false, reason: 'panel-error' }));
      return true;
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const flash = useCallback((text: string, kind: 'ok' | 'warn' | 'danger' = 'ok') => {
    setNotice({ text, kind });
    setTimeout(() => setNotice(null), 4000);
  }, []);

  const onStart = useCallback(async () => {
    const response = (await send(MSG.start)) as Partial<PanelState> | null;
    if (response) {
      setState((prev) => ({ ...prev, ...response, messages: response.messages ?? prev.messages }));
    }
    const running = response?.monitoring === 'running';
    flash(running ? 'Đã bắt đầu theo dõi tin nhắn mới. Tin nhắn cũ được đưa vào mốc và không hiển thị.' : 'Không kết nối được. Chọn tab Messenger và tải lại trang sau khi cài tiện ích.', running ? 'ok' : 'warn');
  }, [send, flash]);

  const onPause = useCallback(async () => {
    const response = (await send(MSG.pause)) as Partial<PanelState> | null;
    if (response) setState((prev) => ({ ...prev, ...response }));
  }, [send]);

  const onResume = useCallback(async () => {
    const response = (await send(MSG.resume)) as Partial<PanelState> | null;
    if (response) setState((prev) => ({ ...prev, ...response }));
  }, [send]);

  const onStop = useCallback(async () => {
    const response = (await send(MSG.stop)) as Partial<PanelState> | null;
    setState((prev) => ({
      ...prev,
      ...(response ?? {}),
      messages: response?.messages ?? [],
    }));
    flash('Đã dừng theo dõi và xóa nội dung đã đọc.', 'warn');
  }, [send, flash]);

  const onInterval = useCallback(
    async (interval: ScanIntervalMs) => {
      const response = (await send(MSG.setInterval, { interval })) as Partial<PanelState> | null;
      if (response) setState((prev) => ({ ...prev, ...response }));
    },
    [send],
  );

  const onClearConversation = useCallback(async () => {
    const response = (await send(MSG.clearConversation)) as Partial<PanelState> | null;
    if (response) setState((prev) => ({ ...prev, messages: response.messages ?? [] }));
  }, [send]);

  const queryComposer = useCallback(async (): Promise<ComposerInfo | null> => {
    const response = (await send(MSG.composerStatus)) as ComposerInfo | null;
    return typeof response?.found === 'boolean' ? response : null;
  }, [send]);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      const next = await queryComposer();
      if (alive) setLiveComposer(next);
    };
    void pull();
    const timer = setInterval(pull, 1000);
    return () => { alive = false; clearInterval(timer); };
  }, [queryComposer]);

  const changeDraft = useCallback((value: string) => {
    draftRequest.current = crypto.randomUUID();
    if (!draftRef.current || !value) setDraftRecipient(value && liveComposer?.found ? liveComposer : null);
    draftRef.current = value;
    setDraft(value);
  }, [liveComposer]);

  const confirmRecipient = useCallback(async () => {
    const next = await queryComposer();
    setLiveComposer(next);
    if (next?.found) {
      setDraftRecipient(next);
      draftRequest.current = crypto.randomUUID();
    }
  }, [queryComposer]);

  const insertIntoComposer = useCallback(async (mode: 'append' | 'replace'): Promise<ComposerInsertOutcome | null> => {
    if (!draftRecipient?.conversation || !draftRecipient.tabId) return { ok: false, error: 'conversation-changed' };
    const expectedKey = draftRecipient.conversation.key;
    const response = (await send(MSG.insertDraft, { text: draftRef.current, mode, expectedKey,
      expectedTabId: draftRecipient.tabId, requestId: draftRequest.current })) as ComposerInsertOutcome | null;
    return response;
  }, [send, draftRecipient]);

  const monitoringLabel = useMemo(() => {
    switch (state.monitoring) {
      case 'running':
        return { text: 'Đang theo dõi', cls: 'ok' };
      case 'paused':
        return { text: 'Tạm dừng', cls: 'warn' };
      case 'stopped':
        return { text: 'Đã dừng', cls: 'danger' };
      default:
        return { text: 'Chưa chạy', cls: 'idle' };
    }
  }, [state.monitoring]);

  return (
    <div className="app">
      <header className="header">
        <h1>Echo Assistant</h1>
        <span className={`badge ${monitoringLabel.cls}`}>{monitoringLabel.text}</span>
        <button className="btn danger" onClick={() => void onStop()} disabled={state.monitoring !== 'running' && state.monitoring !== 'paused'}>Dừng theo dõi</button>
      </header>

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            className="tab"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="body">
        <TtsControls snapshot={ttsSnapshot} />
        {notice && (
          <div className={`notice ${notice.kind === 'ok' ? '' : notice.kind}`}>{notice.text}</div>
        )}

        {tab === 'dashboard' && (
          <>
            {!state.messengerTabFound && (
              <div className="notice">
                Không tìm thấy tab Messenger. Hãy mở{' '}
                <strong>https://www.facebook.com/messages</strong> rồi bấm “Bắt đầu”.
              </div>
            )}
            {state.messengerTabFound && !state.contentReady && <div className="notice danger">{state.connectionError ?? 'Content script chưa sẵn sàng. Tải lại Messenger.'}</div>}
            {state.conversationChanged && (
              <div className="notice warn">
                Cuộc trò chuyện đang chọn đã thay đổi. Hãy kiểm tra lại nội dung trước khi soạn trả lời.
              </div>
            )}
            <section className="card">
              <h2>Trạng thái</h2>
              <div className="row">
                <span className="label">Kết nối Messenger</span>
                <span className="value">
                  {state.messengerTabFound ? (
                    <span className="badge ok">Đã mở</span>
                  ) : (
                    <span className="badge idle">Chưa mở</span>
                  )}
                </span>
              </div>
              <div className="row">
                <span className="label">Cuộc trò chuyện</span>
                <span className="value">{state.conversation?.label ?? '—'}</span>
              </div>
              <div className="row">
                <span className="label">Theo dõi</span>
                <span className="value">
                  <span className={`badge ${monitoringLabel.cls}`}>{monitoringLabel.text}</span>
                </span>
              </div>
              <div className="row">
                <span className="label">Chu kỳ quét</span>
                <span className="value">
                  <select
                    value={state.scanInterval}
                    onChange={(e) => void onInterval(Number(e.target.value) as ScanIntervalMs)}
                    disabled={state.messengerTabFound === false}
                  >
                    {SCAN_INTERVAL_OPTIONS.map((ms) => (
                      <option key={ms} value={ms}>
                        {ms / 1000} giây
                      </option>
                    ))}
                  </select>
                </span>
              </div>
              <div className="row">
                <span className="label">Lần quét gần nhất</span>
                <span className="value">
                  {state.diagnostics.lastScanAt
                    ? new Date(state.diagnostics.lastScanAt).toLocaleTimeString('vi-VN')
                    : '—'}
                </span>
              </div>
              <div className="row">
                <span className="label">Tin nhắn phát hiện</span>
                <span className="value">{state.diagnostics.messagesDetected}</span>
              </div>
            </section>

            <section className="card">
              <h2>Điều khiển</h2>
              <div className="btn-row">
                <button
                  className="btn primary"
                  onClick={() => void onStart()}
                  disabled={!state.messengerTabFound || !state.contentReady || state.monitoring === 'running'}
                >
                  Bắt đầu theo dõi
                </button>
                <button
                  className="btn"
                  onClick={() => void onPause()}
                  disabled={state.monitoring !== 'running'}
                >
                  Tạm dừng
                </button>
                <button
                  className="btn"
                  onClick={() => void onResume()}
                  disabled={state.monitoring !== 'paused'}
                >
                  Tiếp tục
                </button>
                <button
                  className="btn danger"
                  onClick={() => void onStop()}
                  disabled={state.monitoring === 'idle'}
                >
                  Dừng
                </button>
                <button className="btn" onClick={() => void onClearConversation()}>
                  Xóa tin nhắn đã đọc
                </button>
              </div>
            </section>
          </>
        )}

        <div hidden={tab !== 'conversation'}>
          <ConversationView
            messages={state.messages}
            conversationLabel={state.conversation?.label ?? null}
            changed={state.conversationChanged}
            onAck={() => void send(MSG.ackConversationChange)}
            diagnostics={state.diagnostics}
            onRendered={onRendered}
          />
        </div>

        {tab === 'voice' && (
          <VoiceRecorder
            key={`${liveComposer?.tabId}:${liveComposer?.conversation?.key}:${liveComposer?.found}`}
            recipientReady={!!liveComposer?.found}
            onTranscript={async (text) => {
              if (!text) return false;
              const source = liveComposer;
              const verified = await queryComposer();
              if (!source?.found || !verified?.found || source.tabId !== verified.tabId ||
                source.conversation?.key !== verified.conversation?.key ||
                (draftRef.current && (draftRecipient?.tabId !== source.tabId || draftRecipient?.conversation?.key !== source.conversation?.key))) {
                flash('Người nhận đã đổi hoặc bản nháp dành cho người khác. Kết quả giọng nói chưa được ghép; hãy sao chép hoặc xác nhận lại người nhận của bản nháp.', 'warn');
                return false;
              }
              // Retain the recipient the dictation UI belonged to. An existing
              // draft for another recipient must never be silently retargeted.
              changeDraft(draftRef.current ? `${draftRef.current}${/\s$/.test(draftRef.current) || /^\s/.test(text) ? '' : ' '}${text}` : text);
              flash('Đã chèn lời nói vào bản nháp.');
              return true;
            }}
          />
        )}

        {tab === 'draft' && (
          <DraftEditor
            value={draft}
            onChange={changeDraft}
            conversationLabel={draftRecipient?.conversation?.label ?? null}
            conversationChanged={!!draft && (!draftRecipient || !liveComposer?.found ||
              draftRecipient.tabId !== liveComposer.tabId || draftRecipient.conversation?.key !== liveComposer.conversation?.key)}
            recipientToken={`${draftRecipient?.tabId}:${draftRecipient?.conversation?.key}`}
            currentRecipient={liveComposer?.found ? liveComposer.conversation?.label ?? null : null}
            confirmRecipient={confirmRecipient}
            queryComposer={queryComposer}
            insertIntoComposer={insertIntoComposer}
          />
        )}

        {tab === 'diagnostics' && (
          <DiagnosticsView
            diagnostics={state.diagnostics}
            renderedMessages={renderReport?.messages === state.messages ? renderReport.count : 0}
            receivedMessages={state.messages.length}
            connected={state.messengerTabFound}
            contentReady={state.contentReady}
            conversationKey={state.conversation?.key}
            connectionError={state.connectionError}
          />
        )}

        {tab === 'settings' && <SettingsView onInterval={onInterval} current={state.scanInterval} />}
      </main>
    </div>
  );
}
