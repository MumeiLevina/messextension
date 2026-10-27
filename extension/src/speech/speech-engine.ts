/**
 * Vietnamese speech-to-text engine wrapper.
 *
 * Wraps the browser SpeechRecognition API behind a small, deterministic state
 * machine so the UI never sees duplicated partials, duplicated finals, or a
 * microphone that keeps running after Stop.
 */

export type SpeechEventKind = 'ready' | 'started' | 'interim' | 'final' | 'error' | 'ended';

export interface SpeechEvent {
  kind: SpeechEventKind;
  transcript?: string;
  error?: string;
  /** 0..1 confidence when the engine reports one. */
  confidence?: number;
}

export interface SpeechEngineOptions {
  lang?: string;
  onEvent: (event: SpeechEvent) => void;
}

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export class SpeechEngine {
  private recognition: SpeechRecognitionLike | null = null;
  private opts: SpeechEngineOptions;
  private started = false;
  private starting = false;
  private stopRequested = false;
  private finals = new Map<number, string>();
  /** Guards against a stale recognition instance reporting after a restart. */
  private generation = 0;
  private finalTranscript = '';
  private lastInterim = '';

  constructor(options: SpeechEngineOptions) {
    this.opts = options;
  }

  get isRecording(): boolean {
    return this.started;
  }

  start(): boolean {
    const Ctor = getCtor();
    if (!Ctor) {
      this.opts.onEvent({ kind: 'error', error: 'Trình duyệt không hỗ trợ nhận dạng giọng nói.' });
      return false;
    }
    if (this.started || this.starting) return true;

    const generation = ++this.generation;
    this.finalTranscript = '';
    this.lastInterim = '';
    this.finals.clear();
    this.starting = true;
    this.stopRequested = false;

    const rec = new Ctor();
    rec.lang = this.opts.lang ?? 'vi-VN';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      if (generation !== this.generation) return;
      this.started = true;
      this.starting = false;
      this.opts.onEvent({ kind: 'started' });
      if (this.stopRequested) rec.stop();
    };

    rec.onresult = (event: any) => {
      if (generation !== this.generation) return;
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const alt = result[0];
        const text: string = alt?.transcript ?? '';
        if (!text.trim()) continue;
        if (result.isFinal) {
          if (this.finals.get(i) === text) continue;
          this.finals.set(i, text);
          this.finalTranscript = [...this.finals.entries()].sort(([a], [b]) => a - b).map(([, value]) => value)
            .reduce((all, part) => all ? `${all}${/\s$/.test(all) || /^\s/.test(part) ? '' : ' '}${part}` : part, '');
          this.opts.onEvent({
            kind: 'final',
            transcript: this.finalTranscript,
            confidence: alt?.confidence,
          });
        } else {
          interim += `${text} `;
        }
      }
      interim = interim.trim();
      // Only emit when the interim text actually changed.
      if (interim && interim !== this.lastInterim) {
        this.lastInterim = interim;
        this.opts.onEvent({ kind: 'interim', transcript: interim });
      }
    };

    rec.onerror = (event: any) => {
      if (generation !== this.generation) return;
      const code = event?.error ?? 'unknown';
      const message: Record<string, string> = {
        'no-speech': 'Không nghe thấy giọng nói.',
        'audio-capture': 'Không truy cập được microphone.',
        'not-allowed': 'Quyền microphone bị từ chối.',
        network: 'Lỗi mạng khi nhận dạng giọng nói.',
        aborted: 'Đã hủy nhận dạng.',
      };
      this.opts.onEvent({ kind: 'error', error: message[code] ?? `Lỗi nhận dạng: ${code}` });
    };

    rec.onend = () => {
      if (generation !== this.generation) return;
      this.generation += 1;
      this.started = false;
      this.starting = false;
      this.opts.onEvent({ kind: 'ended' });
    };

    this.recognition = rec;
    try {
      rec.start();
      return true;
    } catch {
      this.starting = false;
      this.opts.onEvent({ kind: 'error', error: 'Không khởi động được nhận dạng giọng nói.' });
      return false;
    }
  }

  /** Stops and finalizes, keeping any transcript produced so far. */
  stop(): void {
    if (!this.recognition) return;
    this.stopRequested = true;
    try {
      this.recognition.stop();
    } catch {
      /* ignore */
    }
  }

  /** Aborts and discards; no transcript is produced. */
  cancel(): void {
    if (!this.recognition) return;
    this.generation += 1;
    this.started = false;
    this.starting = false;
    try {
      this.recognition.abort();
    } catch {
      /* ignore */
    }
    this.recognition = null;
    this.finalTranscript = '';
    this.lastInterim = '';
  }

  dispose(): void {
    this.cancel();
  }
}
