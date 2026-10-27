import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { TranscriptionManager } from '../../extension/src/speech/transcription-manager';
import { SpeechEngine } from '../../extension/src/speech/speech-engine';

/** A controllable SpeechRecognition double. */
class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  started = false;
  stopped = false;
  aborted = false;
  onresult: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;

  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.started = true;
    this.onstart?.();
  }
  stop() {
    this.stopped = true;
    this.onend?.();
  }
  abort() {
    this.aborted = true;
  }
  /** Emits a partial result. */
  partial(text: string) {
    this.onresult?.({
      resultIndex: 0,
      results: [Object.assign([{ transcript: text, confidence: 0.5 }], { isFinal: false })],
    });
  }
  /** Emits a final result. */
  final(text: string) {
    this.onresult?.({
      resultIndex: 0,
      results: [Object.assign([{ transcript: text, confidence: 0.9 }], { isFinal: true })],
    });
  }
}

beforeEach(() => {
  FakeRecognition.last = null;
  (globalThis as any).SpeechRecognition = FakeRecognition;
  (globalThis as any).webkitSpeechRecognition = undefined;
});

afterEach(() => {
  delete (globalThis as any).SpeechRecognition;
});

describe('TranscriptionManager', () => {
  it('starts idle', () => {
    const manager = new TranscriptionManager();
    expect(manager.getState().recordingState).toBe('idle');
  });

  it('moves to recording once the engine starts', () => {
    const manager = new TranscriptionManager();
    manager.start();
    expect(manager.getState().recordingState).toBe('recording');
  });

  it('delivers interim text', () => {
    const manager = new TranscriptionManager();
    manager.start();
    FakeRecognition.last!.partial('xin chào');
    expect(manager.getState().interim).toBe('xin chào');
  });

  it('delivers the final transcript', () => {
    const manager = new TranscriptionManager();
    manager.start();
    FakeRecognition.last!.final('xin chào bạn');
    expect(manager.getState().final).toBe('xin chào bạn');
  });

  it('does not repeat an unchanged interim', () => {
    const manager = new TranscriptionManager();
    const seen: string[] = [];
    manager.subscribe((s) => {
      if (s.interim && s.interim !== seen[seen.length - 1]) seen.push(s.interim);
    });
    manager.start();
    FakeRecognition.last!.partial('abc');
    FakeRecognition.last!.partial('abc');
    expect(seen.filter((t) => t === 'abc')).toHaveLength(1);
  });

  it('returns to idle after stop', () => {
    const manager = new TranscriptionManager();
    manager.start();
    manager.stop();
    expect(manager.getState().recordingState).toBe('idle');
  });

  it('discards text on cancel', () => {
    const manager = new TranscriptionManager();
    manager.start();
    FakeRecognition.last!.final('sẽ bị bỏ');
    manager.cancel();
    expect(manager.getState().final).toBe('');
    expect(manager.getState().recordingState).toBe('idle');
  });

  it('reports an error message', () => {
    const manager = new TranscriptionManager();
    manager.start();
    FakeRecognition.last!.onerror?.({ error: 'not-allowed' });
    expect(manager.getState().error).toContain('microphone');
  });

  it('clears the final transcript after it has been used', () => {
    const manager = new TranscriptionManager();
    manager.start();
    FakeRecognition.last!.final('dùng rồi');
    manager.clearFinal();
    expect(manager.getState().final).toBe('');
  });

  it('does not restart the microphone on a second start', () => {
    const manager = new TranscriptionManager();
    manager.start();
    const first = FakeRecognition.last;
    manager.start();
    expect(FakeRecognition.last).toBe(first);
  });
});

describe('SpeechEngine', () => {
  it('does not append a replayed final result, but preserves identical separate utterances', () => {
    const events: string[] = [];
    const engine = new SpeechEngine({ onEvent: e => { if (e.kind === 'final') events.push(e.transcript!); } });
    engine.start();
    FakeRecognition.last!.final('chào');
    FakeRecognition.last!.final('chào');
    const final = Object.assign([{ transcript: 'chào' }], { isFinal: true });
    FakeRecognition.last!.onresult?.({ resultIndex: 1, results: [final, final] });
    expect(events).toEqual(['chào', 'chào chào']);
    engine.dispose();
  });

  it('stops a recognition instance even before onstart arrives', () => {
    const start = vi.spyOn(FakeRecognition.prototype, 'start').mockImplementation(() => undefined);
    const manager = new TranscriptionManager();
    manager.start();
    expect(manager.getState().recordingState).toBe('starting');
    manager.stop();
    expect(FakeRecognition.last!.stopped).toBe(true);
    expect(manager.getState().recordingState).toBe('idle');
    start.mockRestore();
    manager.dispose();
  });

  it('ignores late transcript events after the session ends', () => {
    const manager = new TranscriptionManager();
    manager.start();
    const rec = FakeRecognition.last!;
    manager.stop();
    rec.final('quá muộn');
    expect(manager.getState().final).toBe('');
    manager.dispose();
  });

  it('reports unsupported when the API is missing', () => {
    delete (globalThis as any).SpeechRecognition;
    delete (globalThis as any).webkitSpeechRecognition;
    const engine = new SpeechEngine({ onEvent: vi.fn() });
    expect(engine.start()).toBe(false);
  });

  it('uses vi-VN by default', () => {
    const engine = new SpeechEngine({ onEvent: vi.fn() });
    engine.start();
    expect(FakeRecognition.last!.lang).toBe('vi-VN');
  });

  it('aborts cleanly on cancel', () => {
    const engine = new SpeechEngine({ onEvent: vi.fn() });
    engine.start();
    engine.cancel();
    expect(FakeRecognition.last!.aborted).toBe(true);
    expect(engine.isRecording).toBe(false);
  });
});
