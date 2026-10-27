/**
 * Monitoring controller.
 *
 * Two complementary mechanisms:
 *   - a MutationObserver on the active conversation region, debounced, for
 *     fast reaction to new messages;
 *   - a periodic reconciliation timer (~5s) that re-reads the conversation and
 *     catches anything the observer missed (virtualized scrolling, re-renders).
 *
 * The timer lives in the content script, not the service worker, because MV3
 * service workers are terminated by the browser and cannot own a 5-second
 * schedule. The content script has an explicit lifecycle: start / pause /
 * stop / resume, and it stops touching the page the moment monitoring is off.
 */
import type { ScanIntervalMs } from '../core/models';

export interface MonitorOptions {
  intervalMs: ScanIntervalMs;
  onScan: (reason: 'observer' | 'interval') => void;
  onError?: (error: unknown) => void;
  /** Debounce window for observer-driven scans. */
  debounceMs?: number;
}

export class MonitoringController {
  private observer: MutationObserver | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private paused = false;
  private scanning = false;
  private pending = false;
  private intervalMs: ScanIntervalMs;
  private debounceMs: number;
  private onScan: MonitorOptions['onScan'];
  private onError: MonitorOptions['onError'];

  constructor(options: MonitorOptions) {
    this.intervalMs = options.intervalMs;
    this.debounceMs = options.debounceMs ?? 300;
    this.onScan = options.onScan;
    this.onError = options.onError;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  setInterval(ms: ScanIntervalMs): void {
    this.intervalMs = ms;
    if (this.running && !this.paused) this.startTimer();
  }

  /** Begins monitoring. Idempotent. */
  start(target: Node): void {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.observe(target);
    this.startTimer();
  }

  /** Stops observing and cancels the timer. The page is left untouched. */
  stop(): void {
    this.running = false;
    this.paused = false;
    this.observer?.disconnect();
    this.observer = null;
    this.clearTimer();
    this.clearDebounce();
  }

  /** Suspends scanning without losing the monitoring session. */
  pause(): void {
    if (!this.running || this.paused) return;
    this.paused = true;
    this.observer?.disconnect();
    this.clearTimer();
  }

  /** Resumes a paused session. */
  resume(target: Node): void {
    if (!this.running || !this.paused) return;
    this.paused = false;
    this.observe(target);
    this.startTimer();
  }

  /** Re-targets the observer after the conversation region changed. */
  retarget(target: Node): void {
    if (!this.running || this.paused) return;
    this.observe(target);
  }

  private observe(target: Node): void {
    this.observer?.disconnect();
    this.observer = new MutationObserver(() => this.scheduleObserverScan());
    this.observer.observe(target, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  private scheduleObserverScan(): void {
    if (!this.running || this.paused) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.run('observer');
    }, this.debounceMs);
  }

  private startTimer(): void {
    this.clearTimer();
    const tick = () => {
      if (!this.running || this.paused) return;
      this.run('interval');
      this.timer = setTimeout(tick, this.intervalMs);
    };
    this.timer = setTimeout(tick, this.intervalMs);
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private clearDebounce(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /**
   * Runs a scan, guaranteeing no overlap: if a scan is already in flight the
   * request is coalesced into a single pending run.
   */
  private run(reason: 'observer' | 'interval'): void {
    if (!this.running || this.paused) return;
    if (this.scanning) {
      this.pending = true;
      return;
    }
    this.scanning = true;
    try {
      this.onScan(reason);
    } catch (error) {
      this.onError?.(error);
    } finally {
      this.scanning = false;
      if (this.pending) {
        this.pending = false;
        setTimeout(() => this.run(reason), 0);
      }
    }
  }
}
