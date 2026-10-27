/**
 * Session lifecycle and privacy controls.
 *
 * Nothing about a conversation is written to disk. The manager only tracks
 * in-memory state and exposes an explicit "stop" that wipes it.
 */

import type { MonitoringState } from '../core/models';

export interface SessionInfo {
  id: string;
  startedAt: number;
  state: MonitoringState;
  messagesRetained: number;
}

export class PrivacyManager {
  private session: SessionInfo | null = null;
  private listeners = new Set<() => void>();

  get current(): SessionInfo | null {
    return this.session ? { ...this.session } : null;
  }

  get isActive(): boolean {
    return this.session !== null && this.session.state !== 'stopped';
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  start(): SessionInfo {
    if (!this.session) {
      this.session = {
        id: `s_${Date.now().toString(36)}`,
        startedAt: Date.now(),
        state: 'running',
        messagesRetained: 0,
      };
    } else {
      this.session.state = 'running';
    }
    this.emit();
    return this.current!;
  }

  setState(state: MonitoringState): void {
    if (!this.session) return;
    this.session.state = state;
    this.emit();
  }

  setRetained(count: number): void {
    if (!this.session) return;
    this.session.messagesRetained = count;
  }

  /** Ends the session and clears every retained trace of conversation text. */
  stop(): void {
    this.session = null;
    this.emit();
  }
}
