/**
 * A synthetic fixture for a modern Messenger-like layout. Live compatibility
 * must be checked separately against an authorized rendered conversation.
 *
 * The important differences from the older `dom-harness` fixture:
 *   - the thread is a plain scrolling div, not `role="list"`,
 *   - rows are NOT `role="listitem"`,
 *   - every message is wrapped in a chain of nested divs,
 *   - incoming and outgoing bubbles differ by alignment, not by a class,
 *   - the composer is a `contenteditable` div,
 *   - the header title is a plain div, not a heading element.
 *
 * Only sanitized, synthetic text is used. No private conversation content.
 */

export interface ModernBubbleSpec {
  text: string;
  direction: 'incoming' | 'outgoing';
  /** Optional stable id, as Messenger's data-message-id attribute. */
  id?: string;
  time?: string;
  /** Render the bubble as a sticker/emoji-only attachment. */
  sticker?: boolean;
}

export interface ModernFixtureOptions {
  title?: string;
  bubbles?: ModernBubbleSpec[];
  /** Include the left-hand conversation list. */
  withSidebar?: boolean;
  /** Include the composer (required for the modern detection path). */
  withComposer?: boolean;
  /** Simulate Messenger's virtualized list: only the last N rows are rendered. */
  virtualized?: number;
}

const SIDEBAR_NAMES = ['Trần Thị B', 'Lê Văn C', 'Phạm Thị D'];
const scrollInitialized = new WeakSet<HTMLElement>();

export function buildModernMessengerDom(options: ModernFixtureOptions = {}): HTMLElement {
  const {
    title = 'Nguyễn Văn A',
    bubbles = [],
    withSidebar = true,
    withComposer = true,
    virtualized,
  } = options;

  const root = document.createElement('div');
  root.id = 'app-root';

  const style = document.createElement('style');
  style.textContent = `
    #app-root { display: flex; height: 100vh; }
    #left-rail { width: 360px; overflow-y: auto; }
    #thread { flex: 1; display: flex; flex-direction: column; }
    #thread-header { height: 60px; }
    #thread-scroll { flex: 1; overflow-y: auto; }
    .msg-row { display: flex; margin: 2px 0; }
    .msg-row.out { justify-content: flex-end; }
    .msg-bubble { max-width: 60%; padding: 8px 12px; border-radius: 16px; }
    .msg-row.in .msg-bubble { background: #eee; }
    .msg-row.out .msg-bubble { background: #d8e7ff; }
    .msg-time { font-size: 11px; }
  `;
  root.appendChild(style);

  if (withSidebar) {
    const rail = document.createElement('div');
    rail.id = 'left-rail';
    for (const name of SIDEBAR_NAMES) {
      const item = document.createElement('div');
      item.className = 'chat-list-item';
      const nameEl = document.createElement('span');
      nameEl.textContent = name;
      item.appendChild(nameEl);
      const preview = document.createElement('span');
      preview.textContent = 'Xin chào, bạn khỏe không?';
      item.appendChild(preview);
      rail.appendChild(item);
    }
    root.appendChild(rail);
  }

  const thread = document.createElement('div');
  thread.id = 'thread';

  const header = document.createElement('div');
  header.id = 'thread-header';
  const titleEl = document.createElement('div');
  titleEl.id = 'thread-title';
  titleEl.setAttribute('aria-label', title);
  titleEl.textContent = title;
  header.appendChild(titleEl);
  thread.appendChild(header);

  const scroll = document.createElement('div');
  scroll.id = 'thread-scroll';
  thread.appendChild(scroll);

  const rendered = virtualized ? bubbles.slice(-virtualized) : bubbles;
  for (const spec of rendered) {
    scroll.appendChild(buildModernRow(spec));
  }

  if (withComposer) {
    const composer = document.createElement('div');
    composer.id = 'composer';
    const input = document.createElement('div');
    input.setAttribute('contenteditable', 'true');
    input.setAttribute('role', 'textbox');
    input.setAttribute('aria-label', 'Nhắn tin');
    input.setAttribute('aria-placeholder', 'Enter để gửi');
    composer.appendChild(input);
    thread.appendChild(composer);
  }

  root.appendChild(thread);
  return root;
}

export function buildModernRow(spec: ModernBubbleSpec): HTMLElement {
  // row -> wrapper -> bubble -> text, mimicking Messenger's nesting depth.
  const row = document.createElement('div');
  row.className = `msg-row ${spec.direction === 'outgoing' ? 'out' : 'in'}`;
  if (spec.id) row.setAttribute('data-message-id', spec.id);

  const wrapper = document.createElement('div');
  wrapper.className = 'msg-wrapper';

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';

  if (spec.sticker) {
    const img = document.createElement('img');
    img.setAttribute('alt', 'sticker');
    bubble.appendChild(img);
  } else {
    const text = document.createElement('span');
    text.setAttribute('dir', 'auto');
    text.textContent = spec.text;
    bubble.appendChild(text);
  }

  if (spec.time) {
    const time = document.createElement('span');
    time.className = 'msg-time';
    time.setAttribute('title', spec.time);
    time.textContent = spec.time;
    bubble.appendChild(time);
  }

  wrapper.appendChild(bubble);
  row.appendChild(wrapper);
  return row;
}

/** Appends a rendered message to the thread scroller. */
export function appendModernRow(root: HTMLElement, spec: ModernBubbleSpec): HTMLElement {
  const scroll = root.querySelector('#thread-scroll')!;
  const row = buildModernRow(spec);
  scroll.appendChild(row);
  return row;
}

/** Removes a rendered message by its data-message-id. */
export function removeModernRow(root: HTMLElement, id: string): void {
  root.querySelector(`[data-message-id="${id}"]`)?.remove();
}

/**
 * Gives every element a measurable box, because jsdom performs no layout.
 *
 * The geometry mirrors the real layout: the thread occupies the right half of
 * the window, incoming bubbles hug the left, outgoing hug the right.
 */
export function stubModernLayout(root: HTMLElement): void {
  const box = (el: Element | null, left: number, top: number, width: number, height: number) => {
    if (el) Object.defineProperty(el, 'getBoundingClientRect', { configurable: true,
      value: () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }) });
  };
  box(root, 0, 0, 1400, 800);
  box(root.querySelector('#thread-header'), 360, 0, 1040, 60);
  box(root.querySelector('#thread-title'), 380, 10, 300, 40);
  box(root.querySelector('#composer'), 360, 720, 1040, 80);
  box(root.querySelector('[contenteditable="true"]'), 400, 730, 900, 40);
  const rail = root.querySelector('#left-rail') as HTMLElement | null;
  if (rail) {
    Object.defineProperty(rail, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, right: 360, top: 0, bottom: 800, width: 360, height: 800, x: 0, y: 0 }),
    });
  }

  const thread = root.querySelector('#thread') as HTMLElement | null;
  if (thread) {
    Object.defineProperty(thread, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 360, right: 1400, top: 0, bottom: 800, width: 1040, height: 800, x: 360, y: 0 }),
    });
  }

  const scroll = root.querySelector('#thread-scroll') as HTMLElement | null;
  if (scroll) {
    Object.defineProperty(scroll, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 360, right: 1400, top: 60, bottom: 720, width: 1040, height: 660, x: 360, y: 60 }),
    });
    // Pretend the thread is scrollable so the adapter sees it as such.
    Object.defineProperty(scroll, 'scrollHeight', { configurable: true, value: 2000 });
    Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 660 });
    if (!scrollInitialized.has(scroll)) { scroll.scrollTop = 1340; scrollInitialized.add(scroll); }
  }

  let top = 100;
  for (const row of root.querySelectorAll<HTMLElement>('.msg-row')) {
    const outgoing = row.classList.contains('out');
    const left = outgoing ? 1000 : 400;
    const y = top;
    top += 48;
    Object.defineProperty(row, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 360, right: 1400, top: y, bottom: y + 40, width: 1040, height: 40, x: 360, y }),
    });
    const wrapper = row.querySelector<HTMLElement>('.msg-wrapper');
    if (wrapper) {
      Object.defineProperty(wrapper, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ left, right: left + 300, top: y, bottom: y + 40, width: 300, height: 40, x: left, y }),
      });
    }
    const bubble = row.querySelector<HTMLElement>('.msg-bubble');
    if (bubble) {
      Object.defineProperty(bubble, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ left, right: left + 300, top: y, bottom: y + 40, width: 300, height: 40, x: left, y }),
      });
      box(bubble.querySelector('[dir="auto"]'), left + 12, y + 4, 276, 24);
      box(bubble.querySelector('.msg-time'), left + 240, y + 26, 48, 12);
    }
  }
}

/** Re-stubs the bubble geometry after rows were added or removed. */
export function restubModernLayout(root: HTMLElement): void {
  stubModernLayout(root);
}
