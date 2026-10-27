import { describe, expect, it } from 'vitest';
import { NewMessageSession } from '../../extension/src/core/new-message-session';
import type { MessengerMessage } from '../../extension/src/core/models';

const a = { key: 'thread:a', label: 'Synthetic A', url: null };
const b = { key: 'thread:b', label: 'Synthetic B', url: null };
function msg(id: string | null, text: string, extra: Partial<MessengerMessage> = {}): MessengerMessage {
  return { id: '', domId: id ? `message:${id}` : null, renderId: id ? `node:${id}` : undefined,
    text, normalizedText: text, direction: 'incoming', timestamp: null, directionIsHeuristic: false,
    conversationKey: a.key, conversationLabel: a.label, ordinal: 0, detectedAt: 1000, ...extra };
}
function create(baseline: MessengerMessage[], atBottom = true) {
  const session = new NewMessageSession(); session.beginSession(1000); session.select(a);
  expect(session.ingest(baseline, { atBottom, observedAt: 1000 })).toEqual([]);
  return session;
}
const scan = (s: NewMessageSession, batch: MessengerMessage[], atBottom = true) => s.ingest(batch, { atBottom, observedAt: 2000 });

describe('new-message-only monitoring session', () => {
  it('keeps three genuinely distinct outgoing messages even when their text is identical', () => {
    const base = [msg('old', 'baseline')], s = create(base);
    const arrivals = ['a', 'b', 'c'].map(id => msg(id, 'Same legitimate text', { direction: 'outgoing' }));
    expect(scan(s, [...base, ...arrivals])).toHaveLength(3);
    expect(scan(s, [...base, ...arrivals])).toHaveLength(0);
    expect(s.activeMessages).toHaveLength(3);
  });
  it('rejects an explicitly historical timestamp even if an old row is appended after the tail', () => {
    const base = [msg('a', 'old')], s = create(base);
    expect(scan(s, [...base, msg('h', 'hydrated old row', { sentAtMs: 900 })])).toEqual([]);
    expect(s.statistics.suppressedBackfillCount).toBe(1);
  });
  it('suppresses duplicate semantic ids within one extraction batch', () => {
    const base = [msg('a', 'old')], s = create(base), newMessage = msg('b', 'new');
    expect(scan(s, [...base, newMessage, { ...newMessage }])).toHaveLength(1);
    expect(s.statistics.knownMessageCount).toBe(2);
    expect(s.lastDuplicateCount()).toBe(2);
  });
  it('seeds pre-existing messages silently and reports actual baseline counts', () => {
    const s = create([msg('a', 'old'), msg('b', 'old')]);
    expect(s.activeMessages).toEqual([]);
    expect(s.statistics).toMatchObject({ baselineEstablished: true, baselineMessageCount: 2,
      knownMessageCount: 2, newMessagesEmittedCount: 0, suppressedHistoricalCount: 2 });
  });
  it('emits exactly one incoming arrival after the baseline', () => {
    const base = [msg('a', 'old')], s = create(base);
    expect(scan(s, [...base, msg('b', 'new')]).map(m => m.text)).toEqual(['new']);
    expect(s.activeMessages.map(m => m.text)).toEqual(['new']);
  });
  it('emits exactly one outgoing arrival after the baseline', () => {
    const base = [msg('a', 'old')], s = create(base);
    expect(scan(s, [...base, msg('b', 'new', { direction: 'outgoing' })])).toHaveLength(1);
    expect(s.activeMessages[0].direction).toBe('outgoing');
  });
  it('suppresses historical prepends and never moves the newest-message anchor backwards', () => {
    const base = [msg('a', 'old a'), msg('b', 'old b')], s = create(base);
    const history = [msg('x', 'older'), msg('y', 'older still'), ...base];
    expect(scan(s, history, false)).toEqual([]);
    expect(s.statistics.suppressedBackfillCount).toBe(2);
    expect(scan(s, [...history, msg('c', 'new')]).map(m => m.text)).toEqual(['new']);
  });
  it('suppresses a disjoint older window when the newest anchor is not rendered', () => {
    const base = [msg('a', 'old a'), msg('b', 'old b')], s = create(base);
    expect(scan(s, [msg('h1', 'history one'), msg('h2', 'history two')], false)).toEqual([]);
    expect(scan(s, base)).toEqual([]);
    expect(scan(s, [...base, msg('c', 'new')])).toHaveLength(1);
  });
  it('does not emit a stable message again after a DOM rerender or an accent-only edit', () => {
    const s = create([msg('a', 'ban')]);
    expect(scan(s, [msg('a', 'bạn', { renderId: 'replacement' })])).toEqual([]);
    expect(s.statistics.knownMessageCount).toBe(1);
  });
  it('aligns a full rerender without stable ids without replaying it', () => {
    const s = create([msg(null, 'one', { renderId: 'old1' }), msg(null, 'two', { renderId: 'old2' })]);
    const fresh = [msg(null, 'one', { renderId: 'fresh1' }), msg(null, 'two', { renderId: 'fresh2' })];
    expect(scan(s, fresh)).toEqual([]);
    expect(s.statistics.knownMessageCount).toBe(2);
    expect(scan(s, [...fresh, msg(null, 'three', { renderId: 'fresh3' })]).map(m => m.text)).toEqual(['three']);
  });
  it('emits later identical text with a distinct semantic message id', () => {
    const base = [msg('a', 'OK'), msg('b', 'OK')], s = create(base);
    expect(scan(s, [...base, msg('c', 'OK')])).toHaveLength(1);
    expect(scan(s, [...base, msg('c', 'OK')])).toHaveLength(0);
  });
  it('preserves identical unkeyed messages using their actual DOM-node anchors', () => {
    const base = [msg(null, 'OK', { renderId: '1' }), msg(null, 'OK', { renderId: '2' })], s = create(base);
    expect(scan(s, [...base, msg(null, 'OK', { renderId: '3' })])).toHaveLength(1);
  });
  it('does not mistake an identical historical prepend for a new suffix after DOM indexes shift', () => {
    const base = [msg(null, 'OK', { renderId: '1' }), msg(null, 'OK', { renderId: '2' })], s = create(base);
    expect(scan(s, [msg(null, 'OK', { renderId: '0' }), ...base], false)).toEqual([]);
    expect(s.activeMessages).toEqual([]);
  });
  it('conservatively suppresses indistinguishable repeated-text rerenders without any stable anchor', () => {
    const s = create([msg(null, 'OK'), msg(null, 'OK')]);
    expect(scan(s, [msg(null, 'OK'), msg(null, 'OK'), msg(null, 'OK')])).toEqual([]);
    expect(s.statistics.suppressedUnanchoredCount).toBe(1);
  });
  it('creates a fresh baseline on every conversation switch, including switching back', () => {
    const base = [msg('a', 'old A')], s = create(base);
    scan(s, [...base, msg('a2', 'new A')]);
    s.select(b);
    expect(scan(s, [msg('b', 'old B', { conversationKey: b.key })])).toEqual([]);
    expect(s.activeMessages).toEqual([]);
    expect(scan(s, [msg('b', 'old B', { conversationKey: b.key }), msg('b2', 'new B', { conversationKey: b.key })])).toHaveLength(1);
    s.select(a);
    expect(scan(s, [...base, msg('a2', 'new A')])).toEqual([]);
    expect(s.statistics.baselineMessageCount).toBe(2);
  });
  it('preserves the baseline across a pause gap and emits only the newly appended suffix on resume', () => {
    const base = [msg('a', 'old A')], s = create(base);
    // Pause means no calls to ingest; resume reconciles against the same anchor.
    expect(scan(s, [...base, msg('b', 'arrived during pause')])).toHaveLength(1);
    expect(s.statistics.monitoringSessionStartedAt).toBe(1000);
    expect(s.statistics.baselineMessageCount).toBe(1);
    expect(scan(s, [...base, msg('b', 'arrived during pause')])).toEqual([]);
  });
  it('Stop/Start silently baselines previously tracked messages again', () => {
    const base = [msg('a', 'old')], s = create(base);
    const batch = [...base, msg('b', 'previously new')]; scan(s, batch);
    s.reset(); s.beginSession(3000); s.select(a);
    expect(s.ingest(batch, { atBottom: true, observedAt: 3000 })).toEqual([]);
    expect(s.activeMessages).toEqual([]);
    expect(s.statistics).toMatchObject({ baselineMessageCount: 2, newMessagesEmittedCount: 0, monitoringSessionStartedAt: 3000 });
  });
  it('clearing the panel does not erase the known-message baseline or replay messages', () => {
    const base = [msg('a', 'old')], s = create(base), batch = [...base, msg('b', 'new')];
    scan(s, batch); s.clearActive();
    expect(scan(s, batch)).toEqual([]); expect(s.activeMessages).toEqual([]);
    expect(scan(s, [...batch, msg('c', 'next')])).toHaveLength(1);
  });
  it('starting while viewing history does not import unseen existing messages on first reaching the bottom', () => {
    const old = msg('a', 'old history'), s = create([old], false);
    expect(s.statistics.tailAnchorEstablished).toBe(false);
    const bottom = [old, msg('b', 'also pre-existing'), msg('c', 'existing newest')];
    expect(scan(s, bottom)).toEqual([]);
    expect(s.statistics.tailAnchorEstablished).toBe(true);
    expect(scan(s, [...bottom, msg('d', 'new after bottom')])).toHaveLength(1);
  });
  it('uses a full explicit timestamp to recognize a new message in a disjoint virtualized window', () => {
    const s = create([msg('a', 'old')]);
    expect(scan(s, [msg('h', 'older history', { sentAtMs: 900 }), msg('b', 'new', { sentAtMs: 1500 })]).map(m => m.text)).toEqual(['new']);
  });
  it('does not interpret time-of-day labels as proof that old history is new', () => {
    const s = create([msg('a', 'old')]);
    expect(scan(s, [msg('h', 'unknown history', { timestamp: '23:59' })])).toEqual([]);
    expect(s.statistics.suppressedUnanchoredCount).toBe(1);
  });
  it('retains the baseline through a transient unavailable DOM and ignores foreign-thread batches', () => {
    const base = [msg('a', 'old')], s = create(base);
    s.markUnavailable(); expect(s.activeMessages).toEqual([]); s.select(a);
    expect(scan(s, base)).toEqual([]);
    expect(scan(s, [msg('b', 'foreign', { conversationKey: b.key })])).toEqual([]);
    expect(scan(s, [...base, msg('c', 'new')])).toHaveLength(1);
  });
  it('supports a genuinely empty baseline followed by its first arrival', () => {
    const s = create([]);
    expect(scan(s, [msg('a', 'first')])).toHaveLength(1);
    expect(s.statistics.baselineMessageCount).toBe(0);
  });
});
