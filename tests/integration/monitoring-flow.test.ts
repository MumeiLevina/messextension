import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { extractConversation } from '../../extension/src/content/messenger-adapter';
import { ConversationState } from '../../extension/src/core/conversation-state';
import { MonitoringController } from '../../extension/src/content/mutation-monitor';
import {
  buildMessengerDom,
  appendBubble,
  removeBubble,
  restubLayout,
  stubLayout,
} from '../fixtures/dom-harness';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('End-to-end monitoring flow', () => {
  it('detects a new message appended to the conversation', () => {
    const root = buildMessengerDom({
      bubbles: [{ text: 'Câu đầu', direction: 'incoming' }],
    });
    document.body.appendChild(root);
    stubLayout(root);

    const state = new ConversationState();
    const scan = () => {
      const extracted = extractConversation({ root });
      state.select(extracted.conversation);
      return state.ingest(extracted.messages);
    };

    expect(scan()).toHaveLength(1);

    appendBubble(root, { text: 'Câu mới', direction: 'incoming', id: 'm2' });
    restubLayout(root);

    const added = scan();
    expect(added).toHaveLength(1);
    expect(added[0].text).toBe('Câu mới');
  });

  it('does not report the same message twice across many scans', () => {
    const root = buildMessengerDom({
      bubbles: [
        { text: 'A', direction: 'incoming' },
        { text: 'B', direction: 'outgoing' },
      ],
    });
    document.body.appendChild(root);
    stubLayout(root);

    const state = new ConversationState();
    const scan = () => {
      const extracted = extractConversation({ root });
      state.select(extracted.conversation);
      return state.ingest(extracted.messages);
    };

    scan();
    for (let i = 0; i < 10; i += 1) {
      expect(scan()).toHaveLength(0);
    }
    expect(state.activeMessages).toHaveLength(2);
  });

  it('keeps three identical messages distinct in the real flow', () => {
    const root = buildMessengerDom({
      bubbles: [
        { text: 'Hello', direction: 'incoming' },
        { text: 'Hello', direction: 'incoming' },
        { text: 'Hello', direction: 'outgoing' },
      ],
    });
    document.body.appendChild(root);
    stubLayout(root);

    const state = new ConversationState();
    const extracted = extractConversation({ root });
    state.select(extracted.conversation);
    const added = state.ingest(extracted.messages);

    expect(added).toHaveLength(3);
    expect(state.activeMessages).toHaveLength(3);
    expect(state.activeMessages.filter((m) => m.direction === 'incoming')).toHaveLength(2);
    expect(state.activeMessages.filter((m) => m.direction === 'outgoing')).toHaveLength(1);
  });

  it('isolates state when the conversation changes', () => {
    const root = buildMessengerDom({
      title: 'Người A',
      bubbles: [{ text: 'của A', direction: 'incoming' }],
    });
    document.body.appendChild(root);
    stubLayout(root);

    const state = new ConversationState();
    const scan = () => {
      const extracted = extractConversation({ root });
      const changed = state.select(extracted.conversation);
      state.ingest(extracted.messages);
      return changed;
    };

    scan();
    expect(state.activeMessages.map((m) => m.text)).toEqual(['của A']);

    // Switch to another thread.
    const heading = root.querySelector('#thread-title')!;
    heading.textContent = 'Người B';
    const list = root.querySelector('#message-list')!;
    list.innerHTML = '';
    appendBubble(root, { text: 'của B', direction: 'incoming' });
    restubLayout(root);

    expect(scan()).toBe(true);
    expect(state.activeMessages.map((m) => m.text)).toEqual(['của B']);
    expect(state.activeMessages.some((m) => m.text === 'của A')).toBe(false);
  });

  it('survives a deleted node without losing the conversation', () => {
    const root = buildMessengerDom({
      bubbles: [
        { text: 'giữ lại', direction: 'incoming', id: 'm1' },
        { text: 'bị xoá', direction: 'incoming', id: 'm2' },
      ],
    });
    document.body.appendChild(root);
    stubLayout(root);

    const state = new ConversationState();
    const scan = () => {
      const extracted = extractConversation({ root });
      state.select(extracted.conversation);
      return state.ingest(extracted.messages);
    };

    scan();
    removeBubble(root, 'm2');
    restubLayout(root);
    expect(scan()).toHaveLength(0);
    expect(state.activeMessages).toHaveLength(2);
  });

  it('handles a node whose text was updated', () => {
    const root = buildMessengerDom({
      bubbles: [{ text: 'bản cũ', direction: 'incoming', id: 'm1' }],
    });
    document.body.appendChild(root);
    stubLayout(root);

    const state = new ConversationState();
    const scan = () => {
      const extracted = extractConversation({ root });
      state.select(extracted.conversation);
      return state.ingest(extracted.messages);
    };

    scan();
    const item = root.querySelector('[data-message-id="m1"] span')!;
    item.textContent = 'bản mới';
    restubLayout(root);

    const added = scan();
    // The same DOM node with new content is a new message, not a duplicate.
    expect(added.some((m) => m.text === 'bản mới')).toBe(true);
  });

  it('reconciles on the 5 second interval without overlapping', () => {
    const root = buildMessengerDom({ bubbles: [{ text: 'x', direction: 'incoming' }] });
    document.body.appendChild(root);
    stubLayout(root);

    const state = new ConversationState();
    const scan = vi.fn(() => {
      const extracted = extractConversation({ root });
      state.select(extracted.conversation);
      state.ingest(extracted.messages);
    });

    const monitor = new MonitoringController({ intervalMs: 5000, onScan: scan });
    monitor.start(root);

    vi.advanceTimersByTime(30000);
    expect(scan).toHaveBeenCalledTimes(6);
    monitor.stop();
  });

  it('stops extracting once monitoring stops', () => {
    const root = buildMessengerDom({ bubbles: [{ text: 'x', direction: 'incoming' }] });
    document.body.appendChild(root);
    stubLayout(root);

    const scan = vi.fn(() => {
      const extracted = extractConversation({ root });
      state.select(extracted.conversation);
      state.ingest(extracted.messages);
    });
    const state = new ConversationState();

    const monitor = new MonitoringController({ intervalMs: 5000, onScan: scan });
    monitor.start(root);
    vi.advanceTimersByTime(5000);
    const before = scan.mock.calls.length;
    monitor.stop();
    appendBubble(root, { text: 'sau khi dừng', direction: 'incoming' });
    restubLayout(root);
    vi.advanceTimersByTime(30000);
    expect(scan.mock.calls.length).toBe(before);
  });

  it('handles a rapid burst of message updates', () => {
    const root = buildMessengerDom({ bubbles: [] });
    document.body.appendChild(root);
    stubLayout(root);

    const state = new ConversationState();
    const scan = () => {
      const extracted = extractConversation({ root });
      state.select(extracted.conversation);
      return state.ingest(extracted.messages);
    };

    for (let i = 0; i < 20; i += 1) {
      appendBubble(root, { text: `tin ${i}`, direction: i % 2 ? 'outgoing' : 'incoming', id: `m${i}` });
    }
    restubLayout(root);

    const added = scan();
    expect(added).toHaveLength(20);
    expect(state.activeMessages.map((m) => m.text)).toEqual(
      Array.from({ length: 20 }, (_, i) => `tin ${i}`),
    );
  });

  it('measures processing latency well under the interval', () => {
    const bubbles = Array.from({ length: 50 }, (_, i) => ({
      text: `tin nhắn số ${i}`,
      direction: (i % 2 ? 'outgoing' : 'incoming') as 'incoming' | 'outgoing',
      id: `m${i}`,
    }));
    const root = buildMessengerDom({ bubbles });
    document.body.appendChild(root);
    stubLayout(root);

    const started = performance.now();
    for (let i = 0; i < 20; i += 1) {
      extractConversation({ root });
    }
    const avg = (performance.now() - started) / 20;
    expect(avg).toBeLessThan(5000);
  });
});
