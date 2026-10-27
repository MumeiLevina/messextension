import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMessengerDom, stubLayout } from '../fixtures/dom-harness';
import {
  composerStatus,
  composerText,
  insertDraft as insert,
  selectedComposer,
} from '../../extension/src/content/messenger-composer';

let fixtureId = 0;
const insertDraft = (text: string, mode: 'append' | 'replace', key: string | null = 'thread:unit-a', requestId?: string) => insert(text, mode, key, `${fixtureId}:${requestId ?? text}`);
beforeEach(() => {
  fixtureId++;
  history.replaceState({}, '', '/messages/t/unit-a');
  // jsdom has no editing engine. Browser tests exercise Chromium's real command.
  Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn((_command, _ui, text) => {
    const range = window.getSelection()!.getRangeAt(0);
    const editor = document.activeElement!;
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
    return true;
  }) });
});

/** Mounts the classic fixture on document.body so module-default roots resolve. */
function mount() {
  const root = buildMessengerDom({
    title: 'Nguyễn Văn A',
    bubbles: [{ text: 'Chào bạn', direction: 'incoming', id: 'm1' }],
  });
  document.body.appendChild(root);
  stubLayout(root);
  return { root, input: root.querySelector<HTMLElement>('[contenteditable="true"]')! };
}

describe('composer status', () => {
  it('finds the visible composer and reports placeholders as no text', () => {
    const { input } = mount();
    expect(input.textContent).toBe('');
    const status = composerStatus();
    expect(status.found).toBe(true);
    expect(status.variant).toBe('contenteditable');
    expect(status.hasText).toBe(false);
    expect(status.error).toBeNull();
    expect(status.conversation?.label).toBe('Nguyễn Văn A');
    expect(composerText(input)).toBe('');
  });

  it('reports a real draft as composer text', () => {
    const { input } = mount();
    input.textContent = 'Tôi đang soạn…';
    expect(composerStatus().hasText).toBe(true);
  });

  it('reports no composer when the composer is omitted from the DOM', () => {
    const root = buildMessengerDom({ withoutComposer: true, bubbles: [{ text: 'x', direction: 'incoming' }] });
    document.body.appendChild(root);
    stubLayout(root);
    const status = composerStatus();
    expect(status.found).toBe(false);
    expect(status.error).toBe('composer-not-found');
    document.body.replaceChildren(root);
  });

  it('refuses ambiguous targets when two visible composers exist', () => {
    const { input } = mount();
    const second = document.createElement('textarea');
    second.setAttribute('aria-label', 'Ô soạn thứ hai');
    input.parentElement?.appendChild(second);
    Object.defineProperty(second, 'getBoundingClientRect', { configurable: true,
      value: () => ({ left: 0, right: 300, top: 660, bottom: 700, width: 300, height: 40, x: 0, y: 660 }) });
    expect(selectedComposer()).toBeNull();
    const status = composerStatus();
    expect(status.found).toBe(false);
    expect(status.error).toBe('composer-ambiguous');
  });
});

describe('insertDraft', () => {
  it('requires a stable recipient even before monitoring starts', async () => {
    const { input } = mount();
    expect(await insertDraft('draft', 'append', null)).toMatchObject({ ok: false, error: 'conversation-changed' });
    expect(input.textContent).toBe('');
  });

  it('does not insert into an inactive hidden tab', async () => {
    const { input } = mount();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      expect(await insertDraft('draft', 'append')).toMatchObject({ ok: false, error: 'conversation-changed' });
      expect(input.textContent).toBe('');
    } finally { visibility.mockRestore(); }
  });

  it('keeps whitespace and literal placeholder-like user words', async () => {
    const { input } = mount();
    input.textContent = 'Enter để gửi\n';
    expect((await insertDraft('  dòng mới  ', 'append')).ok).toBe(true);
    expect(input.textContent).toBe('Enter để gửi\n  dòng mới  ');
  });

  it('deduplicates a retry with an existing prefix but allows a distinct identical utterance', async () => {
    const { input } = mount();
    input.textContent = 'câu cũ';
    expect((await insertDraft('chào', 'append', 'thread:unit-a', 'one')).ok).toBe(true);
    expect((await insertDraft('chào', 'append', 'thread:unit-a', 'one')).skipped).toBe(true);
    expect(input.textContent).toBe('câu cũ chào');
    expect((await insertDraft('chào', 'append', 'thread:unit-a', 'two')).ok).toBe(true);
    expect(input.textContent).toBe('câu cũ chào chào');
  });

  it('refuses simultaneous insertion while editor acceptance is pending', async () => {
    const { input } = mount();
    const first = insertDraft('chào', 'append');
    expect(await insertDraft('chào', 'append')).toMatchObject({ ok: false });
    expect((await first).ok).toBe(true);
    expect(input.textContent).toBe('chào');
  });

  it('deduplicates the same request after the composer DOM is replaced', async () => {
    const { input } = mount();
    expect((await insertDraft('chào', 'append')).ok).toBe(true);
    const next = input.cloneNode(true) as HTMLElement;
    Object.defineProperty(next, 'getBoundingClientRect', { value: () => input.getBoundingClientRect() });
    input.replaceWith(next);
    expect((await insertDraft('chào', 'append')).skipped).toBe(true);
    expect(next.textContent).toBe('chào');
  });

  it('reports failure if the editor restores its controlled value', async () => {
    const { input } = mount();
    input.textContent = 'giữ lại';
    input.addEventListener('input', () => { input.textContent = 'giữ lại'; });
    expect(await insertDraft('mới', 'append')).toMatchObject({ ok: false, error: 'mutation-failed' });
    expect(input.textContent).toBe('giữ lại');
  });

  it('uses manual fallback rather than a raw DOM write when native editing is unavailable', async () => {
    const { input } = mount();
    vi.mocked(document.execCommand).mockReturnValue(false);
    expect(await insertDraft('mới', 'append')).toMatchObject({ ok: false, error: 'mutation-failed' });
    expect(input.textContent).toBe('');
  });

  it('rechecks navigation caused by focus before mutating the composer', async () => {
    const { input } = mount();
    input.addEventListener('focus', () => history.pushState({}, '', '/messages/t/unit-b'));
    expect((await insertDraft('cho A', 'append')).ok).toBe(false);
    expect(input.textContent).toBe('');
  });

  it('refuses a composer DOM node reused across different thread URLs', async () => {
    mount();
    composerStatus();
    history.pushState({}, '', '/messages/t/unit-b');
    expect(await insertDraft('cho B', 'append', 'thread:unit-b')).toMatchObject({ ok: false, error: 'conversation-changed' });
  });

  it('uses the native textarea setter and input event with exact spacing', async () => {
    const { input } = mount();
    const area = document.createElement('textarea');
    area.value = 'cũ\n';
    Object.defineProperty(area, 'getBoundingClientRect', { value: () => input.getBoundingClientRect() });
    input.replaceWith(area);
    let accepted = '';
    area.addEventListener('input', () => { accepted = area.value; });
    const setter = vi.fn();
    Object.defineProperty(area, 'value', {
      get: () => Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.get!.call(area), set: setter,
    });
    expect((await insertDraft(' mới ', 'append')).ok).toBe(true);
    expect(accepted).toBe('cũ\n mới ');
    expect(setter).not.toHaveBeenCalled();
  });

  it('rejects disabled and readonly textarea targets', async () => {
    const { input } = mount();
    const area = document.createElement('textarea');
    area.disabled = true;
    Object.defineProperty(area, 'getBoundingClientRect', { value: () => input.getBoundingClientRect() });
    input.replaceWith(area);
    expect((await insertDraft('mới', 'append')).ok).toBe(false);
    area.disabled = false;
    area.readOnly = true;
    expect((await insertDraft('mới', 'append')).ok).toBe(false);
    expect(area.value).toBe('');
  });

  it('appends to an empty (placeholder) composer in replace form', async () => {
    const { input } = mount();
    const result = await insertDraft('Xin chào Việt Nam', 'append');
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(false);
    expect(input.textContent?.trim()).toBe('Xin chào Việt Nam');
  });

  it('keeps existing draft text when appending with a separating space', async () => {
    const { input } = mount();
    input.textContent = 'câu cũ';
    const result = await insertDraft('câu mới', 'append');
    expect(result.ok).toBe(true);
    expect(input.textContent?.trim()).toBe('câu cũ câu mới');
  });

  it('replaces existing text only in replace mode', async () => {
    const { input } = mount();
    input.textContent = 'bản nháp cũ';
    const result = await insertDraft('bản nháp mới', 'replace');
    expect(result.ok).toBe(true);
    expect(input.textContent?.trim()).toBe('bản nháp mới');
  });

  it('does not duplicate when the same draft is inserted twice', async () => {
    const { input } = mount();
    expect((await insertDraft('Một câu', 'append')).ok).toBe(true);
    const second = await insertDraft('Một câu', 'append');
    expect(second.ok).toBe(true);
    expect(second.skipped).toBe(true);
    expect(input.textContent?.trim()).toBe('Một câu');
  });

  it('refuses when the conversation key no longer matches', async () => {
    mount();
    const result = await insertDraft('Văn bản thử', 'append', 'thread:khac');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('conversation-changed');
  });

  it('rejects empty text without touching the composer', async () => {
    const { input } = mount();
    const result = await insertDraft('   ', 'append');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('empty-text');
    expect(input.textContent).toBe('');
  });

  it('fails without mutation when no composer is found', async () => {
    const root = buildMessengerDom({ withoutComposer: true, bubbles: [{ text: 'x', direction: 'incoming' }] });
    document.body.appendChild(root);
    stubLayout(root);
    const result = await insertDraft('Văn bản', 'append');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('composer-not-found');
  });
});
