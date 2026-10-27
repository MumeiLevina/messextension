
import { useLayoutEffect, useRef } from 'react';
import type { Diagnostics, ExtractionStatus, MessengerMessage } from '../core/models';

interface Props {
  messages: MessengerMessage[];
  conversationLabel: string | null;
  changed: boolean;
  onAck: () => void;
  /** Sanitized counters from the content script, used to explain an empty view. */
  diagnostics?: Diagnostics;
  onRendered?: (messages: MessengerMessage[], count: number) => void;
}

const EMPTY_HINT: Record<ExtractionStatus, string> = {
  idle: 'Bấm “Bắt đầu theo dõi” ở tab Tổng quan sau khi bạn đã chọn một cuộc trò chuyện trong Messenger.',
  'no-conversation': 'Chưa nhận diện được cuộc trò chuyện đang chọn trong Messenger.',
  'no-container':
    'Chưa tìm thấy vùng hiển thị tin nhắn trong Messenger. Facebook có thể đã đổi giao diện — hãy tải lại trang Messenger rồi bắt đầu lại.',
  'no-visible-messages':
    'Đã tìm thấy vùng tin nhắn nhưng chưa có tin nhắn nào được hiển thị trong khung đang mở. Hãy cuộn hoặc mở một cuộc trò chuyện có tin nhắn.',
  'all-rejected':
    'Đã tìm thấy vùng tin nhắn nhưng không đọc được nội dung nào. Xem tab Chẩn đoán để biết chi tiết.',
  error: 'Đã xảy ra lỗi khi đọc tin nhắn. Xem tab Chẩn đoán để biết chi tiết.',
  ok: 'Chưa có tin nhắn nào được đọc.',
  loading: 'Cuộc trò chuyện đang tải. Chờ nội dung mới hiển thị.',
  'already-ingested': 'Các tin nhắn trong khung đã được đọc trước đó.',
  'communication-failed': 'Không chuyển được trạng thái tới bảng điều khiển. Hãy tải lại tiện ích và Messenger.',
  stopped: 'Đã dừng theo dõi và xóa nội dung đã đọc.',
  baseline: 'Đã tạo mốc theo dõi. Chỉ hiển thị tin nhắn mới từ bây giờ.',
  'historical-backfill': 'Đã bỏ qua lịch sử được tải khi cuộn. Đang theo dõi tin nhắn mới.',
  unanchored: 'Khung tin nhắn đã thay đổi hoàn toàn. Đã bỏ qua nội dung chưa xác định được thứ tự để tránh báo tin cũ là tin mới.',
};

/**
 * Renders the detected messages.
 *
 * Direction is shown when we are confident enough: an explicit marker, or a
 * geometry heuristic. When the direction is unknown the bubble is rendered in
 * a neutral, dashed style so the user is never misled.
 */
export function ConversationView({ messages, conversationLabel, changed, onAck, diagnostics, onRendered }: Props) {
  const messagesRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    onRendered?.(messages, messagesRef.current?.querySelectorAll(':scope > .bubble').length ?? 0);
  }, [messages, onRendered]);
  if (messages.length === 0) {
    const status = diagnostics?.lastStatus ?? 'idle';
    const hint = EMPTY_HINT[status] ?? EMPTY_HINT.idle;
    const failed = ['error', 'no-container', 'all-rejected', 'communication-failed'].includes(status);

    return (
      <section className="card">
        <h2>Hội thoại</h2>
        <p className="label">{diagnostics?.baselineEstablished && ['already-ingested', 'no-visible-messages', 'ok'].includes(status)
          ? 'Đang theo dõi tin nhắn mới. Tin nhắn cũ trước thời điểm bắt đầu đã bị bỏ qua.' : hint}</p>
        {diagnostics?.baselineEstablished && !diagnostics.tailAnchorEstablished && <p className="notice warn">Mốc bắt đầu nằm trong lịch sử. Cuộn xuống cuối hội thoại để neo tin mới; phần lịch sử được tải thêm sẽ tiếp tục bị bỏ qua.</p>}
        {failed && (
          <div className="notice danger" style={{ marginTop: 10 }}>
            {diagnostics?.lastError ?? 'Không đọc được nội dung cuộc trò chuyện.'}
          </div>
        )}
        {diagnostics && (
          <p className="label mono" style={{ marginTop: 8 }}>
            Ứng viên: {diagnostics.lastCandidates} · Đọc được: {diagnostics.lastParsed} · Bị loại:{' '}
            {diagnostics.lastRejected} · Trùng: {diagnostics.lastDuplicates}
          </p>
        )}
      </section>
    );
  }

  return (
    <>
      <section className="card">
        <h2>Hội thoại</h2>
        <p className="label">Chỉ hiển thị tin nhắn mới sau mốc theo dõi. Lịch sử trước đó đã được bỏ qua.</p>
        <div className="row">
          <span className="label">Cuộc trò chuyện</span>
          <span className="value">{conversationLabel ?? '—'}</span>
        </div>
        <div className="row">
          <span className="label">Số tin nhắn</span>
          <span className="value">{messages.length}</span>
        </div>
        {diagnostics && diagnostics.lastStatus === 'no-visible-messages' && (
          <div className="notice warn" style={{ marginTop: 10 }}>
            Đây là các tin nhắn đang được hiển thị. Messenger chỉ render một phần lịch sử, nên danh sách
            có thể chưa đầy đủ.
          </div>
        )}
      </section>

      {changed && (
        <div className="notice warn">
          <div>Cuộc trò chuyện đang chọn đã thay đổi. Hãy kiểm tra người nhận trước khi soạn bản nháp.</div>
          <div style={{ marginTop: 6 }}>
            <button className="btn" onClick={onAck}>
              Tôi đã kiểm tra
            </button>
          </div>
        </div>
      )}

      <section className="card">
        <h2>Tin nhắn</h2>
        <div className="messages" ref={messagesRef}>
          {messages.map((m) => {
            const confident = m.direction !== 'unknown';
            const cls = confident ? m.direction : 'unknown';
            return (
              <div key={m.id || `${m.conversationKey}-${m.ordinal}-${m.detectedAt}`} className={`bubble ${cls}`}>
                {m.text}
                <div className="meta">
                  {m.timestamp ? `${m.timestamp} · ` : ''}
                  {m.direction === 'incoming'
                    ? 'Người nhận'
                    : m.direction === 'outgoing'
                      ? 'Bạn'
                      : 'Không rõ hướng'}
                  {m.directionIsHeuristic ? ' (ước lượng)' : ''}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
