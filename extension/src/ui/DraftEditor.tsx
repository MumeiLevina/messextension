import { useEffect, useRef, useState } from 'react';

export interface ComposerInfo {
  tabId?: number;
  found: boolean;
  variant: 'contenteditable' | 'textarea' | 'unknown';
  conversation: { key: string; label: string; url: string | null } | null;
  hasText: boolean;
  error: string | null;
}

export interface ComposerInsertOutcome {
  ok: boolean;
  error?: string | null;
  mode?: string;
  insertedChars?: number;
  conversation?: ComposerInfo['conversation'];
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  conversationLabel: string | null;
  conversationChanged: boolean;
  recipientToken: string;
  currentRecipient: string | null;
  confirmRecipient: () => Promise<void>;
  /** Reads the live composer state in the Messenger tab. Resolves null when unreachable. */
  queryComposer: () => Promise<ComposerInfo | null>;
  /** Inserts the current draft; mode required when the composer already has text. */
  insertIntoComposer: (mode: 'append' | 'replace') => Promise<ComposerInsertOutcome | null>;
}

type ComposerError =
  | 'composer-not-found'
  | 'composer-ambiguous'
  | 'conversation-changed'
  | 'empty-text'
  | 'mutation-failed';

const COMPOSER_ERRORS: Record<ComposerError, string> = {
  'composer-not-found': 'Không tìm thấy ô soạn tin nhắn. Hãy chọn cuộc trò chuyện trong Messenger rồi dùng Sao chép và dán thủ công.',
  'composer-ambiguous': 'Nhiều ô soạn tin nhắn đang hiển thị, không thể xác định đúng ô. Hãy dùng Sao chép và dán thủ công.',
  'conversation-changed': 'Cuộc trò chuyện trong Messenger đã đổi kể từ khi bấm. Xác nhận lại người nhận hoặc sao chép thủ công.',
  'empty-text': 'Bản nháp trống, không có gì để chèn.',
  'mutation-failed': 'Chèn vào ô soạn không thành công. Bản nháp được giữ lại — hãy dùng Sao chép và dán thủ công.',
};

/**
 * The outgoing draft.
 *
 * The extension never sends a message. It can insert the text into the
 * selected conversation's composer on an explicit user action; the user then
 * reads it in Messenger and presses Send themselves.
 */
export function DraftEditor({
  value,
  onChange,
  conversationLabel,
  conversationChanged,
  recipientToken,
  currentRecipient,
  confirmRecipient,
  queryComposer,
  insertIntoComposer,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composer, setComposer] = useState<ComposerInfo | null>(null);
  const [mode, setMode] = useState<'append' | 'replace'>('append');
  const [inserting, setInserting] = useState(false);
  const [inserted, setInserted] = useState(false);
  const inFlight = useRef(false);
  const latest = useRef({ value, recipientToken, conversationChanged });
  latest.current = { value, recipientToken, conversationChanged };

  useEffect(() => {
    let alive = true;
    void queryComposer().then(next => { if (alive) setComposer(next); }).catch(() => undefined);
    setMode('append');
    setInserted(false);
    setError(null);
    return () => { alive = false; };
  }, [queryComposer, recipientToken]);

  useEffect(() => { setInserted(false); }, [value, conversationChanged]);

  const handleCopy = async () => {
    if (!value.trim()) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setError(null);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback for panels where the clipboard API is blocked.
      try {
        const area = document.createElement('textarea');
        area.value = value;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        try {
          area.select();
          if (!document.execCommand('copy')) throw new Error('Copy rejected');
        } finally { area.remove(); }
        setCopied(true);
        setError(null);
        setTimeout(() => setCopied(false), 2500);
      } catch {
        setError('Không sao chép được. Hãy bôi đen và sao chép thủ công.');
      }
    }
  };

  const handleInsert = async () => {
    if (inFlight.current || !value.trim()) return;
    inFlight.current = true;
    setInserting(true);
    setError(null);
    setInserted(false);
    const captured = latest.current;
    let result: ComposerInsertOutcome | null = null;
    try { result = await insertIntoComposer(mode); }
    catch { /* Keep the draft and use the same manual-copy fallback. */ }
    finally { inFlight.current = false; setInserting(false); }
    if (captured.value !== latest.current.value || captured.recipientToken !== latest.current.recipientToken) return;
    if (latest.current.conversationChanged) {
      setError(COMPOSER_ERRORS['conversation-changed']);
      return;
    }
    if (!result) {
      setError('Không liên lạc được với tab Messenger. Hãy chọn tab Messenger rồi thử lại, hoặc sao chép thủ công.');
      return;
    }
    if (result.ok) {
      setInserted(true);
      // Re-read so the mode prompt reflects the composer's new state.
      const next = await queryComposer().catch(() => null);
      if (next) setComposer(next);
      return;
    }
    const key = (result.error ?? 'mutation-failed') as ComposerError;
    setError(COMPOSER_ERRORS[key] ?? 'Chèn không thành công. Bản nháp được giữ lại — hãy sao chép thủ công.');
  };

  const handleClear = () => {
    onChange('');
    setCopied(false);
    setError(null);
    setInserted(false);
  };

  return (
    <>
      <section className="card">
        <h2>Bản nháp trả lời</h2>
        <div className="row">
          <span className="label">Gửi cho</span>
          <span className="value" data-testid="draft-recipient">{conversationLabel ?? (!value ? currentRecipient : null) ?? 'Chưa xác định'}</span>
        </div>
        {conversationChanged && (
          <div className="notice warn" style={{ marginTop: 8 }}>
            Bản nháp vẫn dành cho {conversationLabel ?? 'người nhận chưa xác định'}. Messenger hiện chọn {currentRecipient ?? 'chưa xác định'}. Chỉ đổi người nhận khi bạn xác nhận.
            <button className="btn" onClick={() => void confirmRecipient()} disabled={inserting} data-testid="confirm-recipient">Xác nhận người nhận hiện tại</button>
          </div>
        )}
        <textarea
          rows={9}
          value={value}
          placeholder="Nhập tay, hoặc chèn lời nói từ tab Giọng nói…"
          onChange={(e) => onChange(e.target.value)}
          style={{ marginTop: 10 }}
        />
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button
            className="btn primary"
            onClick={() => void handleInsert()}
            disabled={!value.trim() || inserting}
            data-testid="insert-messenger"
          >
            {inserted ? '✓ Đã chèn vào Messenger' : inserting ? 'Đang chèn…' : '📥 Chèn vào Messenger'}
          </button>
          {composer?.hasText && (
            <label style={{ alignItems: 'center' }}>
              <span className="label">Ô soạn đã có văn bản:</span>
              <select
                aria-label="Cách chèn vào ô soạn"
                value={mode}
                onChange={(e) => setMode(e.target.value === 'replace' ? 'replace' : 'append')}
                disabled={inserting}
                style={{ marginLeft: 6 }}
              >
                <option value="append">Thêm vào</option>
                <option value="replace">Thay thế</option>
              </select>
            </label>
          )}
          <button className="btn" onClick={() => void handleCopy()} disabled={!value.trim()}>
            {copied ? '✓ Đã sao chép' : '📋 Sao chép'}
          </button>
          <button className="btn" onClick={handleClear} disabled={!value}>
            Xóa
          </button>
        </div>
        {inserted && (
          <div className="notice ok" style={{ marginTop: 10 }}>
            Đã chèn vào ô soạn. Kiểm tra nội dung trong Messenger rồi <strong>bạn tự bấm nút Gửi</strong> — Echo Assistant không gửi thay bạn.
          </div>
        )}
        {error && (
          <div className="notice danger" style={{ marginTop: 10 }}>
            {error}
          </div>
        )}
        <div className="row" style={{ marginTop: 6 }}>
          <span className="label">Độ dài</span>
          <span className="value">{value.length} ký tự</span>
        </div>
      </section>

      <section className="card">
        <h2>Chuyển sang Messenger</h2>
        <ul className="plain">
          <li>Bấm “Chèn vào Messenger”, hoặc “Sao chép” rồi dán (Ctrl+V) trong Messenger.</li>
          <li>Ô soạn của cuộc trò chuyện đang chọn sẽ nhận văn bản; văn bản có sẵn được giữ lại trừ khi bạn chọn “Thay thế”.</li>
          <li>
            <strong>Bạn tự bấm nút Gửi.</strong> Echo Assistant không bao giờ gửi thay bạn.
          </li>
        </ul>
      </section>
    </>
  );
}
