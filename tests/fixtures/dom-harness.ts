/**
 * Test helpers that build a synthetic Messenger-like DOM.
 *
 * The fixtures deliberately avoid Facebook's real class names so the adapter
 * is exercised against the structural signals it actually relies on.
 */

export interface BubbleSpec {
  text: string;
  direction: 'incoming' | 'outgoing' | 'unknown';
  id?: string;
  time?: string;
}

export interface FixtureOptions {
  title?: string;
  bubbles?: BubbleSpec[];
  /** Include the left-hand chat list so the adapter must not pick it up. */
  withSidebar?: boolean;
  /** Omit the composer, which should make the adapter less confident. */
  withoutComposer?: boolean;
  /** Use light or dark visual styling. */
  theme?: 'light' | 'dark';
}

export function buildMessengerDom(options: FixtureOptions = {}): HTMLElement {
  const {
    title = 'Nguyễn Văn A',
    bubbles = [],
    withSidebar = true,
    withoutComposer = false,
    theme = 'light',
  } = options;

  const root = document.createElement('div');
  root.id = 'app';

  const style = document.createElement('style');
  style.textContent = `
    #app { display: flex; }
    #chat { flex: 1; }
    .bubble { max-width: 60%; padding: 8px; }
    .bubble.incoming { background: ${theme === 'dark' ? '#2a2f36' : '#eee'}; margin-right: auto; }
    .bubble.outgoing { background: ${theme === 'dark' ? '#1f3a5f' : '#d8e7ff'}; margin-left: auto; }
    .bubble.unknown { background: #ccc; }
  `;
  root.appendChild(style);

  if (withSidebar) {
    const sidebar = document.createElement('div');
    sidebar.id = 'sidebar';
    sidebar.setAttribute('role', 'list');
    sidebar.setAttribute('aria-label', 'Danh sách trò chuyện');
    for (const name of ['Trần Thị B', 'Lê Văn C']) {
      const item = document.createElement('div');
      item.setAttribute('role', 'listitem');
      item.textContent = name;
      sidebar.appendChild(item);
    }
    root.appendChild(sidebar);
  }

  const chat = document.createElement('div');
  chat.id = 'chat';
  chat.setAttribute('role', 'main');

  const header = document.createElement('div');
  header.setAttribute('role', 'banner');
  const heading = document.createElement('h2');
  heading.id = 'thread-title';
  heading.textContent = title;
  header.appendChild(heading);
  chat.appendChild(header);

  const list = document.createElement('div');
  list.id = 'message-list';
  list.setAttribute('role', 'list');
  list.setAttribute('aria-label', 'Tin nhắn');

  bubbles.forEach((b, i) => {
    const item = document.createElement('div');
    item.setAttribute('role', 'listitem');
    item.className = `bubble ${b.direction}`;
    if (b.id) item.setAttribute('data-message-id', b.id);
    const span = document.createElement('span');
    span.setAttribute('dir', 'auto');
    span.textContent = b.text;
    item.appendChild(span);
    if (b.time) {
      const t = document.createElement('span');
      t.setAttribute('title', b.time);
      t.textContent = b.time;
      item.appendChild(t);
    }
    list.appendChild(item);
    void i;
  });

  chat.appendChild(list);

  if (!withoutComposer) {
    const composer = document.createElement('div');
    composer.id = 'composer';
    const input = document.createElement('div');
    input.setAttribute('contenteditable', 'true');
    input.setAttribute('role', 'textbox');
    input.setAttribute('aria-label', 'Nhắn tin');
    input.textContent = 'Enter để gửi';
    composer.appendChild(input);
    chat.appendChild(composer);
  }

  root.appendChild(chat);
  return root;
}

/** Appends a bubble to an existing fixture list. */
export function appendBubble(root: HTMLElement, spec: BubbleSpec): HTMLElement {
  const list = root.querySelector('#message-list')!;
  const item = document.createElement('div');
  item.setAttribute('role', 'listitem');
  item.className = `bubble ${spec.direction}`;
  if (spec.id) item.setAttribute('data-message-id', spec.id);
  const span = document.createElement('span');
  span.setAttribute('dir', 'auto');
  span.textContent = spec.text;
  item.appendChild(span);
  if (spec.time) {
    const t = document.createElement('span');
    t.setAttribute('title', spec.time);
    t.textContent = spec.time;
    item.appendChild(t);
  }
  list.appendChild(item);
  return item;
}

/** Removes the bubble with the given DOM id. */
export function removeBubble(root: HTMLElement, id: string): void {
  const list = root.querySelector('#message-list')!;
  list.querySelector(`[data-message-id="${id}"]`)?.remove();
}

/**
 * Stubs getBoundingClientRect so direction inference works in jsdom, which
 * performs no layout.
 */
export function stubLayout(root: HTMLElement): void {
  const input = root.querySelector('[contenteditable="true"]');
  if (input) Object.defineProperty(input, 'getBoundingClientRect', { configurable: true,
    value: () => ({ left: 0, top: 610, right: 600, bottom: 650, width: 600, height: 40, x: 0, y: 610 }) });
  root.querySelectorAll('h2, [role="banner"], [role="main"]').forEach((el) => {
    Object.defineProperty(el, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, right: 600, top: 0, bottom: 40, width: 600, height: 40, x: 0, y: 0 }),
    });
  });
  const list = root.querySelector('[role="list"][aria-label="Tin nhắn"]') as HTMLElement;
  Object.defineProperty(list, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 0, right: 600, top: 0, bottom: 600, width: 600, height: 600, x: 0, y: 0 }),
  });

  list.querySelectorAll('[role="listitem"]').forEach((item) => {
    const outgoing = item.classList.contains('outgoing');
    const left = outgoing ? 320 : 10;
    Object.defineProperty(item, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left,
        right: left + 270,
        top: 0,
        bottom: 40,
        width: 270,
        height: 40,
        x: left,
        y: 0,
      }),
    });
  });
}

/** Re-stubs layout after bubbles were added or removed. */
export function restubLayout(root: HTMLElement): void {
  const list = root.querySelector('#message-list') as HTMLElement;
  list.querySelectorAll('[role="listitem"]').forEach((item) => {
    const outgoing = item.classList.contains('outgoing');
    const left = outgoing ? 320 : 10;
    Object.defineProperty(item, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left,
        right: left + 270,
        top: 0,
        bottom: 40,
        width: 270,
        height: 40,
        x: left,
        y: 0,
      }),
    });
  });
}
