import { describe, expect, it, vi } from 'vitest';
import { extractConversation } from '../../extension/src/content/messenger-adapter';
import { ConversationState } from '../../extension/src/core/conversation-state';
import { buildMessengerDom, stubLayout } from '../fixtures/dom-harness';

/**
 * DOM extraction benchmark over 50+ controlled fixture scenarios.
 *
 * Targets from the spec:
 *   - >= 99% exact text extraction on supported synthetic fixtures
 *   - zero cross-conversation mixing
 *   - zero ordering errors
 */

const VIETNAMESE = [
  'Chào bạn, hôm nay bạn khỏe không?',
  'Tôi sẽ gửi tài liệu sau ít phút',
  'Nguyễn Văn Anh',
  'Bạn có thể gửi lại địa chỉ không?',
  'Cảm ơn bạn rất nhiều!',
  'Họp lúc 9 giờ sáng mai nhé',
  'Mình đã đặt vé tàu',
  'Chúc bạn một ngày tốt lành 😊',
  'Hello bạn, nice to meet you',
  'Địa chỉ: 12 Nguyễn Huệ, Quận 1',
];

interface Scenario {
  name: string;
  bubbles: { text: string; direction: 'incoming' | 'outgoing' | 'unknown'; id?: string; time?: string }[];
  theme: 'light' | 'dark';
  withSidebar: boolean;
}

function buildScenarios(): Scenario[] {
  const scenarios: Scenario[] = [];

  // 1. Repeated identical text across directions.
  scenarios.push({
    name: 'identical-text-mixed-directions',
    bubbles: [
      { text: 'Hello', direction: 'incoming' },
      { text: 'Hello', direction: 'incoming' },
      { text: 'Hello', direction: 'outgoing' },
    ],
    theme: 'light',
    withSidebar: true,
  });

  // 2. Long conversation with Vietnamese text.
  for (let i = 0; i < 8; i += 1) {
    scenarios.push({
      name: `vietnamese-conversation-${i}`,
      bubbles: VIETNAMESE.map((text, j) => ({
        text,
        direction: j % 2 === 0 ? ('incoming' as const) : ('outgoing' as const),
        id: `m${j}`,
      })),
      theme: i % 2 === 0 ? ('light' as const) : ('dark' as const),
      withSidebar: i % 3 !== 0,
    });
  }

  // 3. Varying lengths including long messages.
  for (const len of [1, 5, 20, 60, 150]) {
    scenarios.push({
      name: `length-${len}`,
      bubbles: Array.from({ length: len }, (_, i) => ({
        text: `Tin nhắn ${i}: ${'x'.repeat(40)}`,
        direction: i % 2 === 0 ? ('incoming' as const) : ('outgoing' as const),
      })),
      theme: 'light',
      withSidebar: true,
    });
  }

  // 4. Emoji and mixed scripts.
  scenarios.push({
    name: 'emoji-mixed-script',
    bubbles: [
      { text: 'Chào 👋 bạn 🇻🇳', direction: 'incoming' },
      { text: 'Hello 世界 🌍', direction: 'outgoing' },
      { text: 'ok 👍🏽', direction: 'incoming' },
    ],
    theme: 'dark',
    withSidebar: true,
  });

  // 5. Timestamps present.
  scenarios.push({
    name: 'with-timestamps',
    bubbles: [
      { text: 'sáng nay', direction: 'incoming', time: '08:15' },
      { text: 'trưa nay', direction: 'outgoing', time: '12:30' },
      { text: 'tối nay', direction: 'incoming', time: '21:05' },
    ],
    theme: 'light',
    withSidebar: true,
  });

  // 6. Single-message conversations.
  for (let i = 0; i < 6; i += 1) {
    scenarios.push({
      name: `single-message-${i}`,
      bubbles: [{ text: VIETNAMESE[i], direction: i % 2 ? 'outgoing' : 'incoming' }],
      theme: i % 2 ? 'dark' : 'light',
      withSidebar: i % 2 === 0,
    });
  }

  // 7. Large conversation.
  scenarios.push({
    name: 'large-conversation-100',
    bubbles: Array.from({ length: 100 }, (_, i) => ({
      text: `Dòng ${i} — nội dung thử nghiệm với tiếng Việt có dấu đầy đủ`,
      direction: i % 3 === 0 ? ('outgoing' as const) : ('incoming' as const),
      id: `m${i}`,
    })),
    theme: 'light',
    withSidebar: true,
  });

  // 8. Repeated blocks to reach 50+ scenarios.
  for (let i = 0; i < 27; i += 1) {
    scenarios.push({
      name: `randomized-${i}`,
      bubbles: Array.from({ length: 3 + i }, (_, j) => ({
        text: VIETNAMESE[(i + j) % VIETNAMESE.length],
        direction: j % 2 ? ('outgoing' as const) : ('incoming' as const),
        id: `m${j}`,
      })),
      theme: i % 2 ? 'dark' : 'light',
      withSidebar: true,
    });
  }

  return scenarios;
}

const scenarios = buildScenarios();

describe('DOM extraction benchmark', () => {
  it('covers at least 50 scenarios', () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(50);
  });

  it('extracts every message exactly, in order', () => {
    let correct = 0;
    let incorrect = 0;
    let missed = 0;
    let orderingErrors = 0;
    let duplicateEvents = 0;
    let fixtureMs = 0;
    let extractionMs = 0;
    let cssMs = 0;
    let cssReads = 0;
    const originalStyle = window.getComputedStyle.bind(window);
    const styleSpy = vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      const started = performance.now();
      const result = originalStyle(element, pseudo);
      cssMs += performance.now() - started;
      cssReads++;
      return result;
    });

    for (const scenario of scenarios) {
      const fixtureStart = performance.now();
      const root = buildMessengerDom({
        title: 'Người Kiểm Thử',
        bubbles: scenario.bubbles,
        theme: scenario.theme,
        withSidebar: scenario.withSidebar,
      });
      document.body.appendChild(root);
      stubLayout(root);
      fixtureMs += performance.now() - fixtureStart;

      const extractionStart = performance.now();
      const extracted = extractConversation({ root });
      extractionMs += performance.now() - extractionStart;
      if (extracted.unsupported) {
        missed += scenario.bubbles.length;
        continue;
      }

      const actual = extracted.messages.map((m) => m.text);
      const expected = scenario.bubbles.map((b) => b.text);

      for (let i = 0; i < expected.length; i += 1) {
        if (actual[i] === expected[i]) correct += 1;
        else if (i < actual.length) incorrect += 1;
        else missed += 1;
      }
      if (actual.length > expected.length) {
        duplicateEvents += actual.length - expected.length;
      }
      for (let i = 0; i < Math.min(actual.length, expected.length); i += 1) {
        if (actual[i] !== expected[i]) orderingErrors += 1;
      }

      document.body.removeChild(root);
    }

    const total = correct + incorrect + missed;
    styleSpy.mockRestore();
    const accuracy = (correct / total) * 100;
    console.log(
      `[BENCH] DOM extraction: ${accuracy.toFixed(2)}% exact ` +
        `(${correct}/${total}), incorrect=${incorrect}, missed=${missed}, ` +
        `duplicateEvents=${duplicateEvents}, orderingErrors=${orderingErrors}`,
    );
    console.log(`[BENCH] Correctness workload: fixtures=${fixtureMs.toFixed(2)} ms, extraction=${extractionMs.toFixed(2)} ms`);
    console.log(`[BENCH] jsdom computed CSS: ${cssReads} calls, ${cssMs.toFixed(2)} ms`);

    expect(accuracy).toBeGreaterThanOrEqual(99);
    expect(incorrect).toBe(0);
    expect(missed).toBe(0);
    expect(duplicateEvents).toBe(0);
    expect(orderingErrors).toBe(0);
  });

  it('produces zero cross-conversation mixing', () => {
    const state = new ConversationState();
    const rootA = buildMessengerDom({
      title: 'Người A',
      bubbles: [{ text: 'của A', direction: 'incoming' }],
    });
    document.body.appendChild(rootA);
    stubLayout(rootA);

    const extractedA = extractConversation({ root: rootA });
    state.select(extractedA.conversation);
    state.ingest(extractedA.messages);

    const rootB = buildMessengerDom({
      title: 'Người B',
      bubbles: [{ text: 'của B', direction: 'incoming' }],
    });
    document.body.appendChild(rootB);
    stubLayout(rootB);

    const extractedB = extractConversation({ root: rootB });
    state.select(extractedB.conversation);
    state.ingest(extractedB.messages);

    expect(state.activeMessages.map((m) => m.text)).toEqual(['của B']);
    expect(state.activeMessages.some((m) => m.text === 'của A')).toBe(false);
  });

  it('reports extraction latency', () => {
    const root = buildMessengerDom({
      bubbles: Array.from({ length: 100 }, (_, i) => ({
        text: `Tin ${i}`,
        direction: i % 2 ? ('outgoing' as const) : ('incoming' as const),
      })),
    });
    document.body.appendChild(root);
    stubLayout(root);

    const runs = 50;
    const started = performance.now();
    for (let i = 0; i < runs; i += 1) extractConversation({ root });
    const avg = (performance.now() - started) / runs;
    console.log(`[BENCH] DOM extraction latency: ${avg.toFixed(2)} ms for 100 messages`);
    expect(avg).toBeLessThan(100);
  });
});
