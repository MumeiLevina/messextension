import { describe, expect, it } from 'vitest';
import { extractConversation, findMessageList, detectConversation } from '../../extension/src/content/messenger-adapter';
import { buildMessengerDom, stubLayout } from '../fixtures/dom-harness';

function mount(options: Parameters<typeof buildMessengerDom>[0] = {}) {
  const root = buildMessengerDom(options);
  document.body.appendChild(root);
  stubLayout(root);
  return root;
}

describe('Messenger adapter', () => {
  it('finds the message list and ignores the chat sidebar', () => {
    const root = mount({ bubbles: [{ text: 'a', direction: 'incoming' }] });
    const list = findMessageList(root);
    expect(list).not.toBeNull();
    expect(list?.id).toBe('message-list');
  });

  it('extracts message text in DOM order', () => {
    const root = mount({
      bubbles: [
        { text: 'Câu một', direction: 'incoming' },
        { text: 'Câu hai', direction: 'outgoing' },
        { text: 'Câu ba', direction: 'incoming' },
      ],
    });
    const result = extractConversation({ root });
    expect(result.unsupported).toBe(false);
    expect(result.messages.map((m) => m.text)).toEqual(['Câu một', 'Câu hai', 'Câu ba']);
  });

  it('detects direction from explicit class markers', () => {
    const root = mount({
      bubbles: [
        { text: 'in', direction: 'incoming' },
        { text: 'out', direction: 'outgoing' },
      ],
    });
    const result = extractConversation({ root });
    expect(result.messages[0].direction).toBe('incoming');
    expect(result.messages[1].direction).toBe('outgoing');
  });

  it('falls back to geometry when no explicit marker exists', () => {
    const root = mount();
    const list = root.querySelector('#message-list')!;
    const item = document.createElement('div');
    item.setAttribute('role', 'listitem');
    item.textContent = 'vị trí bên phải';
    list.appendChild(item);
    Object.defineProperty(item, 'getBoundingClientRect', {
      value: () => ({ left: 320, right: 590, top: 0, bottom: 40, width: 270, height: 40, x: 320, y: 0 }),
    });
    const result = extractConversation({ root });
    expect(result.messages[0].direction).toBe('outgoing');
    expect(result.messages[0].directionIsHeuristic).toBe(true);
  });

  it('reads the conversation title', () => {
    const root = mount({ title: 'Trần Thị B' });
    const conversation = detectConversation(root);
    expect(conversation.label).toBe('Trần Thị B');
    expect(conversation.key).toContain('trần thị b');
  });

  it('reports unsupported when no message list can be found', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div>không có gì cả</div>';
    document.body.appendChild(root);
    const result = extractConversation({ root });
    expect(result.unsupported).toBe(true);
    expect(result.warning).toBeTruthy();
    expect(result.messages).toHaveLength(0);
  });

  it('preserves Vietnamese diacritics exactly', () => {
    const text = 'Tôi nghĩ chúng ta nên đặt lịch ở quán cà phê gần nhà';
    const root = mount({ bubbles: [{ text, direction: 'incoming' }] });
    const result = extractConversation({ root });
    expect(result.messages[0].text).toBe(text);
  });

  it('preserves meaningful line breaks', () => {
    const root = mount({ bubbles: [{ text: 'dòng một\ndòng hai', direction: 'incoming' }] });
    const result = extractConversation({ root });
    expect(result.messages[0].text).toBe('dòng một\ndòng hai');
  });

  it('extracts a visible timestamp when present', () => {
    const root = mount({ bubbles: [{ text: 'x', direction: 'incoming', time: '10:30' }] });
    const result = extractConversation({ root });
    expect(result.messages[0].timestamp).toBe('10:30');
  });

  it('drops UI chrome text such as "Enter để gửi"', () => {
    const root = mount({ bubbles: [{ text: 'Enter để gửi', direction: 'incoming' }] });
    const result = extractConversation({ root });
    expect(result.messages).toHaveLength(0);
  });

  it('keeps emoji and mixed-language content intact', () => {
    const text = 'Hello bạn 👋 nice to meet you, mình tên là Nam';
    const root = mount({ bubbles: [{ text, direction: 'incoming' }] });
    const result = extractConversation({ root });
    expect(result.messages[0].text).toBe(text);
  });

  it('handles a very long message', () => {
    const long = 'A'.repeat(5000);
    const root = mount({ bubbles: [{ text: long, direction: 'incoming' }] });
    const result = extractConversation({ root });
    expect(result.messages[0].text).toHaveLength(5000);
  });

  it('works in dark theme identically', () => {
    const root = mount({
      theme: 'dark',
      bubbles: [
        { text: 'Tối', direction: 'incoming' },
        { text: 'Sáng', direction: 'outgoing' },
      ],
    });
    const result = extractConversation({ root });
    expect(result.messages.map((m) => m.text)).toEqual(['Tối', 'Sáng']);
  });

  it('requires a composer to reach full confidence', () => {
    const root = mount({ withoutComposer: true, bubbles: [{ text: 'x', direction: 'incoming' }] });
    const list = findMessageList(root);
    // Without a composer the list may still be found via the aria label, but
    // the adapter must not silently mis-attribute the sidebar.
    expect(list === null || list.id === 'message-list').toBe(true);
  });
});
