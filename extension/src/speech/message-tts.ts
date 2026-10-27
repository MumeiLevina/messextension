import type { MessengerMessage, MonitoringState } from '../core/models';

export interface TtsSnapshot {
  monitoring: MonitoringState;
  conversationKey: string | null;
  sessionStartedAt: number | null;
  messages: MessengerMessage[];
}
export interface TtsStatus { pending: number; speaking: boolean; error: string | null }
export interface TtsPort {
  create(text: string): SpeechSynthesisUtterance;
  speak(utterance: SpeechSynthesisUtterance): void;
  cancel(): void;
}

/** Short utterances avoid long-message stalls; preserve every Unicode character. */
export function speechChunks(text: string): string[] {
  const chars = Array.from(text.trim());
  const chunks: string[] = [];
  while (chars.length) {
    let size = Math.min(180, chars.length);
    if (size < chars.length) {
      for (let i = size - 1; i >= 90; i--) {
        if (/\s/.test(chars[i])) { size = i + 1; break; }
      }
    }
    const chunk = chars.splice(0, size).join('').trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

/** Snapshot-aware TTS: IDs, never text equality, decide whether a message is new. */
export class MessageTts {
  private enabled = false;
  private scope = '';
  private monitoring: MonitoringState = 'idle';
  private seen = new Set<string>();
  private queue: string[] = [];
  private current: SpeechSynthesisUtterance | null = null;
  private generation = 0;
  private voice: SpeechSynthesisVoice | null = null;
  private rate = 1;
  private error: string | null = null;

  constructor(private port: TtsPort, private report: (status: TtsStatus) => void) {}

  configure(voice: SpeechSynthesisVoice | null, rate: number): void {
    this.voice = voice;
    this.rate = Math.max(0.5, Math.min(2, rate));
  }

  setEnabled(enabled: boolean, snapshot: TtsSnapshot): void {
    this.enabled = enabled;
    this.stop();
    this.scope = this.scopeOf(snapshot);
    this.monitoring = snapshot.monitoring;
    this.seen = new Set(snapshot.messages.map(m => m.id));
  }

  update(snapshot: TtsSnapshot): void {
    const scope = this.scopeOf(snapshot);
    const monitoringChanged = snapshot.monitoring !== this.monitoring;
    this.monitoring = snapshot.monitoring;
    if (scope !== this.scope) {
      this.stop();
      this.scope = scope;
      this.seen = new Set(snapshot.messages.map(m => m.id));
      return;
    }
    if (!this.enabled || snapshot.monitoring !== 'running' || !snapshot.conversationKey) {
      if (monitoringChanged && snapshot.monitoring !== 'running') this.stop();
      for (const m of snapshot.messages) this.seen.add(m.id);
      return;
    }
    for (const m of snapshot.messages) {
      if (!m.id || this.seen.has(m.id)) continue;
      this.seen.add(m.id);
      if (m.conversationKey !== snapshot.conversationKey || m.direction !== 'incoming') continue;
      this.queue.push(...speechChunks(m.text));
    }
    this.next();
  }

  preview(): void {
    this.stop();
    this.queue.push('Xin chào, Echo Assistant sẽ đọc tin nhắn mới đến.');
    this.next();
  }

  stop(): void {
    this.generation++;
    this.queue = [];
    this.current = null;
    this.error = null;
    this.port.cancel();
    this.publish();
  }

  private scopeOf(s: TtsSnapshot): string {
    return JSON.stringify([s.sessionStartedAt, s.conversationKey]);
  }

  private publish(): void {
    this.report({ pending: this.queue.length + (this.current ? 1 : 0), speaking: Boolean(this.current), error: this.error });
  }

  private next(): void {
    if (this.current) return;
    const text = this.queue.shift();
    if (!text) { this.publish(); return; }
    const generation = this.generation;
    try {
      this.error = null;
      const utterance = this.port.create(text);
      utterance.lang = this.voice?.lang ?? 'vi-VN';
      utterance.voice = this.voice;
      utterance.rate = this.rate;
      this.current = utterance; // Retain the object until completion.
      utterance.onend = () => {
        if (generation !== this.generation) return;
        this.current = null;
        this.next();
      };
      utterance.onerror = (event) => {
        if (generation !== this.generation) return;
        this.fail(event.error === 'not-allowed'
          ? 'Chrome chưa cho phép phát giọng nói. Bấm Đọc thử rồi thử lại.'
          : 'Không phát được giọng đọc. Kiểm tra giọng đã chọn và bấm Đọc thử.');
      };
      this.port.speak(utterance);
      this.publish();
    } catch {
      this.fail('Không khởi động được TTS. Kiểm tra giọng đọc và thử lại.');
    }
  }

  private fail(error: string): void {
    this.stop();
    this.error = error;
    this.publish();
  }
}
