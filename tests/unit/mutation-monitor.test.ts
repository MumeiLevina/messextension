import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { MonitoringController } from '../../extension/src/content/mutation-monitor';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MonitoringController', () => {
  it('does not scan before it is started', () => {
    const onScan = vi.fn();
    const monitor = new MonitoringController({ intervalMs: 5000, onScan });
    void monitor;
    vi.advanceTimersByTime(20000);
    expect(onScan).not.toHaveBeenCalled();
  });

  it('scans on the configured interval once started', () => {
    const onScan = vi.fn();
    const monitor = new MonitoringController({ intervalMs: 5000, onScan });
    const target = document.createElement('div');
    monitor.start(target);
    vi.advanceTimersByTime(5000);
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith('interval');
    vi.advanceTimersByTime(15000);
    expect(onScan).toHaveBeenCalledTimes(4);
  });

  it('honours a 3 second interval', () => {
    const onScan = vi.fn();
    const monitor = new MonitoringController({ intervalMs: 3000, onScan });
    monitor.start(document.createElement('div'));
    vi.advanceTimersByTime(9000);
    expect(onScan).toHaveBeenCalledTimes(3);
  });

  it('honours a 10 second interval', () => {
    const onScan = vi.fn();
    const monitor = new MonitoringController({ intervalMs: 10000, onScan });
    monitor.start(document.createElement('div'));
    vi.advanceTimersByTime(30000);
    expect(onScan).toHaveBeenCalledTimes(3);
  });

  it('stops scanning after stop()', () => {
    const onScan = vi.fn();
    const monitor = new MonitoringController({ intervalMs: 5000, onScan });
    monitor.start(document.createElement('div'));
    monitor.stop();
    vi.advanceTimersByTime(30000);
    expect(onScan).not.toHaveBeenCalled();
  });

  it('pauses and resumes', () => {
    const onScan = vi.fn();
    const monitor = new MonitoringController({ intervalMs: 5000, onScan });
    const target = document.createElement('div');
    monitor.start(target);
    vi.advanceTimersByTime(5000);
    expect(onScan).toHaveBeenCalledTimes(1);
    monitor.pause();
    vi.advanceTimersByTime(20000);
    expect(onScan).toHaveBeenCalledTimes(1);
    monitor.resume(target);
    vi.advanceTimersByTime(5000);
    expect(onScan).toHaveBeenCalledTimes(2);
  });

  it('coalesces overlapping scans into one pending run', () => {
    let scans = 0;
    const monitor = new MonitoringController({
      intervalMs: 5000,
      onScan: () => {
        scans += 1;
        // Simulate a long scan by re-entering the scheduler.
        vi.advanceTimersByTime(0);
      },
    });
    monitor.start(document.createElement('div'));
    vi.advanceTimersByTime(5000);
    expect(scans).toBe(1);
  });

  it('reports errors thrown by the scan callback', () => {
    const onError = vi.fn();
    const monitor = new MonitoringController({
      intervalMs: 5000,
      onScan: () => {
        throw new Error('boom');
      },
      onError,
    });
    monitor.start(document.createElement('div'));
    vi.advanceTimersByTime(5000);
    expect(onError).toHaveBeenCalled();
  });

  it('changes the interval while running', () => {
    const onScan = vi.fn();
    const monitor = new MonitoringController({ intervalMs: 5000, onScan });
    monitor.start(document.createElement('div'));
    monitor.setInterval(3000);
    vi.advanceTimersByTime(6000);
    expect(onScan).toHaveBeenCalledTimes(2);
  });
});
