/**
 * Regression tests for the *current* Messenger DOM shape.
 *
 * The older fixture used `role="list"` / `role="listitem"`, which the real
 * Messenger UI does not use. These tests exercise the geometry-and-structure
 * path that the real page requires.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  extractConversation,
  findConversationContainer,
  findComposer,
} from '../../extension/src/content/messenger-adapter';
import {
  appendModernRow,
  buildModernMessengerDom,
  removeModernRow,
  restubModernLayout,
  stubModernLayout,
} from '../fixtures/messenger-modern';

function mount(options: Parameters<typeof buildModernMessengerDom>[0] = {}) {
  const root = buildModernMessengerDom(options);
  document.body.appendChild(root);
  stubModernLayout(root);
  return root;
}

afterEach(() => { history.replaceState({}, '', '/'); });

describe('Messenger adapter — current DOM shape', () => {
  it('reads the outgoing payload without sender and delivery labels from the surrounding row', () => {
    const root = mount({ bubbles: [{ text: 'Synthetic outgoing text', direction: 'outgoing', id: 'out' }] });
    const row = root.querySelector('.msg-row')!;
    row.insertAdjacentHTML('afterbegin', '<h4 dir="auto">Bạn đã gửi</h4>');
    row.insertAdjacentHTML('beforeend', '<div>Đã gửi</div><div role="status">Đã nhận</div>');
    expect(extractConversation({ root }).messages.map(m => m.text)).toEqual(['Synthetic outgoing text']);
  });

  it('preserves a literal delivery phrase when it is the actual user message', () => {
    const root = mount({ bubbles: [{ text: 'Đã gửi', direction: 'outgoing' }] });
    root.querySelector('.msg-row')!.insertAdjacentHTML('beforeend', '<span role="status">Đã gửi</span>');
    expect(extractConversation({ root }).messages[0].text).toBe('Đã gửi');
  });

  it('extracts only the clock from an aria summary instead of copying the sender and body', () => {
    const root = mount({ bubbles: [{ text: 'Synthetic outgoing text', direction: 'outgoing' }] });
    root.querySelector('.msg-row')!.setAttribute('aria-label', 'Lúc 15:21, Bạn: Synthetic outgoing text');
    expect(extractConversation({ root }).messages[0].timestamp).toBe('15:21');
  });

  it('does not concatenate nested dir=auto copies or tooltip/status text', () => {
    const root = mount({ bubbles: [{ text: 'Synthetic payload', direction: 'outgoing' }] });
    const payload = root.querySelector('[dir="auto"]')!;
    payload.innerHTML = '<span dir="auto">Synthetic payload</span><span role="tooltip">Delivery details</span>';
    expect(extractConversation({ root }).messages[0].text).toBe('Synthetic payload');
  });

  it('reads an explicit time element without treating a plain clock message as metadata', () => {
    const root = mount({ bubbles: [{ text: '15:21', direction: 'incoming' }] });
    root.querySelector('.msg-row')!.insertAdjacentHTML('beforeend', '<time>15:22</time>');
    const message = extractConversation({ root }).messages[0];
    expect(message.text).toBe('15:21'); expect(message.timestamp).toBe('15:22');
  });

  it('does not cache a prior scan visibility decision after CSS visibility changes', () => {
    const root = mount({ bubbles: [{ text: 'Nội dung', direction: 'incoming' }] });
    expect(extractConversation({ root }).messages).toHaveLength(1);
    (root.querySelector('.msg-bubble') as HTMLElement).style.display = 'none';
    expect(extractConversation({ root }).messages).toHaveLength(0);
    (root.querySelector('.msg-bubble') as HTMLElement).style.display = '';
    expect(extractConversation({ root }).messages).toHaveLength(1);
  });
  it('does not prepend sender headings or accessibility-only text to a message', () => {
    const root = mount({ bubbles: [{ text: 'Nội dung thật', direction: 'incoming' }] });
    root.querySelector('.msg-row')!.insertAdjacentHTML('afterbegin', '<h4 dir="auto"><span>Synthetic sender</span></h4><span style="position:absolute;clip:rect(0px,0px,0px,0px);clip-path:inset(50%)">Accessible duplicate</span>');
    expect(extractConversation({ root }).messages.map(m => m.text)).toEqual(['Nội dung thật']);
  });

  it('finds a header above nested log/composer wrappers and ignores clipped headings', () => {
    const root = mount({ title: 'Synthetic recipient', bubbles: [{ text: 'Nội dung thật', direction: 'incoming' }] });
    const thread = root.querySelector('#thread')!;
    let group = document.createElement('div');
    thread.append(group);
    group.append(root.querySelector('#thread-scroll')!, root.querySelector('#composer')!);
    for (let i = 0; i < 7; i++) {
      const next = document.createElement('div'); next.append(...Array.from(group.childNodes)); group.append(next); group = next;
    }
    group.insertAdjacentHTML('afterbegin', '<h3 style="position:absolute;clip:rect(0px,0px,0px,0px);clip-path:inset(50%)">Tin nhắn</h3>');
    expect(extractConversation({ root }).conversation.label).toBe('Synthetic recipient');
  });

  it('rejects a zero-size composer instead of treating it as visible', () => {
    const root = mount({ bubbles: [{ text: 'nội dung', direction: 'incoming' }] });
    Object.defineProperty(root.querySelector('[contenteditable]'), 'getBoundingClientRect', { configurable: true,
      value: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }) });
    expect(findComposer(root)).toBeNull();
    expect(extractConversation({ root }).unsupported).toBe(true);
  });

  it('does not fall back to a CSS-hidden composer', () => {
    const root = mount({ bubbles: [{ text: 'ẩn', direction: 'incoming' }] });
    (root.querySelector('#composer') as HTMLElement).style.display = 'none';
    expect(findComposer(root)).toBeNull();
    expect(findConversationContainer(root).container).toBeNull();
  });

  it('does not substitute the sidebar when the selected thread has no scroller', () => {
    const root = mount({ bubbles: [{ text: 'nội dung', direction: 'incoming' }] });
    root.querySelector('#thread-scroll')!.remove();
    expect(findConversationContainer(root).container).toBeNull();
    expect(extractConversation({ root }).messages).toEqual([]);
  });

  it('preserves multiple multiline bubbles and all their sibling rows', () => {
    const root = mount({ bubbles: [{ text: 'a', direction: 'incoming' }, { text: 'b', direction: 'outgoing' }] });
    for (const text of root.querySelectorAll('[dir="auto"]')) text.innerHTML = '<div>dòng một</div><div>dòng hai</div>';
    const result = extractConversation({ root });
    expect(result.messages.map(m => m.text)).toEqual(['dòng một\ndòng hai', 'dòng một\ndòng hai']);
    expect(result.candidates).toBe(2);
  });

  it('skips hidden nested text, buttons and reactions while keeping an inline emoji image', () => {
    const root = mount({ bubbles: [{ text: 'Xin chào ', direction: 'incoming' }] });
    root.querySelector('[dir="auto"]')!.insertAdjacentHTML('beforeend', '<img alt="👋"><span hidden>PRIVATE HIDDEN</span><span style="display:none">CSS HIDDEN</span><span aria-label="reaction">99</span><button>Thích</button>');
    expect(extractConversation({ root }).messages[0].text).toBe('Xin chào 👋');
  });

  it('counts parser rejections as rejected rows', () => {
    const root = mount({ bubbles: [{ text: 'Enter để gửi', direction: 'incoming' }] });
    const result = extractConversation({ root });
    expect(result).toMatchObject({ candidates: 1, parsed: 0, rejected: 1, status: 'all-rejected' });
  });

  it('keeps a literal Today message distinct from a date separator', () => {
    const root = mount({ bubbles: [{ text: 'Today', direction: 'incoming' }] });
    expect(extractConversation({ root }).messages[0].text).toBe('Today');
  });

  it('finds the timestamp even when an avatar title precedes it', () => {
    const root = mount({ bubbles: [{ text: 'nội dung', direction: 'incoming', time: '10:30' }] });
    root.querySelector('.msg-row')!.insertAdjacentHTML('afterbegin', '<img title="Synthetic person" alt="Avatar">');
    expect(extractConversation({ root }).messages[0].timestamp).toBe('10:30');
  });

  it('uses the E2EE thread URL instead of a non-unique display name', () => {
    mount({ bubbles: [{ text: 'nội dung', direction: 'incoming' }] });
    history.replaceState({}, '', '/messages/e2ee/t/123456');
    expect(extractConversation().conversation.key).toBe('thread:123456');
    history.replaceState({}, '', '/messages/e2ee/t/987654');
    expect(extractConversation().conversation.key).toBe('thread:987654');
  });

  it('distinguishes an empty recognized thread from an unsupported layout', () => {
    const root = mount();
    expect(extractConversation({ root })).toMatchObject({ status: 'no-visible-messages', unsupported: false, parsed: 0, strategy: 'scroller' });
  });

  it('reports no selection on a full Messenger document without a composer or thread', () => {
    history.replaceState({}, '', '/messages');
    mount({ withComposer: false });
    expect(extractConversation().status).toBe('no-conversation');
  });

  it('reports a loading conversation separately from unsupported DOM', () => {
    history.replaceState({}, '', '/messages/e2ee/t/123456');
    const root = mount({ withComposer: false });
    const progress = document.createElement('div'); progress.setAttribute('role', 'progressbar');
    Object.defineProperty(progress, 'getBoundingClientRect', { value: () => ({ width: 40, height: 40, top: 80, bottom: 120, left: 400, right: 440 }) });
    root.querySelector('#thread-scroll')!.append(progress);
    expect(extractConversation()).toMatchObject({ status: 'loading', unsupported: false, parsed: 0 });
  });

  it('finds the conversation container without ARIA list roles', () => {
    const root = mount({
      bubbles: [
        { text: 'Câu một', direction: 'incoming' },
        { text: 'Câu hai', direction: 'outgoing' },
      ],
    });
    const { container, strategy } = findConversationContainer(root);
    expect(container).not.toBeNull();
    expect(strategy).toBe('scroller');
    expect(container?.id).toBe('thread-scroll');
  });

  it('does not pick the left-hand conversation list as the message container', () => {
    const root = mount({
      withSidebar: true,
      bubbles: [{ text: 'Nội dung', direction: 'incoming' }],
    });
    const { container } = findConversationContainer(root);
    expect(container?.id).toBe('thread-scroll');
    expect(container?.id).not.toBe('left-rail');
  });

  it('locates the composer', () => {
    const root = mount();
    expect(findComposer(root)).not.toBeNull();
  });

  it('extracts the rendered messages in order', () => {
    const root = mount({
      bubbles: [
        { text: 'Chào bạn, hôm nay bạn khỏe không?', direction: 'incoming' },
        { text: 'Khỏe, cảm ơn bạn.', direction: 'outgoing' },
        { text: 'Bạn bận đến mấy giờ?', direction: 'incoming' },
      ],
    });
    const result = extractConversation({ root });
    expect(result.unsupported).toBe(false);
    expect(result.status).toBe('ok');
    expect(result.messages.map((m) => m.text)).toEqual([
      'Chào bạn, hôm nay bạn khỏe không?',
      'Khỏe, cảm ơn bạn.',
      'Bạn bận đến mấy giờ?',
    ]);
  });

  it('infers incoming and outgoing from geometry', () => {
    const root = mount({
      bubbles: [
        { text: 'tôi vào', direction: 'incoming' },
        { text: 'tôi ra', direction: 'outgoing' },
      ],
    });
    const result = extractConversation({ root });
    expect(result.messages[0].direction).toBe('incoming');
    expect(result.messages[1].direction).toBe('outgoing');
    expect(result.messages[0].directionIsHeuristic).toBe(true);
  });

  it('preserves Vietnamese diacritics and emoji', () => {
    const text = 'Tôi nghĩ chúng ta nên đặt lịch ở quán cà phê gần nhà 👋';
    const root = mount({ bubbles: [{ text, direction: 'incoming' }] });
    const result = extractConversation({ root });
    expect(result.messages[0].text).toBe(text);
  });

  it('keeps multiline messages', () => {
    const root = mount({ bubbles: [{ text: 'dòng một\ndòng hai', direction: 'incoming' }] });
    const result = extractConversation({ root });
    expect(result.messages[0].text).toContain('dòng một');
    expect(result.messages[0].text).toContain('dòng hai');
  });

  it('reports a count of candidates, parsed and rejected rows', () => {
    const root = mount({
      bubbles: [
        { text: 'một', direction: 'incoming' },
        { text: 'hai', direction: 'outgoing' },
      ],
    });
    const result = extractConversation({ root });
    expect(result.candidates).toBe(2);
    expect(result.parsed).toBe(2);
    expect(result.rejected).toBe(0);
  });

  it('detects the conversation title from the header', () => {
    const root = mount({ title: 'Trần Thị B' });
    const result = extractConversation({ root });
    expect(result.conversation.label).toBe('Trần Thị B');
  });

  it('reports no-container when the thread cannot be found', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div>không có tin nhắn ở đây</div>';
    document.body.appendChild(root);
    const result = extractConversation({ root });
    expect(result.unsupported).toBe(true);
    expect(result.status).toBe('no-container');
    expect(result.messages).toHaveLength(0);
  });

  it('reports all-rejected when rows exist but carry no readable text', () => {
    const root = mount({ bubbles: [] });
    // Add a row whose only content is a button (UI chrome).
    const scroll = root.querySelector('#thread-scroll')!;
    const row = document.createElement('div');
    row.className = 'msg-row in';
    const btn = document.createElement('button');
    btn.textContent = 'Chỉnh sửa';
    row.appendChild(btn);
    scroll.appendChild(row);
    restubModernLayout(root);

    const result = extractConversation({ root });
    expect(result.status).toBe('all-rejected');
    expect(result.messages).toHaveLength(0);
    expect(result.warning).toBeTruthy();
  });

  it('ignores the chat-list previews in the sidebar', () => {
    const root = mount({
      withSidebar: true,
      bubbles: [{ text: 'Tin nhắn thật', direction: 'incoming' }],
    });
    const result = extractConversation({ root });
    const texts = result.messages.map((m) => m.text);
    expect(texts).toContain('Tin nhắn thật');
    expect(texts.some((t) => t.includes('Trần Thị B'))).toBe(false);
  });

  it('does not read the composer placeholder as a message', () => {
    const root = mount({ bubbles: [{ text: 'Tin nhắn thật', direction: 'incoming' }] });
    const result = extractConversation({ root });
    expect(result.messages.map((m) => m.text)).not.toContain('Enter để gửi');
  });

  it('detects a newly appended message', () => {
    const root = mount({ bubbles: [{ text: 'Câu đầu', direction: 'incoming' }] });
    expect(extractConversation({ root }).messages).toHaveLength(1);

    appendModernRow(root, { text: 'Câu mới', direction: 'incoming', id: 'm2' });
    restubModernLayout(root);

    const result = extractConversation({ root });
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1].text).toBe('Câu mới');
  });

  it('handles a removed message without failing', () => {
    const root = mount({
      bubbles: [
        { text: 'giữ lại', direction: 'incoming', id: 'm1' },
        { text: 'bị xoá', direction: 'incoming', id: 'm2' },
      ],
    });
    removeModernRow(root, 'm2');
    restubModernLayout(root);
    const result = extractConversation({ root });
    expect(result.messages.map((m) => m.text)).toEqual(['giữ lại']);
  });

  it('extracts only the rendered rows of a virtualized list', () => {
    const bubbles = Array.from({ length: 20 }, (_, i) => ({
      text: `tin ${i}`,
      direction: (i % 2 === 0 ? 'incoming' : 'outgoing') as 'incoming' | 'outgoing',
      id: `m${i}`,
    }));
    const root = mount({ bubbles, virtualized: 5 });
    const result = extractConversation({ root });
    // The adapter must not claim the whole history.
    expect(result.messages).toHaveLength(5);
    expect(result.messages.map((m) => m.text)).toEqual(['tin 15', 'tin 16', 'tin 17', 'tin 18', 'tin 19']);
  });

  it('keeps three identical messages distinct', () => {
    const root = mount({
      bubbles: [
        { text: 'OK', direction: 'incoming' },
        { text: 'OK', direction: 'incoming' },
        { text: 'OK', direction: 'outgoing' },
      ],
    });
    const result = extractConversation({ root });
    expect(result.messages).toHaveLength(3);
  });

  it('reads a visible timestamp', () => {
    const root = mount({ bubbles: [{ text: 'x', direction: 'incoming', time: '10:30' }] });
    const result = extractConversation({ root });
    expect(result.messages[0].timestamp).toBe('10:30');
  });
});
