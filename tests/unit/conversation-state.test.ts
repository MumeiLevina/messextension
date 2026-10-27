import { describe, expect, it } from 'vitest';
import { ConversationState } from '../../extension/src/core/conversation-state';
import type { MessengerMessage } from '../../extension/src/core/models';

function msg(text: string, ordinal: number, conversationKey = 'label:an', direction: 'incoming' | 'outgoing' = 'incoming'): MessengerMessage {
  return {
    id: `${conversationKey}-${ordinal}`,
    text,
    normalizedText: text,
    direction,
    timestamp: null,
    directionIsHeuristic: false,
    conversationKey,
    conversationLabel: 'An',
    detectedAt: 1,
    domId: null,
    ordinal,
  };
}

describe('ConversationState', () => {
  it('does not duplicate an archived thread when returning to it and scanning again', () => {
    const state = new ConversationState();
    const a = { key: 'thread:1', label: 'A', url: null };
    state.select(a);
    state.ingest([msg('của A', 0, a.key)]);
    state.select({ key: 'thread:2', label: 'B', url: null });
    state.select(a);
    expect(state.ingest([msg('của A', 0, a.key)])).toHaveLength(0);
    expect(state.activeMessages).toHaveLength(1);
  });
  it('starts empty', () => {
    const state = new ConversationState();
    expect(state.activeMessages).toHaveLength(0);
    expect(state.active).toBeNull();
  });

  it('reports a conversation switch', () => {
    const state = new ConversationState();
    expect(state.select({ key: 'thread:1', label: 'A', url: null })).toBe(true);
    expect(state.select({ key: 'thread:1', label: 'A', url: null })).toBe(false);
    expect(state.select({ key: 'thread:2', label: 'B', url: null })).toBe(true);
  });

  it('never mixes messages from two conversations', () => {
    const state = new ConversationState();
    state.select({ key: 'thread:1', label: 'A', url: null });
    state.ingest([msg('tin A', 0, 'thread:1')]);
    state.select({ key: 'thread:2', label: 'B', url: null });
    state.ingest([msg('tin B', 0, 'thread:2')]);

    expect(state.activeMessages.map((m) => m.text)).toEqual(['tin B']);
    // Switching back restores the original thread's own messages.
    state.select({ key: 'thread:1', label: 'A', url: null });
    expect(state.activeMessages.map((m) => m.text)).toEqual(['tin A']);
  });

  it('ingests only genuinely new messages', () => {
    const state = new ConversationState();
    state.select({ key: 'thread:1', label: 'A', url: null });
    expect(state.ingest([msg('một', 0)])).toHaveLength(1);
    expect(state.ingest([msg('một', 0)])).toHaveLength(0);
    expect(state.ingest([msg('một', 0), msg('hai', 1)])).toHaveLength(1);
    expect(state.activeMessages).toHaveLength(2);
  });

  it('counts prevented duplicates', () => {
    const state = new ConversationState();
    state.select({ key: 'thread:1', label: 'A', url: null });
    state.ingest([msg('một', 0)]);
    state.ingest([msg('một', 0)]);
    expect(state.lastDuplicateCount()).toBe(1);
  });

  it('clears the active conversation on request', () => {
    const state = new ConversationState();
    state.select({ key: 'thread:1', label: 'A', url: null });
    state.ingest([msg('một', 0)]);
    state.clearActive();
    expect(state.activeMessages).toHaveLength(0);
  });

  it('lists known conversations', () => {
    const state = new ConversationState();
    state.select({ key: 'thread:1', label: 'A', url: null });
    state.select({ key: 'thread:2', label: 'B', url: null });
    expect(state.listConversations()).toHaveLength(2);
  });
});
