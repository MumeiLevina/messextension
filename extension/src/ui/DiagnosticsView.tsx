import { useEffect, useState } from 'react';
import type { Diagnostics, ExtractionStatus } from '../core/models';
import { isOcrAvailable } from '../ocr/ocr-engine';
import { probeSpeechSupport, type SpeechCapabilities } from '../speech/speech-capabilities';

interface Props {
  diagnostics: Diagnostics;
  /** Number of messages currently rendered in the conversation view. */
  renderedMessages?: number;
  /** Number of messages received from the content script. */
  receivedMessages?: number;
  connected?: boolean;
  contentReady?: boolean;
  conversationKey?: string | null;
  connectionError?: string | null;
}

const STATUS_LABEL: Record<ExtractionStatus, string> = {
  idle: 'Chưa quét',
  ok: 'OK',
  'no-conversation': 'Chưa nhận diện cuộc trò chuyện',
  'no-container': 'Chưa tìm thấy vùng tin nhắn',
  'no-visible-messages': 'Vùng tin nhắn trống',
  'all-rejected': 'Không đọc được nội dung',
  error: 'Lỗi',
  loading: 'Cuộc trò chuyện đang tải',
  'already-ingested': 'Tin nhắn đã được tiếp nhận',
  'communication-failed': 'Lỗi liên lạc với bảng',
  stopped: 'Đã dừng theo dõi',
  baseline: 'Đã tạo mốc; chờ tin nhắn mới',
  'historical-backfill': 'Đã bỏ qua lịch sử tải thêm',
  unanchored: 'Thiếu mốc thứ tự; đã bỏ qua an toàn',
};

const STATUS_KIND: Record<ExtractionStatus, string> = {
  idle: 'idle',
  ok: 'ok',
  'no-conversation': 'danger',
  'no-container': 'danger',
  'no-visible-messages': 'warn',
  'all-rejected': 'danger',
  error: 'danger',
  loading: 'warn',
  'already-ingested': 'ok',
  'communication-failed': 'danger',
  stopped: 'idle',
  baseline: 'ok',
  'historical-backfill': 'ok',
  unanchored: 'warn',
};

function ago(ts: number | null): string {
  if (!ts) return '—';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s} giây trước`;
  return `${Math.round(s / 60)} phút trước`;
}

export function DiagnosticsView({ diagnostics, renderedMessages, receivedMessages, connected, contentReady, conversationKey, connectionError }: Props) {
  const [ocr, setOcr] = useState<boolean | null>(null);
  const [speech, setSpeech] = useState<SpeechCapabilities | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    void isOcrAvailable().then(setOcr);
    void probeSpeechSupport().then(setSpeech);
    const timer = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <>
      <section className="card">
        <h2>Phiên theo dõi tin nhắn mới</h2>
        <div className="row"><span className="label">Trạng thái phiên</span><span className="value" data-testid="session-status">{diagnostics.monitoringSessionStatus}</span></div>
        <div className="row"><span className="label">Bắt đầu phiên</span><span className="value">{diagnostics.monitoringSessionStartedAt ? new Date(diagnostics.monitoringSessionStartedAt).toLocaleTimeString('vi-VN') : '—'}</span></div>
        <div className="row"><span className="label">Đã tạo mốc</span><span className="value" data-testid="baseline-established">{diagnostics.baselineEstablished ? 'Có' : 'Chưa'}</span></div>
        <div className="row"><span className="label">Đã neo cuối hội thoại</span><span className="value" data-testid="tail-anchor-established">{diagnostics.tailAnchorEstablished ? 'Có' : 'Chưa'}</span></div>
        <div className="row"><span className="label">Tin nhắn trong mốc</span><span className="value" data-testid="baseline-count">{diagnostics.baselineMessageCount}</span></div>
        <div className="row"><span className="label">Tin nhắn đã biết</span><span className="value" data-testid="known-count">{diagnostics.knownMessageCount}</span></div>
        <div className="row"><span className="label">Tin nhắn mới đã phát</span><span className="value" data-testid="new-emitted-count">{diagnostics.newMessagesEmittedCount}</span></div>
        <div className="row"><span className="label">Tin cũ đã bỏ qua</span><span className="value" data-testid="historical-suppressed-count">{diagnostics.suppressedHistoricalCount}</span></div>
        <div className="row"><span className="label">Trùng lặp đã bỏ qua</span><span className="value" data-testid="duplicate-suppressed-count">{diagnostics.suppressedDuplicateCount}</span></div>
        <div className="row"><span className="label">Lịch sử tải thêm đã bỏ qua</span><span className="value" data-testid="backfill-suppressed-count">{diagnostics.suppressedBackfillCount}</span></div>
        <div className="row"><span className="label">Thiếu mốc thứ tự đã bỏ qua</span><span className="value" data-testid="unanchored-suppressed-count">{diagnostics.suppressedUnanchoredCount}</span></div>
      </section>
      <section className="card">
        <h2>Kết nối và nhận diện</h2>
        <div className="row"><span className="label">Tab Messenger</span><span className="value" data-testid="messenger-connected">{connected ? 'Đã kết nối' : 'Chưa kết nối'}</span></div>
        <div className="row"><span className="label">Content script</span><span className="value" data-testid="content-ready">{contentReady ? 'Sẵn sàng' : 'Chưa phản hồi'}</span></div>
        <div className="row"><span className="label">Mã cuộc trò chuyện</span><span className="value mono" data-testid="conversation-key">{conversationKey ?? '—'}</span></div>
        <div className="row"><span className="label">Vùng hội thoại</span><span className="value" data-testid="container-status">{diagnostics.containerFound ? 'Đã tìm thấy' : 'Chưa tìm thấy'}</span></div>
        <div className="row"><span className="label">Chiến lược adapter</span><span className="value mono" data-testid="adapter-strategy">{diagnostics.strategy}</span></div>
        {connectionError && <div className="notice danger">{connectionError}</div>}
      </section>
      <section className="card">
        <h2>Trích xuất DOM</h2>
        <div className="row">
          <span className="label">Adapter</span>
          <span className="value mono">v{diagnostics.adapterVersion}</span>
        </div>
        <div className="row">
          <span className="label">Đọc được DOM</span>
          <span className="value">
            {diagnostics.domSupported ? (
              <span className="badge ok">Có</span>
            ) : (
              <span className="badge idle">Chưa xác nhận</span>
            )}
          </span>
        </div>
        <div className="row">
          <span className="label">Số lần quét</span>
          <span className="value">{diagnostics.scanCount}</span>
        </div>
        <div className="row">
          <span className="label">Quét gần nhất</span>
          <span className="value">{ago(diagnostics.lastScanAt)}</span>
        </div>
        <div className="row"><span className="label">Quét thành công gần nhất</span><span className="value" data-testid="last-success">{ago(diagnostics.lastSuccessAt)}</span></div>
        <div className="row">
          <span className="label">Độ trễ lượt cuối</span>
          <span className="value">{diagnostics.lastLatencyMs.toFixed(1)} ms</span>
        </div>
        <div className="row">
          <span className="label">Độ trễ trung bình</span>
          <span className="value">{diagnostics.avgLatencyMs.toFixed(1)} ms</span>
        </div>
      </section>

      <section className="card">
        <h2>Đường ống quét gần nhất</h2>
        <div className="row">
          <span className="label">Trạng thái</span>
          <span className="value">
            <span className={`badge ${STATUS_KIND[diagnostics.lastStatus] ?? 'idle'}`}>
              {STATUS_LABEL[diagnostics.lastStatus] ?? diagnostics.lastStatus}
            </span>
          </span>
        </div>
        <div className="row">
          <span className="label">Hàng tin nhắn (ứng viên)</span>
          <span className="value" data-testid="candidate-count">{diagnostics.lastCandidates}</span>
        </div>
        <div className="row">
          <span className="label">Tin nhắn đọc được</span>
          <span className="value" data-testid="parsed-count">{diagnostics.lastParsed}</span>
        </div>
        <div className="row">
          <span className="label">Hàng bị loại</span>
          <span className="value" data-testid="rejected-count">{diagnostics.lastRejected}</span>
        </div>
        <div className="row">
          <span className="label">Trùng lặp chặn (lần)</span>
          <span className="value" data-testid="deduplicated-count">{diagnostics.lastDuplicates}</span>
        </div>
        <div className="row">
          <span className="label">Bảng xác nhận nhận (snapshot)</span>
          <span className="value" data-testid="delivered-count">{diagnostics.lastSent}</span>
        </div>
        <div className="row"><span className="label">Trạng thái chuyển dữ liệu</span><span className="value" data-testid="delivery-state">{diagnostics.deliveryState}</span></div>
        {diagnostics.lastDeliveryError && <p className="notice warn">{diagnostics.lastDeliveryError}</p>}
        {typeof receivedMessages === 'number' && (
          <div className="row">
            <span className="label">Bảng nhận được</span>
            <span className="value" data-testid="received-count">{receivedMessages}</span>
          </div>
        )}
        {typeof renderedMessages === 'number' && (
          <div className="row">
            <span className="label">Hiển thị trong Hội thoại</span>
            <span className="value" data-testid="rendered-count">{renderedMessages}</span>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Bộ đếm</h2>
        <div className="row">
          <span className="label">Tin nhắn phát hiện</span>
          <span className="value">{diagnostics.messagesDetected}</span>
        </div>
        <div className="row">
          <span className="label">Lần thay đổi xử lý</span>
          <span className="value">{diagnostics.changesProcessed}</span>
        </div>
        <div className="row">
          <span className="label">Trùng lặp đã chặn</span>
          <span className="value">{diagnostics.duplicatesPrevented}</span>
        </div>
        <div className="row">
          <span className="label">Lỗi phân tích</span>
          <span className="value">{diagnostics.parseErrors}</span>
        </div>
        {diagnostics.lastError && (
          <div className="notice danger" style={{ marginTop: 10 }}>
            {diagnostics.lastError}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Công cụ</h2>
        <div className="row">
          <span className="label">OCR (Tesseract, cục bộ)</span>
          <span className="value">
            {ocr === null ? 'Đang kiểm tra…' : ocr ? (
              <span className="badge ok">Sẵn sàng</span>
            ) : (
              <span className="badge idle">Không tải được</span>
            )}
          </span>
        </div>
        <div className="row">
          <span className="label">Nhận dạng giọng nói</span>
          <span className="value">
            {!speech ? (
              'Đang kiểm tra…'
            ) : speech.vietnamese ? (
              <span className="badge ok">vi-VN</span>
            ) : (
              <span className="badge danger">Không dùng được</span>
            )}
          </span>
        </div>
        <div className="row">
          <span className="label">Xử lý cục bộ</span>
          <span className="value">
            {speech?.offline ? (
              <span className="badge ok">Có</span>
            ) : (
              <span className="badge warn">Không — có thể dùng dịch vụ cloud</span>
            )}
          </span>
        </div>
        {speech && (
          <p className="label" style={{ marginTop: 8 }}>
            {speech.detail}
          </p>
        )}
      </section>
    </>
  );
}
