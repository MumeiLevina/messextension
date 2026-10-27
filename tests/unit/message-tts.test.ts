import { describe, expect, it, vi } from 'vitest';
import { MessageTts, speechChunks, type TtsSnapshot } from '../../extension/src/speech/message-tts';
import type { MessengerMessage } from '../../extension/src/core/models';

const message = (id: string, direction: MessengerMessage['direction'] = 'incoming', text = 'Xin chào'): MessengerMessage => ({
  id, direction, text, normalizedText: text, timestamp: null, directionIsHeuristic: false,
  conversationKey: 'a', conversationLabel: 'A', detectedAt: 100, domId: id, ordinal: 0,
});
const snapshot = (messages: MessengerMessage[] = [], extra: Partial<TtsSnapshot> = {}): TtsSnapshot => ({
  monitoring: 'running', conversationKey: 'a', sessionStartedAt: 100, messages, ...extra,
});
function fixture() {
  const spoken: SpeechSynthesisUtterance[] = [];
  const cancel = vi.fn();
  const report = vi.fn();
  const engine = new MessageTts({ create: text => ({ text } as SpeechSynthesisUtterance), speak: u => { spoken.push(u); }, cancel }, report);
  const end = () => spoken.at(-1)?.onend?.({} as SpeechSynthesisEvent);
  return { engine, spoken, cancel, report, end };
}

describe('incoming message TTS', () => {
  it('defaults off and enabling silently baselines already displayed messages', () => {
    const f = fixture();
    f.engine.update(snapshot([message('old')]));
    f.engine.setEnabled(true, snapshot([message('old')]));
    f.engine.update(snapshot([message('old')]));
    expect(f.spoken).toEqual([]);
    f.engine.update(snapshot([message('old'), message('new')]));
    expect(f.spoken.map(u => u.text)).toEqual(['Xin chào']);
    expect(f.spoken[0].lang).toBe('vi-VN');
  });

  it('skips outgoing, unknown and foreign-thread messages', () => {
    const f = fixture(); f.engine.setEnabled(true, snapshot());
    f.engine.update(snapshot([message('self', 'outgoing'), message('unknown', 'unknown'), { ...message('foreign'), conversationKey: 'b' }]));
    expect(f.spoken).toEqual([]);
  });

  it('queues three identical legitimate incoming IDs once each in order, across snapshots and edits', () => {
    const f = fixture(); f.engine.setEnabled(true, snapshot());
    const items = ['1', '2', '3'].map(id => message(id));
    f.engine.update(snapshot(items));
    f.engine.update(snapshot(items.map(m => ({ ...m, text: `${m.text} edited` }))));
    expect(f.spoken).toHaveLength(1);
    f.end(); f.end(); f.end();
    expect(f.spoken.map(u => u.text)).toEqual(['Xin chào', 'Xin chào', 'Xin chào']);
    expect(f.report).toHaveBeenLastCalledWith({ speaking: false, pending: 0, error: null });
  });

  it('cancels on pause and does not replay canceled IDs on resume', () => {
    const f = fixture(); f.engine.setEnabled(true, snapshot());
    f.engine.update(snapshot([message('1'), message('2')]));
    const stale = f.spoken[0].onend!;
    f.engine.update(snapshot([message('1'), message('2')], { monitoring: 'paused' }));
    stale.call(f.spoken[0], {} as SpeechSynthesisEvent);
    f.engine.update(snapshot([message('1'), message('2'), message('3')]));
    expect(f.spoken).toHaveLength(2);
    expect(f.cancel).toHaveBeenCalled();
  });

  it('cancels and baselines a changed thread or restarted session even when message IDs repeat', () => {
    const f = fixture(); f.engine.setEnabled(true, snapshot());
    f.engine.update(snapshot([message('1')]));
    f.engine.update(snapshot([message('old-b')], { conversationKey: 'b' }));
    f.engine.update(snapshot([message('old')], { sessionStartedAt: 200 }));
    expect(f.spoken).toHaveLength(1);
    f.engine.update(snapshot([message('old'), message('1')], { sessionStartedAt: 200 }));
    expect(f.spoken).toHaveLength(2);
  });

  it('Stop/TTS off clears the queue, ignores late callbacks and starts fresh on re-enable', () => {
    const f = fixture(); f.engine.setEnabled(true, snapshot());
    f.engine.update(snapshot([message('1'), message('2')]));
    const stale = f.spoken[0].onend!;
    f.engine.setEnabled(false, snapshot([message('1'), message('2')]));
    stale.call(f.spoken[0], {} as SpeechSynthesisEvent);
    f.engine.update(snapshot([message('1'), message('2'), message('3')]));
    f.engine.setEnabled(true, snapshot([message('1'), message('2'), message('3')]));
    f.engine.update(snapshot([message('1'), message('2'), message('3')]));
    expect(f.spoken).toHaveLength(1);
  });

  it('preview uses chosen voice/rate without enabling automatic playback or being canceled by polling', () => {
    const f = fixture(); const voice = { lang: 'vi-VN', voiceURI: 'vi' } as SpeechSynthesisVoice;
    f.engine.update(snapshot()); f.engine.configure(voice, 1.25); f.engine.preview();
    const cancels = f.cancel.mock.calls.length;
    f.engine.update(snapshot());
    expect(f.cancel).toHaveBeenCalledTimes(cancels);
    expect(f.spoken[0]).toMatchObject({ voice, rate: 1.25, lang: 'vi-VN' });
    f.end(); f.engine.update(snapshot([message('1')]));
    expect(f.spoken).toHaveLength(1);
  });

  it('surfaces playback errors without logging private text and suppresses stale error events', () => {
    const f = fixture(); f.engine.setEnabled(true, snapshot()); f.engine.update(snapshot([message('private')]));
    f.spoken[0].onerror?.({ error: 'not-allowed' } as SpeechSynthesisErrorEvent);
    expect(f.report.mock.lastCall?.[0]).toMatchObject({ pending: 0, speaking: false, error: expect.stringContaining('Đọc thử') });
    f.engine.preview();
    expect(f.report).toHaveBeenLastCalledWith({ pending: 1, speaking: true, error: null });
    f.engine.stop();
    f.spoken[0].onerror?.({ error: 'network' } as SpeechSynthesisErrorEvent);
    expect(f.report).toHaveBeenLastCalledWith({ pending: 0, speaking: false, error: null });
  });

  it('chunks long Vietnamese and emoji messages without losing words or splitting surrogate pairs', () => {
    const text = 'Tiếng Việt 🐧 '.repeat(100).trim();
    const chunks = speechChunks(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(c => Array.from(c).length <= 180)).toBe(true);
    expect(chunks.join(' ')).toBe(text);
    expect(speechChunks('🐧'.repeat(500)).join('')).toBe('🐧'.repeat(500));
  });
});
