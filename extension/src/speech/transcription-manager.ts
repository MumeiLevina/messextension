/**
 * Transcription session manager.
 *
 * Owns the recording lifecycle so that the UI can only ever drive a small,
 * explicit set of states: idle -> recording -> idle. It guarantees that a
 * Stop ends the microphone, that a Cancel discards text, and that a final
 * transcript is delivered exactly once.
 */
import { SpeechEngine, type SpeechEvent } from './speech-engine';

export type RecordingState = 'idle' | 'starting' | 'recording' | 'stopping';

export interface TranscriptState {
  recordingState: RecordingState;
  interim: string;
  final: string;
  error: string | null;
}

export class TranscriptionManager {
  private engine: SpeechEngine | null = null;
  private state: TranscriptState = {
    recordingState: 'idle',
    interim: '',
    final: '',
    error: null,
  };
  private listeners = new Set<(state: TranscriptState) => void>();

  getState(): TranscriptState {
    return { ...this.state };
  }

  subscribe(fn: (state: TranscriptState) => void): () => void {
    this.listeners.add(fn);
    fn(this.getState());
    return () => this.listeners.delete(fn);
  }

  private update(patch: Partial<TranscriptState>): void {
    this.state = { ...this.state, ...patch };
    const snapshot = this.getState();
    for (const fn of this.listeners) fn(snapshot);
  }

  start(): void {
    if (this.state.recordingState !== 'idle') return;
    this.update({ recordingState: 'starting', interim: '', final: '', error: null });

    this.engine = new SpeechEngine({
      lang: 'vi-VN',
      onEvent: (event: SpeechEvent) => this.handle(event),
    });
    const ok = this.engine.start();
    if (!ok) this.update({ recordingState: 'idle' });
  }

  private handle(event: SpeechEvent): void {
    switch (event.kind) {
      case 'started':
        this.update({ recordingState: 'recording' });
        break;
      case 'interim':
        this.update({ interim: event.transcript ?? '' });
        break;
      case 'final':
        this.update({ final: event.transcript ?? '', interim: '' });
        break;
      case 'error':
        this.engine?.cancel();
        this.engine = null;
        this.update({ recordingState: 'idle', interim: '', error: event.error ?? 'Lỗi không xác định' });
        break;
      case 'ended':
        // The engine ended on its own (silence timeout). Close the session.
        this.update({ recordingState: 'idle', interim: '' });
        this.engine = null;
        break;
      default:
        break;
    }
  }

  stop(): void {
    if (this.state.recordingState !== 'recording' && this.state.recordingState !== 'starting') return;
    this.update({ recordingState: 'stopping' });
    this.engine?.stop();
    // `onend` drives the transition back to idle.
  }

  cancel(): void {
    this.engine?.cancel();
    this.engine = null;
    this.update({ recordingState: 'idle', interim: '', final: '', error: null });
  }

  /** Clears a delivered transcript after it has been inserted into the draft. */
  clearFinal(): void {
    this.update({ final: '', interim: '', error: null });
  }

  dispose(): void {
    this.engine?.dispose();
    this.engine = null;
    this.listeners.clear();
  }
}
