import { useState } from 'react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  conversationLabel: string | null;
  conversationChanged: boolean;
}

/**
 * The outgoing draft.
 *
 * The extension never sends a message. It prepares the text, the user copies
 * it, and the user pastes and presses Send in Messenger themselves.
 */
export function DraftEditor({ value, onChange, conversationLabel, conversationChanged }: Props) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        area.select();
        document.execCommand('copy');
        document.body.removeChild(area);
        setCopied(true);
        setError(null);
        setTimeout(() => setCopied(false), 2500);
      } catch {
        setError('Không sao chép được. Hãy bôi đen và sao chép thủ công.');
      }
    }
  };

  const handleClear = () => {
    onChange('');
    setCopied(false);
    setError(null);
  };

  return (
    <>
      <section className="card">
        <h2>Bản nháp trả lời</h2>
        <div className="row">
          <span className="label">Gửi cho</span>
          <span className="value">{conversationLabel ?? '—'}</span>
        </div>
        {conversationChanged && (
          <div className="notice warn" style={{ marginTop: 8 }}>
            Cảnh báo: cuộc trò chuyện đang chọn đã đổi. Hãy xác nhận người nhận trước khi dán.
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
          <button className="btn primary" onClick={() => void handleCopy()} disabled={!value.trim()}>
            {copied ? '✓ Đã sao chép' : '📋 Sao chép'}
          </button>
          <button className="btn" onClick={handleClear} disabled={!value}>
            Xóa
          </button>
        </div>
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
          <li>Bấm “Sao chép” ở trên.</li>
          <li>Chuyển sang tab Messenger, chọn đúng cuộc trò chuyện.</li>
          <li>Dán (Ctrl+V) vào ô soạn tin nhắn.</li>
          <li>
            <strong>Bạn tự bấm nút Gửi.</strong> Echo Assistant không bao giờ gửi thay bạn.
          </li>
        </ul>
      </section>
    </>
  );
}
