import { useEffect, useMemo, useState } from 'react';
import { MessageTts, type TtsSnapshot, type TtsStatus } from '../speech/message-tts';

export function TtsControls({ snapshot }: { snapshot: TtsSnapshot }) {
  const supported = typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance === 'function';
  const [enabled, setEnabled] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceUri, setVoiceUri] = useState('');
  const [rate, setRate] = useState(1);
  const [status, setStatus] = useState<TtsStatus>({ speaking: false, pending: 0, error: null });
  const engine = useMemo(() => supported ? new MessageTts({
    create: text => new SpeechSynthesisUtterance(text),
    speak: utterance => window.speechSynthesis.speak(utterance),
    cancel: () => window.speechSynthesis.cancel(),
  }, setStatus) : null, [supported]);

  useEffect(() => {
    if (!supported) return;
    const refresh = () => setVoices(window.speechSynthesis.getVoices());
    refresh();
    window.speechSynthesis.addEventListener('voiceschanged', refresh);
    // Closing/reloading the panel must also cancel speech queued in the browser.
    const stop = () => engine?.stop();
    window.addEventListener('pagehide', stop);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', refresh);
      window.removeEventListener('pagehide', stop);
      engine?.stop();
    };
  }, [supported, engine]);

  const voice = voices.find(v => v.voiceURI === voiceUri)
    ?? voices.find(v => /^vi(?:-|_|$)/i.test(v.lang) && v.localService)
    ?? voices.find(v => /^vi(?:-|_|$)/i.test(v.lang))
    ?? null;

  useEffect(() => { engine?.configure(voice, rate); }, [engine, voice, rate]);
  useEffect(() => { engine?.update(snapshot); }, [engine, snapshot]);

  const toggle = () => {
    const next = !enabled;
    engine?.setEnabled(next, snapshot);
    setEnabled(next);
    // A user gesture starts a short confirmation, unlocking audio in Chrome.
    if (next) engine?.preview();
  };

  return (
    <section className="card tts-controls" aria-label="Đọc tin nhắn đến">
      <div className="row">
        <h2>Đọc tin nhắn đến (TTS)</h2>
        <span className={`badge ${enabled ? 'ok' : 'idle'}`}>{enabled ? 'TTS đang bật' : 'TTS đang tắt'}</span>
      </div>
      <p className="label">Chỉ đọc tin đến mới sau khi bật. Giữ Side Panel mở; tạm dừng theo dõi hoặc đổi hội thoại sẽ ngừng đọc.</p>
      {!supported && <p className="notice warn">Trình duyệt chưa hỗ trợ đọc văn bản.</p>}
      <div className="tts-options">
        <label>Giọng đọc
          <select aria-label="Giọng đọc TTS" value={voiceUri} disabled={!supported} onChange={e => { engine?.stop(); setVoiceUri(e.target.value); }}>
            <option value="">Tự chọn tiếng Việt</option>
            {voices.map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang}){v.localService ? ' · máy' : ' · mạng'}</option>)}
          </select>
        </label>
        <label>Tốc độ
          <select aria-label="Tốc độ TTS" value={rate} disabled={!supported} onChange={e => setRate(Number(e.target.value))}>
            {[0.75, 1, 1.25, 1.5].map(value => <option key={value} value={value}>{value}×</option>)}
          </select>
        </label>
      </div>
      {supported && !voice && <p className="notice warn">Chưa thấy giọng tiếng Việt. Chrome sẽ thử vi-VN theo hệ thống; nếu không đọc được, cài giọng tiếng Việt trong Windows hoặc chọn giọng khác.</p>}
      {voice && !voice.localService && <p className="notice warn">Giọng đã chọn dùng dịch vụ mạng của trình duyệt; nội dung đọc có thể được gửi tới dịch vụ giọng nói.</p>}
      <div className="btn-row">
        <button className={`btn ${enabled ? '' : 'primary'}`} aria-pressed={enabled} disabled={!supported} onClick={toggle}>{enabled ? 'Tắt TTS' : 'Bật TTS'}</button>
        <button className="btn" disabled={!supported} onClick={() => engine?.preview()}>Đọc thử</button>
        <button className="btn danger" disabled={!supported || !status.pending} onClick={() => { engine?.setEnabled(false, snapshot); setEnabled(false); }}>Dừng đọc</button>
      </div>
      <p role="status" data-testid="tts-status">{status.error ?? (status.speaking ? `Đang đọc · ${status.pending} đoạn còn lại` : enabled ? 'Chờ tin nhắn đến mới' : 'Đã tắt đọc tự động')}</p>
    </section>
  );
}
