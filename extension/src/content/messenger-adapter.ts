/**
 * Messenger DOM adapter, version 2.
 *
 * Version 1 anchored the extraction on `role="list"` / `role="listitem"`, which
 * matched the synthetic fixtures but not the current Messenger web UI, where
 * the message thread is a plain scrolling div and rows carry no ARIA list
 * roles. That mismatch is why the side panel reported "no conversation".
 *
 * Version 2 is driven by geometry and structure instead of ARIA roles:
 *
 *   1. locate the composer (`contenteditable` / `textarea`) — the one element
 *      Messenger always renders for the selected conversation,
 *   2. derive the chat pane that owns the composer,
 *   3. find the scrolling region inside that pane that holds the messages,
 *   4. find the "row level" inside that region: the DOM depth at which each
 *      child contains exactly one bubble's text,
 *   5. read each row's text by walking its text nodes and skipping known UI
 *      chrome (buttons, avatars, reactions, timestamps, menus),
 *   6. infer direction from the bubble's horizontal position, and report
 *      `unknown` rather than guessing when the geometry is inconclusive.
 *
 * The legacy `role="list"` search is kept as a fallback so existing fixtures
 * and any Messenger build that still exposes list roles keep working.
 *
 * The adapter never touches `document.body.innerText`, never leaves the
 * selected conversation's pane, and never sends anything.
 */
import { parseBubble, keepMeaningful, orderBubbles, type RawBubble } from './message-parser';
import type { ConversationInfo, ExtractedConversation, ExtractionStrategy, SenderDirection } from '../core/models';

export const ADAPTER_VERSION = '2.2.1';
const renderIds = new WeakMap<Element, string>();
const visibilityCaches = new WeakMap<WeakMap<Element, CSSStyleDeclaration>, WeakMap<Element, boolean>>();
let nextRenderId = 0;
function renderIdOf(el: Element): string {
  let id = renderIds.get(el);
  if (!id) { id = `render:${++nextRenderId}`; renderIds.set(el, id); }
  return id;
}

export function threadKeyFromUrl(url: string): string | null {
  const parsed = new URL(url);
  const id = parsed.pathname.match(/\/messages\/(?:e2ee\/)?t\/([^/?#]+)/)?.[1]
    ?? parsed.pathname.match(/\/messages\/inbox\/([^/?#]+)/)?.[1]
    ?? parsed.searchParams.get('id') ?? parsed.searchParams.get('thread');
  return id ? `thread:${id}` : null;
}

/** The log may wrap the actual scrolling element, as on the observed live DOM. */
function isAtBottom(container: HTMLElement): boolean {
  const bounds = container.getBoundingClientRect();
  const scrollers = [container, ...container.querySelectorAll<HTMLElement>('div, section')]
    .filter(el => {
      if (el.scrollHeight <= el.clientHeight + 1) return false;
      const r = el.getBoundingClientRect();
      return r.width >= bounds.width * .7 && r.height >= bounds.height * .5 && /^(auto|scroll|overlay)$/.test(getComputedStyle(el).overflowY);
    });
  const scroller = scrollers[0] ?? container;
  return scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= Math.max(24, scroller.clientHeight * .03);
}

function absoluteTimestamp(row: Element): number | null {
  const datetime = row.querySelector('time[datetime]')?.getAttribute('datetime') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(datetime)) return null;
  const parsed = Date.parse(datetime);
  return Number.isFinite(parsed) ? parsed : null;
}

const TIME_PATTERN =
  /^\s*(?:\d{1,2}:\d{2}\s*(?:[AaPp]\.?[Mm]\.?)?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|(?:Thứ|Sảng|Chủ)?\s*\w{3,9}\s*(?:lúc)?\s*\d{1,2}:\d{2})\s*$/;

const MESSAGE_LIST_NAMES = [
  /^tin nhắn$/i,
  /^messages$/i,
  /^cuộc trò chuyện$/i,
  /^conversation$/i,
  /message list/i,
];

const NON_MESSAGE_LIST_NAMES = [
  /^conversations$/i,
  /^danh sách trò chuyện$/i,
  /^chat list/i,
];

/** Rows that are separators, not messages. */
const SEPARATOR_PATTERN =
  /^(?:hôm nay|ngày hôm nay|hôm qua|đêm qua|yesterday|today|hôm kia|the day before yesterday|lúc \d{1,2}:\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)$/i;

/** Chrome that must never contribute text to a bubble. */
const CHROME_TAGS = new Set(['BUTTON', 'SVG', 'STYLE', 'SCRIPT', 'NOSCRIPT', 'H1', 'H2', 'H3', 'H4', 'NAV', 'INPUT', 'TEXTAREA', 'VIDEO', 'CANVAS']);
const CHROME_ROLES = new Set(['button', 'menuitem', 'menu', 'img', 'tab', 'heading', 'toolbar', 'status', 'tooltip']);
function chromeElement(el: Element): boolean {
  if (CHROME_TAGS.has(el.tagName.toUpperCase()) || CHROME_ROLES.has(el.getAttribute('role') ?? '')) return true;
  const preview = el.getAttribute('data-ad-comet-preview');
  return el.getAttribute('aria-hidden') === 'true' || el.getAttribute('contenteditable') === 'true' ||
    el.getAttribute('data-ad-rendering-role') === 'profile_name' || preview === 'reaction' || preview === 'image' ||
    /reaction|phản ứng|cảm xúc/i.test(el.getAttribute('aria-label') ?? '');
}

export interface AdapterOptions {
  /** Overrides the default root; used by tests with fixtures. */
  root?: Document | Element;
}

/** True for elements that are visually hidden and should not be read. */
function hiddenStyle(el: Element, styles: WeakMap<Element, CSSStyleDeclaration>): boolean {
  let cache = visibilityCaches.get(styles);
  if (!cache) { cache = new WeakMap(); visibilityCaches.set(styles, cache); }
  const known = cache.get(el);
  if (known !== undefined) return known;
  const style = styles.get(el) ?? window.getComputedStyle(el);
  styles.set(el, style);
  const hidden = el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true' ||
    style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' ||
    style.clipPath === 'inset(50%)' || /^rect\(0px,?\s*0px,?\s*0px,?\s*0px\)$/.test(style.clip) ||
    (el.parentElement !== null && hiddenStyle(el.parentElement, styles));
  cache.set(el, hidden);
  return hidden;
}

function isHidden(el: Element, styles = new WeakMap<Element, CSSStyleDeclaration>()): boolean {
  if (hiddenStyle(el, styles)) return true;
  const rect = el.getBoundingClientRect();
  // Zero-size boxes are non-interactive scaffolding (spacers, sentinels).
  if (rect.width === 0 && rect.height === 0) return true;
  return false;
}

/** All visible composers on the page. Zero or several are ambiguous. */
export function findComposers(root: Document | Element, styles = new WeakMap<Element, CSSStyleDeclaration>()): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>('[contenteditable="true"], textarea:not([hidden])'),
  ).filter((el) => !isHidden(el, styles) && !el.matches(':disabled, [readonly], [aria-disabled="true"]') &&
    !el.closest('[inert], nav, [role="navigation"], [role="search"]') &&
    !el.parentElement?.closest('[contenteditable="true"]'));
}

/** The composer Messenger renders for the conversation the user selected. */
export function findComposer(root: Document | Element, styles = new WeakMap<Element, CSSStyleDeclaration>()): HTMLElement | null {
  const candidates = findComposers(root, styles);
  // Multiple visible composers are ambiguous. Never choose a zero-size fallback.
  return candidates.length === 1 ? candidates[0]! : null;
}

/**
 * The pane that owns the composer: the nearest ancestor that also contains
 * the message thread. Messenger nests the thread several divs deep, so the
 * pane is the top-most ancestor below the app root.
 */
function regionCandidate(el: HTMLElement, composer: HTMLElement, styles: WeakMap<Element, CSSStyleDeclaration>): boolean {
  if (el.contains(composer) || el.closest('nav, [role="navigation"], [role="complementary"]')) return false;
  const aria = el.getAttribute('aria-label') ?? '';
  if (NON_MESSAGE_LIST_NAMES.some(re => re.test(aria))) return false;
  const style = styles.get(el) ?? window.getComputedStyle(el);
  styles.set(el, style);
  const semantic = el.matches('[role="log"], [role="grid"]') ||
    (el.getAttribute('role') === 'list' && MESSAGE_LIST_NAMES.some(re => re.test(aria)));
  if (!semantic && !/^(?:auto|scroll|overlay)$/.test(style.overflowY)) return false;
  if (isHidden(el, styles)) return false;
  const rect = el.getBoundingClientRect();
  const input = composer.getBoundingClientRect();
  const overlap = Math.min(rect.right, input.right) - Math.max(rect.left, input.left);
  return rect.width >= 120 && rect.height >= 60 && rect.top < input.top &&
    rect.bottom <= input.top + 16 && overlap >= Math.min(rect.width, input.width) * 0.6;
}

function findChatPane(composer: HTMLElement | null, root: Document | Element, styles: WeakMap<Element, CSSStyleDeclaration>): HTMLElement | null {
  if (!composer) return null;
  for (let pane = composer.parentElement; pane && pane !== document.body && pane !== document.documentElement; pane = pane.parentElement) {
    // The nearest shared parent wins. Do not climb to the app root merely
    // because it is wide, or search the document when no composer was found.
    if (Array.from(pane.querySelectorAll<HTMLElement>('div, section, main, [role="list"], [role="log"], [role="grid"]'))
      .some(el => regionCandidate(el, composer, styles))) return pane;
    if (pane === root) break;
  }
  return null;
}

/**
 * Finds the scrolling region that holds the rendered messages.
 *
 * Scores candidates by: being inside the chat pane, being scrollable, and
 * containing text that is not part of the chat list.
 */
function findScrollableRegion(
  pane: HTMLElement | null,
  styles: WeakMap<Element, CSSStyleDeclaration>,
  composer: HTMLElement | null,
): HTMLElement | null {
  if (!pane || !composer) return null;
  const candidates: { el: HTMLElement; score: number }[] = [];

  for (const el of Array.from(pane.querySelectorAll<HTMLElement>('div, section, main, [role="log"], [role="grid"]'))) {
    if (!regionCandidate(el, composer, styles)) continue;
    // Legacy lists have their own unambiguous strategy below.
    if (el.getAttribute('role') === 'list') continue;
    let score = 40;
    if (el.scrollHeight > el.clientHeight) score += 15;
    if (el.matches('[role="log"], [role="grid"]')) score += 20;
    const leafCount = countTextLeaves(el, styles).length;
    if (leafCount >= 2) score += 20;

    candidates.push({ el, score });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  let best = candidates[0]!;
  for (const candidate of candidates.slice(1).filter(c => c.score === best.score)) {
    if (best.el.contains(candidate.el)) best = candidate;
    else if (!candidate.el.contains(best.el)) return null;
  }
  return best.el;
}

/**
 * Elements that carry the text of a bubble: they have their own text content
 * and contain no other such element.
 *
 * Images are not counted, so a row that also holds an avatar still counts as
 * a single text leaf.
 */
function timestampElement(el: Element): boolean {
  return el.tagName === 'TIME' || (!el.hasAttribute('dir') && el.children.length === 0 &&
    TIME_PATTERN.test(el.getAttribute('title') ?? '') && TIME_PATTERN.test((el.textContent ?? '').trim()));
}

function countTextLeaves(scope: Element, styles: WeakMap<Element, CSSStyleDeclaration>): HTMLElement[] {
  const leaves: HTMLElement[] = [];
  const walk = (el: Element): void => {
    if (chromeElement(el) || timestampElement(el) || hiddenStyle(el, styles)) return;
    const hasOwnText = Array.from(el.childNodes).some(
      (n) => n.nodeType === Node.TEXT_NODE && (n.nodeValue ?? '').trim().length > 0,
    );
    if (hasOwnText) {
      leaves.push(el as HTMLElement);
      return;
    }
    for (const child of el.children) walk(child);
  };
  for (const child of scope.children) walk(child);
  return leaves;
}

/**
 * Finds the DOM depth at which each child holds exactly one bubble.
 *
 * Messenger wraps every message in a chain of nested divs, so the "row" is
 * not at a fixed level. The rule: descend while some child still holds more
 * than one text leaf (that child is a group of bubbles, not one bubble);
 * stop at the first level whose children each hold at most one text leaf.
 *
 * A list that exposes `role="listitem"` is used directly — that is
 * unambiguous.
 */
function findRowLevel(container: HTMLElement, styles: WeakMap<Element, CSSStyleDeclaration>): { level: Element; rows: Element[] } {
  const role = container.matches('[role="grid"]') ? 'row' : 'listitem';
  const listItems = Array.from(container.querySelectorAll<HTMLElement>(`[role="${role}"]`))
    .filter(el => !el.parentElement?.closest(`[role="${role}"]`));
  if (listItems.length > 0) return { level: container, rows: listItems };

  let level: Element = container;

  for (let depth = 0; depth < 14; depth += 1) {
    const children = Array.from(level.children).filter((c) => {
      if (c.matches('style, script, noscript')) return false;
      const rect = c.getBoundingClientRect();
      return rect.width > 0 || rect.height > 0;
    });
    if (children.length === 0) return { level, rows: [] };

    const leavesPerChild = children.map((c) => countTextLeaves(c, styles).length);

    // Every child holds at most one bubble's text: this is the row level.
    if (leavesPerChild.every((n) => n <= 1) || leavesPerChild.filter(n => n > 0).length > 1) return { level, rows: children };

    // Otherwise descend into the first child that holds several bubbles.
    const groupedIndex = leavesPerChild.findIndex((n) => n > 1);
    if (groupedIndex === -1) return { level, rows: children };
    const grouped = children[groupedIndex]!;
    const anchors = Array.from(grouped.querySelectorAll('[dir="auto"], [data-ad-comet-preview="message"], [data-testid="message_text"]'))
      .filter(el => !el.parentElement?.closest('[dir="auto"], [data-ad-comet-preview="message"], [data-testid="message_text"]'));
    if (grouped.matches('[data-message-id], [data-mid], [role="row"]') || anchors.length === 1) return { level, rows: children };
    level = grouped;
  }

  return { level, rows: Array.from(level.children) };
}

/**
 * Collects the readable text of a row, skipping UI chrome.
 *
 * Also reports the element that carries the message text, because that is
 * what the direction heuristic must measure — the row wrapper is usually
 * full-width and says nothing about which side the bubble is on.
 */
function readRowText(row: Element, styles: WeakMap<Element, CSSStyleDeclaration>): { text: string; textEl: HTMLElement | null } {
  const parts: string[] = [];
  let textEl: HTMLElement | null = null;

  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.nodeValue ?? '';
      if (value.trim().length > 0) parts.push(value);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (hiddenStyle(el, styles)) return;
    if (el.tagName === 'IMG') {
      const alt = el.getAttribute('alt') ?? '';
      if (/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(alt)) parts.push(alt);
      return;
    }
    if (chromeElement(el)) return;
    if (el.tagName === 'BR') {
      parts.push('\n');
      return;
    }
    if (timestampElement(el)) return;

    const before = parts.length;
    for (const child of el.childNodes) walk(child);
    if (parts.length > before && textEl === null) {
      const hasOwnText = Array.from(el.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && (n.nodeValue ?? '').trim().length > 0,
      );
      if (hasOwnText) textEl = el;
    }
    const block = /^(?:DIV|P|LI|SECTION)$/.test(el.tagName);
    if (block && parts.length > before) parts.push('\n');
  };

  // A Messenger row also contains delivery labels and accessibility summaries.
  // Prefer the message payload; do not concatenate the whole row around it.
  const payloadSelector = '[data-ad-comet-preview="message"], [data-ad-preview="message"], [data-testid="message_text"]';
  const direct = row.children.length === 1 && row.firstElementChild?.getAttribute('dir') === 'auto' ? row.firstElementChild as HTMLElement : null;
  let anchors = direct ? [direct] : Array.from(row.querySelectorAll<HTMLElement>(payloadSelector));
  if (!anchors.length) anchors = Array.from(row.querySelectorAll<HTMLElement>('[dir="auto"]'));
  anchors = anchors.filter(el => {
    for (let node: Element | null = el; node && node !== row; node = node.parentElement) if (chromeElement(node)) return false;
    return !hiddenStyle(el, styles);
  });
  const anchorSet = new Set<Element>(anchors);
  anchors = anchors.filter(el => {
    for (let p = el.parentElement; p && p !== row; p = p.parentElement) if (anchorSet.has(p)) return false;
    return true;
  });
  if (anchors.length) for (const anchor of anchors) walk(anchor);
  else for (const child of row.childNodes) walk(child);
  if (!textEl) {
    const leaves = countTextLeaves(row, styles);
    textEl = leaves[0] ?? (row as HTMLElement);
  }
  return { text: parts.join(''), textEl };
}

/**
 * Legacy fallback: the `role="list"` message list used by older builds and by
 * the test fixtures. Scoped to the chat pane when one is known.
 */
export function findMessageList(
  root: Document | Element,
  styles = new WeakMap<Element, CSSStyleDeclaration>(),
): HTMLElement | null {
  const scope = root instanceof Document ? root : root;
  const lists = Array.from(scope.querySelectorAll<HTMLElement>('[role="list"]'));

  let best: { el: HTMLElement; score: number } | null = null;
  let ambiguous = false;

  for (const list of lists) {
    if (isHidden(list, styles)) continue;
    if (list.closest('nav, [role="navigation"], [role="complementary"]')) continue;

    const aria = list.getAttribute('aria-label') ?? '';
    if (NON_MESSAGE_LIST_NAMES.some((re) => re.test(aria))) continue;

    const items = list.querySelectorAll('[role="listitem"]');
    if (items.length === 0 && !MESSAGE_LIST_NAMES.some(re => re.test(aria))) continue;

    let score = 0;
    if (MESSAGE_LIST_NAMES.some((re) => re.test(aria))) score += 50;
    if (items.length > 1) score += 10;

    const pane = list.closest('[role="main"], [data-pagelet="ChatHome"], div');
    if (pane?.querySelector('[contenteditable="true"], textarea')) score += 25;

    let bubbleish = 0;
    for (const item of Array.from(items).slice(0, 5)) {
      if (item.querySelector('span[dir], div[dir], [data-ad-comet-preview]')) bubbleish += 1;
    }
    score += bubbleish * 3;

    if (!best || score > best.score) { best = { el: list, score }; ambiguous = false; }
    else if (score === best.score && !best.el.contains(list) && !list.contains(best.el)) ambiguous = true;
  }

  if (!best || best.score < 30 || ambiguous) return null;
  return best.el;
}

/**
 * Resolves the element that holds the rendered messages.
 *
 * Strategy 1 (preferred): the scrollable region inside the composer pane.
 * Strategy 2 (fallback): the legacy ARIA message list.
 */
export function findConversationContainer(
  root: Document | Element,
  styles = new WeakMap<Element, CSSStyleDeclaration>(),
): { container: HTMLElement | null; strategy: ExtractionStrategy } {
  const scope = root instanceof Document ? root : root;
  const composer = findComposer(scope, styles);
  const pane = findChatPane(composer, scope, styles);

  // Explicit regions are both stronger evidence and much cheaper than probing
  // computed overflow on every message wrapper in a large plain-div tree.
  if (pane && composer) {
    const logs = Array.from(pane.querySelectorAll<HTMLElement>('[role="log"], [role="grid"]'))
      .filter(el => regionCandidate(el, composer, styles));
    if (logs.length === 1) return { container: logs[0]!, strategy: 'semantic-log' };
    if (logs.length > 1) return { container: null, strategy: 'none' };
  }
  const list = findMessageList(pane ?? scope, styles);
  if (list) return { container: list, strategy: 'aria-list' };

  const scroller = findScrollableRegion(pane, styles, composer);
  if (scroller) return { container: scroller, strategy: scroller.matches('[role="log"], [role="grid"]') ? 'semantic-log' : 'scroller' };

  return { container: null, strategy: 'none' };
}

/** Header siblings above this exact thread column; never the sidebar or app banner. */
function findThreadHeader(container: HTMLElement | null, composer: HTMLElement | null, root: Document | Element): HTMLElement | null {
  if (!container) return null;
  const bounds = container.getBoundingClientRect();
  let child: Element = container;
  for (let parent = container.parentElement, depth = 0; parent && parent !== document.body && depth < 12; child = parent, parent = parent.parentElement, depth++) {
    for (const sibling of Array.from(parent.children)) {
      if (sibling === child || (composer && sibling.contains(composer)) || sibling.matches('nav, [role="navigation"], [role="complementary"]')) continue;
      const rect = sibling.getBoundingClientRect();
      const overlap = Math.min(rect.right, bounds.right) - Math.max(rect.left, bounds.left);
      if (rect.height > 8 && rect.bottom <= bounds.top + 8 && overlap >= Math.min(rect.width, bounds.width) * .7 &&
        sibling.querySelector('h1,h2,h3,[role="heading"],[aria-label],[dir="auto"]')) return sibling as HTMLElement;
    }
    if (parent === root) break;
  }
  return null;
}

/** Reads the conversation title from the chat header. */
export function detectConversation(
  root: Document | Element,
  styles = new WeakMap<Element, CSSStyleDeclaration>(),
  selectedList?: HTMLElement | null,
): ConversationInfo {
  const scope = root instanceof Document ? root : root;

  const list = selectedList === undefined ? findMessageList(scope, styles) : selectedList;
  const composer = findComposer(scope, styles);
  const legacyPane = list?.getAttribute('role') === 'list' ? list.closest<HTMLElement>('[role="main"], [data-pagelet="ChatHome"]') : null;
  const pane = legacyPane ?? findChatPane(composer, scope, styles) ?? scope;
  const headerScope = findThreadHeader(list, composer, scope);
  const titleScope = headerScope ?? pane;
  const headings = Array.from(titleScope.querySelectorAll<HTMLElement>('h1, h2, h3, [role="heading"]'));

  let label = '';
  for (const h of headings) {
    if (isHidden(h, styles) || h.closest('nav, [role="navigation"]')) continue;
    if (list && (list.contains(h) || h.contains(list))) continue;
    const text = (h.textContent ?? '').trim();
    if (!text || text.length > 80) continue;
    if (/\b(?:nhắn|message|chat)\b/i.test(text) && text.length > 25) continue;
    label = text;
    break;
  }

  if (!label && pane) {
    // The header title is frequently a plain div with an aria-label.
    const titled = Array.from(titleScope.querySelectorAll<HTMLElement>('[aria-label]')).find((el) => {
      if ((list && list.contains(el)) || el === composer || el.contains(composer) ||
        el.closest('button, [role="button"], [role="navigation"], [role="search"], [contenteditable="true"]') || isHidden(el, styles)) return false;
      const value = el.getAttribute('aria-label') ?? '';
      return value.length > 0 && value.length <= 60 && !/^(?:tin nhắn|messages?|chat|search|gửi|send)$/i.test(value);
    });
    if (titled) label = (titled.getAttribute('aria-label') ?? '').trim();
  }

  if (!label) {
    const header = headerScope ?? pane?.querySelector('[role="banner"], header');
    label = (header?.textContent ?? '').trim().split('\n')[0]?.trim() ?? '';
  }

  // Conversation identity: a stable thread id from the URL is preferred over a
  // display name, which is not unique.
  const url = scope instanceof Document ? scope.location?.href ?? null : null;
  const key = (url ? threadKeyFromUrl(url) : null) ?? `label:${label.normalize('NFC').toLowerCase().trim() || 'unknown'}`;

  return { key, label: label || 'Không rõ', url };
}

/**
 * Infers direction for a bubble.
 *
 * Priority:
 *   1. an explicit outgoing marker (`data-outgoing`, an aria-label mentioning
 *      "sent"/"đã gửi", or a class token containing "outgoing"),
 *   2. horizontal geometry of the bubble text against the container centre.
 */
export function inferDirection(
  bubble: HTMLElement,
  list: HTMLElement,
): { direction: SenderDirection; heuristic: boolean } {
  const explicit = bubble.getAttribute('data-outgoing');
  if (explicit === 'true' || explicit === '1') return { direction: 'outgoing', heuristic: false };
  if (explicit === 'false' || explicit === '0') return { direction: 'incoming', heuristic: false };

  const aria = (bubble.getAttribute('aria-label') ?? '').toLowerCase();
  if (/^(?:sent|you sent|bạn đã gửi|đã gửi)(?:\s|:|$)/u.test(aria)) {
    return { direction: 'outgoing', heuristic: false };
  }
  if (/^(?:received|đã nhận|nhận được)(?:\s|:|$)/u.test(aria)) {
    return { direction: 'incoming', heuristic: false };
  }

  const classAttr = (bubble.getAttribute('class') ?? '').toLowerCase();
  if (/\b(?:outgoing|sent-by-me|is-outgoing)\b/.test(classAttr)) {
    return { direction: 'outgoing', heuristic: false };
  }

  // Geometry fallback: outgoing bubbles hug the right edge of the list.
  const bubbleRect = bubble.getBoundingClientRect();
  const listRect = list.getBoundingClientRect();
  if (listRect.width > 0 && bubbleRect.width > 0) {
    const bubbleCenter = bubbleRect.left + bubbleRect.width / 2;
    const listCenter = listRect.left + listRect.width / 2;
    const offset = bubbleCenter - listCenter;
    const threshold = listRect.width * 0.08;
    if (offset > threshold) return { direction: 'outgoing', heuristic: true };
    if (offset < -threshold) return { direction: 'incoming', heuristic: true };
  }

  return { direction: 'unknown', heuristic: true };
}

/** Extracts a visible timestamp attached to a bubble, when one exists. */
function timeLabel(value: string): string | null {
  const trimmed = value.trim();
  if (TIME_PATTERN.test(trimmed)) return trimmed;
  // Extract only the leading clock, never an aria summary containing sender
  // and message text (e.g. "Lúc 15:21, Bạn: ...").
  return trimmed.match(/^(?:lúc|at|sent at|received at|đã gửi lúc)\s+(\d{1,2}:\d{2}(?:\s*[APap]\.?[Mm]\.?)?)(?=[,\s]|$)/iu)?.[1] ?? null;
}

export function extractTimestamp(bubble: HTMLElement, styles = new WeakMap<Element, CSSStyleDeclaration>()): string | null {
  for (const titled of bubble.querySelectorAll<HTMLElement>('[title], time')) {
    if (hiddenStyle(titled, styles)) continue;
    const title = timeLabel(titled.getAttribute('title') ?? '');
    if (title) return title;
    const datetime = titled.getAttribute('datetime');
    if (datetime && titled.tagName === 'TIME') return (titled.textContent ?? '').trim() || datetime;
    if (titled.tagName === 'TIME') { const visible = timeLabel(titled.textContent ?? ''); if (visible) return visible; }
  }

  for (const ariaTime of [bubble, ...bubble.querySelectorAll<HTMLElement>('[aria-label*=":"], time')]) {
    if (hiddenStyle(ariaTime, styles)) continue;
    const label = timeLabel(ariaTime.getAttribute('aria-label') ?? '');
    if (label) return label;
  }

  return null;
}

/** Stable DOM identifier, when the element exposes one. */
function domIdOf(el: Element): string | null {
  const direct = el.getAttribute('data-message-id') ?? el.getAttribute('data-mid');
  if (direct) return `message:${direct}`;
  const inner = el.querySelector('[data-message-id], [data-mid]');
  const stable = inner?.getAttribute('data-message-id') ?? inner?.getAttribute('data-mid');
  if (stable) return `message:${stable}`;
  return el.id ? `element:${el.id}` : null;
}

/**
 * Extracts the currently rendered messages of the active conversation.
 *
 * Only the messages that are actually rendered inside the selected
 * conversation's region are returned. Messenger virtualizes older history, so
 * this is explicitly "the visible messages", not the full transcript.
 */
export function extractConversation(options: AdapterOptions = {}): ExtractedConversation {
  const root = options.root ?? document;
  const styles = new WeakMap<Element, CSSStyleDeclaration>();
  const { container, strategy } = findConversationContainer(root, styles);
  const conversation = detectConversation(root, styles, container);

  if (!container) {
    const busy = Array.from(root.querySelectorAll<HTMLElement>('[role="progressbar"], [aria-busy="true"]')).some(el => !isHidden(el, styles));
    const status = busy ? 'loading' : root instanceof Document && !conversation.key.startsWith('thread:') && !findComposer(root, styles)
      ? 'no-conversation' : 'no-container';
    return {
      conversation,
      messages: [],
      unsupported: status === 'no-container',
      warning:
        'Không nhận diện được vùng tin nhắn của Messenger. Có thể Facebook đã đổi giao diện hoặc trang chưa tải xong.',
      candidates: 0,
      parsed: 0,
      rejected: 0,
      status,
      strategy,
      atBottom: false,
      container: null,
    };
  }

  const { rows } = findRowLevel(container, styles);
  const raws: RawBubble[] = [];

  rows.forEach((row, index) => {
    const el = row as HTMLElement;
    if (isHidden(el, styles)) {
      return;
    }

    const { text, textEl } = readRowText(row, styles);
    const trimmed = text.trim();

    // Separators ("Hôm nay") and empty rows are not messages.
    if (!trimmed || (SEPARATOR_PATTERN.test(trimmed) && !row.querySelector('[dir="auto"], [data-ad-comet-preview="message"]') && !domIdOf(row))) {
      return;
    }

    // Measure direction from the element that actually carries the bubble
    // (it is the colored shape), not the full-width row wrapper. When the
    // text element has no measurable box, fall back to the row.
    let bubbleForGeometry = textEl ?? el;
    while (bubbleForGeometry !== el && bubbleForGeometry.getBoundingClientRect().width === 0) bubbleForGeometry = bubbleForGeometry.parentElement ?? el;
    const rowDirection = inferDirection(el, container);
    const { direction, heuristic } = rowDirection.heuristic ? inferDirection(bubbleForGeometry, container) : rowDirection;
    raws.push({
      text,
      direction,
      directionIsHeuristic: heuristic,
      timestamp: extractTimestamp(el, styles),
      domId: domIdOf(el),
      index,
    });
  });

  const parsed = keepMeaningful(orderBubbles(raws.map(parseBubble)));

  const messages = parsed.map((p) => ({
    id: '',
    text: p.displayText,
    normalizedText: p.normalizedText,
    direction: p.direction,
    timestamp: p.timestamp,
    directionIsHeuristic: p.directionIsHeuristic,
    conversationKey: conversation.key,
    conversationLabel: conversation.label,
    detectedAt: Date.now(),
    domId: p.domId,
    ordinal: p.index,
    renderId: renderIdOf(rows[p.index]!),
    sentAtMs: absoluteTimestamp(rows[p.index]!),
  }));

  const status = messages.length === 0
    ? (rows.length === 0 ? 'no-visible-messages' : 'all-rejected')
    : 'ok';

  const warning = status === 'all-rejected'
    ? `Đã tìm thấy vùng tin nhắn (${strategy}) nhưng không đọc được nội dung nào từ ${rows.length} hàng.`
    : null;

  return {
    conversation,
    messages,
    unsupported: false,
    warning,
    candidates: rows.length,
    parsed: messages.length,
    rejected: rows.length - messages.length,
    status,
    strategy,
    atBottom: isAtBottom(container),
    container,
  };
}
