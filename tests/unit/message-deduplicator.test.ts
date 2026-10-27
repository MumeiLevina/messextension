import { describe, expect, it } from 'vitest';
import { MessageDeduplicator } from '../../extension/src/content/message-deduplicator';
import type { MessengerMessage } from '../../extension/src/core/models';

function msg(partial: Partial<MessengerMessage> & { text: string; ordinal: number }): MessengerMessage {
  return {
    id: '',
    normalizedText: partial.text,
    direction: 'incoming',
    timestamp: null,
    directionIsHeuristic: false,
    conversationKey: 'label:an',
    conversationLabel: 'An',
    detectedAt: Date.now(),
    domId: null,
    ...partial,
  } as MessengerMessage;
}

describe('MessageDeduplicator', () => {
  it('keeps a new stable message id even when a virtualized slot and text are identical', () => {
    const dedup = new MessageDeduplicator();
    dedup.ingest([msg({ text: 'ok', ordinal: 0, domId: 'message:first' })]);
    expect(dedup.ingest([msg({ text: 'ok', ordinal: 0, domId: 'message:second' })]).added).toHaveLength(1);
  });

  it('detects an edit that changes only Vietnamese accents', () => {
    const dedup = new MessageDeduplicator();
    dedup.ingest([msg({ text: 'ban', ordinal: 0, domId: 'message:first' })]);
    expect(dedup.ingest([msg({ text: 'bạn', ordinal: 0, domId: 'message:first' })]).added).toHaveLength(1);
  });
  it('preserves a run of five identical legitimate messages on both the first scan and reconciliation', () => {
    const dedup = new MessageDeduplicator();
    const batch = Array.from({ length: 5 }, (_, ordinal) => msg({ text: 'giống nhau', ordinal }));
    expect(dedup.ingest(batch).added).toHaveLength(5);
    expect(dedup.ingest(batch).added).toHaveLength(0);
    expect(dedup.ingest([...batch, msg({ text: 'giống nhau', ordinal: 5 })]).added).toHaveLength(1);
  });
  it('keeps three identical texts distinct when direction or position differ', () => {
    const dedup = new MessageDeduplicator();
    const batch = [
      msg({ text: 'Hello', ordinal: 0, direction: 'incoming' }),
      msg({ text: 'Hello', ordinal: 1, direction: 'incoming' }),
      msg({ text: 'Hello', ordinal: 2, direction: 'outgoing' }),
    ];
    const result = dedup.ingest(batch);
    expect(result.added).toHaveLength(3);
    expect(result.duplicates).toBe(0);
  });

  it('detects a repeated ingest as fully duplicate', () => {
    const dedup = new MessageDeduplicator();
    const batch = [msg({ text: 'Xin chào', ordinal: 0 })];
    expect(dedup.ingest(batch).added).toHaveLength(1);
    const second = dedup.ingest(batch);
    expect(second.added).toHaveLength(0);
    expect(second.duplicates).toBe(1);
  });

  it('does not mix conversations', () => {
    const dedup = new MessageDeduplicator();
    dedup.ingest([msg({ text: 'chào', ordinal: 0, conversationKey: 'thread:1' })]);
    const other = dedup.ingest([msg({ text: 'chào', ordinal: 0, conversationKey: 'thread:2' })]);
    expect(other.added).toHaveLength(1);
  });

  it('treats a changed DOM id on the same slot as the same message', () => {
    const dedup = new MessageDeduplicator();
    dedup.ingest([msg({ text: 'giữ nguyên', ordinal: 3, domId: 'old' })]);
    const result = dedup.ingest([msg({ text: 'giữ nguyên', ordinal: 3, domId: 'new' })]);
    expect(result.added).toHaveLength(0);
    expect(result.duplicates).toBe(1);
  });

  it('detects a genuinely new message appended after known ones', () => {
    const dedup = new MessageDeduplicator();
    dedup.ingest([msg({ text: 'một', ordinal: 0 })]);
    const result = dedup.ingest([
      msg({ text: 'một', ordinal: 0 }),
      msg({ text: 'hai', ordinal: 1 }),
    ]);
    expect(result.added).toHaveLength(1);
    expect(result.added[0].text).toBe('hai');
  });

  it('treats the same text with a different timestamp as new', () => {
    const dedup = new MessageDeduplicator();
    dedup.ingest([msg({ text: 'ok', ordinal: 0, timestamp: '10:00' })]);
    const result = dedup.ingest([msg({ text: 'ok', ordinal: 0, timestamp: '11:00' })]);
    expect(result.added).toHaveLength(1);
  });

  it('re-detects a message after its DOM id is forgotten by a re-render', () => {
    const dedup = new MessageDeduplicator();
    dedup.ingest([msg({ text: 'cuộn', ordinal: 2, domId: 'a' })]);
    dedup.forgetMissingDomIds('label:an', new Set<string>());
    const result = dedup.ingest([msg({ text: 'cuộn', ordinal: 2, domId: 'b' })]);
    expect(result.added).toHaveLength(0);
  });

  it('resets state for one conversation without touching the other', () => {
    const dedup = new MessageDeduplicator();
    dedup.ingest([msg({ text: 'a', ordinal: 0, conversationKey: 'thread:1' })]);
    dedup.ingest([msg({ text: 'b', ordinal: 0, conversationKey: 'thread:2' })]);
    dedup.reset('thread:1');
    expect(dedup.ingest([msg({ text: 'a', ordinal: 0, conversationKey: 'thread:1' })]).added).toHaveLength(1);
    expect(dedup.ingest([msg({ text: 'b', ordinal: 0, conversationKey: 'thread:2' })]).added).toHaveLength(0);
  });

  it('reports the number of duplicates prevented in the last call', () => {
    const dedup = new MessageDeduplicator();
    dedup.ingest([msg({ text: 'x', ordinal: 0 })]);
    dedup.ingest([msg({ text: 'x', ordinal: 0 }), msg({ text: 'y', ordinal: 1 })]);
    expect(dedup.lastDuplicates).toBe(1);
  });
});
