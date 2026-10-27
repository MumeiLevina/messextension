import { useEffect, useRef, useState } from 'react';
import { TranscriptionManager, type TranscriptState } from '../speech/transcription-manager';
import { probeSpeechSupport, type SpeechCapabilities } from '../speech/speech-capabilities';

interface Props {
  onTranscript: (text: string) => void;
}

/**
 * Microphone controls for Vietnamese dictation.
 *
 * The engine is created once and disposed on unmount, so navigating between
 * tabs never leaves the microphone running.
 */
export function VoiceRecorder({ onTranscript }: Props) {
  const managerRef = useRef<TranscriptionManager | null>(null);
  const [transcript, setTranscript] = useState<TranscriptState>({
    recordingState: 'idle',
    interim: '',
    final: '',
    error: null,
  });
  const [caps, setCaps] = useState<SpeechCapabilities | null>(null);
  const deliveredRef = useRef<string>('');
  const requestRef = useRef(0);
  const [requestingMicrophone, setRequestingMicrophone] = useState(false);

  useEffect(() => {
    const manager = new TranscriptionManager();
    managerRef.current = manager;
    const unsubscribe = manager.subscribe(setTranscript);
    return () => {
      requestRef.current += 1;
      unsubscribe();
      manager.dispose();
      managerRef.current = null;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void probeSpeechSupport().then((c) => {
      if (alive) setCaps(c);
    });
    return () => {
      alive = false;
    };
  }, []);

  const recording = requestingMicrophone || transcript.recordingState !== 'idle';

  const handleStart = async () => {
    const request = ++requestRef.current;
    deliveredRef.current = '';
    setRequestingMicrophone(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      if (request === requestRef.current) managerRef.current?.start();
    } catch {
      if (request === requestRef.current) setTranscript((prev) => ({ ...prev, error: 'Không truy cập được microphone. Hãy cho phép microphone trong Chrome hoặc dùng nhập tay.' }));
    } finally {
      if (request === requestRef.current) setRequestingMicrophone(false);
    }
  };

  const handleStop = () => {
    requestRef.current += 1;
    setRequestingMicrophone(false);
    managerRef.current?.stop();
  };

  const handleCancel = () => {
    requestRef.current += 1;
    setRequestingMicrophone(false);
    managerRef.current?.cancel();
  };

  /** Delivers the final transcript to the draft exactly once. */
  const handleUse = () => {
    const text = transcript.final.trim();
    if (!text) return;
    if (text !== deliveredRef.current) {
      deliveredRef.current = text;
      onTranscript(text);
    }
    managerRef.current?.clearFinal();
  };

  const handleRetry = () => {
    managerRef.current?.cancel();
    void handleStart();
  };

  return (
    <>
      <section className="card">
        <h2>Nhận dạng giọng nói (vi-VN)</h2>

        {caps && !caps.vietnamese && <div className="notice danger">{caps.detail}</div>}
        {caps?.vietnamese && (
          <div className={`notice ${caps.offline ? 'ok' : ''}`}>
            {caps.detail}
            {caps.localBackend && ' Backend cục bộ đang sẵn sàng.'}
          </div>
        )}

        <div className="btn-row" style={{ marginBottom: 10 }}>
          <button
            className={`btn ${recording ? 'recording' : 'primary'}`}
            onClick={() => void handleStart()}
            disabled={recording || !caps?.vietnamese}
          >
            {recording ? '● Đang ghi âm…' : '🎙 Bắt đầu ghi âm'}
          </button>
          <button className="btn" onClick={handleStop} disabled={!recording}>
            ⏹ Dừng
          </button>
          <button className="btn danger" onClick={handleCancel} disabled={!recording}>
            ✕ Hủy
          </button>
        </div>

        <div className="row">
          <span className="label">Trạng thái</span>
          <span className="value">
            {transcript.recordingState === 'recording'
              ? 'Đang nghe'
              : transcript.recordingState === 'starting'
                ? 'Đang khởi động…'
                : transcript.recordingState === 'stopping'
                  ? 'Đang kết thúc…'
                  : 'Rảnh'}
          </span>
        </div>
      </section>

      <section className="card">
        <h2>Kết quả</h2>
        <div className="row">
          <span className="label">Đang nói (tạm thời)</span>
        </div>
        <div className="interim">{transcript.interim || '—'}</div>

        <div className="row" style={{ marginTop: 8 }}>
          <span className="label">Văn bản cuối</span>
        </div>
        <div style={{ whiteSpace: 'pre-wrap', minHeight: 40 }}>
          {transcript.final || <span className="label">—</span>}
        </div>

        {transcript.error && (
          <div className="notice danger" style={{ marginTop: 10 }}>
            {transcript.error}
          </div>
        )}

        <div className="btn-row" style={{ marginTop: 10 }}>
          <button className="btn primary" onClick={handleUse} disabled={!transcript.final.trim()}>
            Chèn vào bản nháp
          </button>
          <button className="btn" onClick={handleRetry} disabled={recording}>
            Thử lại
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Ghi chú</h2>
        <ul className="plain">
          <li>Âm thanh không được lưu lại sau khi bạn bấm Dừng hoặc Hủy.</li>
          <li>Chrome có thể gửi âm thanh tới dịch vụ của Google — xem mục Chẩn đoán để biết chi tiết.</li>
          <li>Nếu nhận dạng không dùng được, bạn vẫn có thể gõ tay trong tab Bản nháp.</li>
        </ul>
      </section>
    </>
  );
}
