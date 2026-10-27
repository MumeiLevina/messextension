/**
 * Messenger composer adapter, version 1.
 *
 * The single code path allowed to modify the message composer. It is invoked
 * only by an explicit user action in the side panel ("Chèn vào Messenger"),
 * re-identifies the composer of the currently selected conversation at the
 * moment of insertion, and never sends a message.
 *
 * Rules enforced here, not in the UI:
 *   - with several visible composer candidates the target is ambiguous and
 *     the insertion is refused; the panel falls back to manual copy/paste,
 *   - the detected conversation key must match the one the panel acted on,
 *     so a thread switch between the click and the insertion blocks it,
 *   - placeholder attributes are not user draft content,
 *   - existing draft text is never touched unless the user chose the mode.
 */
import { findComposers, detectConversation, findComposer, threadKeyFromUrl, findConversationContainer } from './messenger-adapter';
import type { ConversationInfo } from '../core/models';

export type ComposerMode = 'append' | 'replace';

export type ComposerError =
  | 'composer-not-found'
  | 'composer-ambiguous'
  | 'conversation-changed'
  | 'empty-text'
  | 'mutation-failed';

export interface ComposerStatus {
  found: boolean;
  /** Which composer variant was identified. */
  variant: 'contenteditable' | 'textarea' | 'unknown';
  conversation: ConversationInfo | null;
  /** True only when the composer holds non-placeholder user text. */
  hasText: boolean;
  error: ComposerError | null;
}

export interface ComposerInsertResult extends ComposerStatus {
  ok: boolean;
  mode: ComposerMode | 'keep';
  insertedChars: number;
  /** True when the text was already present and nothing was written. */
  skipped: boolean;
}

const completed = new Map<string, string>();
const pending = new Set<string>();
const pendingEditors = new WeakSet<HTMLElement>();
const owners = new WeakMap<HTMLElement, string>();

/** Visible composer content; Messenger placeholders do not count as draft. */
export function composerText(el: HTMLElement): string {
  if (el instanceof HTMLTextAreaElement) return el.value;
  // Placeholder attributes/CSS are not editor content. Never classify a user's
  // actual words (including "Enter để gửi") as disposable placeholder text.
  return el.innerText ?? el.textContent ?? '';
}

/**
 * The composer of the selected conversation. `findComposer` returns null when
 * no candidate exists or when two visible composers make the target
 * ambiguous — an ambiguity that must be surfaced, never resolved by guess.
 */
export function selectedComposer(root: Document | Element = document): HTMLElement | null {
  return findComposer(root);
}

export function composerStatus(): ComposerStatus {
  const { container } = findConversationContainer(document);
  const conversation = detectConversation(document, undefined, container);
  const composer = selectedComposer();
  if (!composer) {
    const ambiguous = findComposers(document).length > 1;
    return {
      found: false,
      variant: 'unknown',
      conversation,
      hasText: false,
      error: ambiguous ? 'composer-ambiguous' : 'composer-not-found',
    };
  }
  const key = threadKeyFromUrl(location.href);
  const owner = owners.get(composer);
  if (!container || !key || conversation.key !== key || (owner && owner !== key)) {
    return { found: false, variant: 'unknown', conversation, hasText: false, error: 'conversation-changed' };
  }
  owners.set(composer, key);
  return {
    found: true,
    variant: composer.tagName === 'TEXTAREA' ? 'textarea' : 'contenteditable',
    conversation,
    hasText: composerText(composer).length > 0,
    error: null,
  };
}

function placeCaretAtEnd(el: HTMLElement): void {
  el.focus();
  try {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  } catch {
    /* writeComposer will fail safely if selection/native editing is unavailable */
  }
}

/**
 * Writes `text` into the composer.
 *
 * `append` keeps the existing draft and adds the text at the end; when the
 * composer only shows a placeholder, the placeholder is replaced instead.
 * `replace` discards the existing content. Both keep the operation out of
 * any automatic path: this function is only reached through
 * `insertDraft` with a user-confirmed mode.
 */
function writeComposer(el: HTMLElement, text: string, stillSelected: () => boolean): boolean {
  if (el instanceof HTMLTextAreaElement) {
    el.focus();
    if (!stillSelected()) return false;
    // Bypass React's per-instance value tracker, then notify its input handler.
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, text);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    return true;
  }
  placeCaretAtEnd(el);
  if (!stillSelected()) return false;
  const range = document.createRange();
  range.selectNodeContents(el);
  const selection = window.getSelection();
  if (!selection) return false;
  selection.removeAllRanges();
  selection.addRange(range);
  // Use the browser editing command so controlled rich editors see an input
  // transaction. A raw textContent fallback can look successful but be ignored
  // by Messenger. In that case retain the panel draft and offer manual copy.
  return document.execCommand('insertText', false, text);
}

function needsSpace(content: string, text: string): boolean {
  const last = Array.from(content).at(-1);
  return last !== undefined && !/\s/.test(last) && !/^\s/.test(text);
}

/**
 * Inserts a user-confirmed draft into the currently selected composer.
 *
 * A stable `expectedKey` is mandatory. The request ID identifies one draft
 * revision, so retries are idempotent even when appending to existing text.
 * A separate dictation/edit receives a new request ID even if its words match.
 */
export async function insertDraft(
  text: string,
  mode: ComposerMode,
  expectedKey: string | null = null,
  requestId = text,
): Promise<ComposerInsertResult> {
  const fail = (error: ComposerError, status = composerStatus()): ComposerInsertResult =>
    ({ ...status, ok: false, mode, insertedChars: 0, skipped: false, error });
  if (!text.trim()) return fail('empty-text');
  if (!expectedKey || document.visibilityState === 'hidden' || threadKeyFromUrl(location.href) !== expectedKey) return fail('conversation-changed');
  const status = composerStatus();
  if (!status.found || !status.conversation) {
    return { ...status, ok: false, mode, insertedChars: 0, skipped: false, error: status.error ?? 'composer-not-found' };
  }
  if (expectedKey !== null && status.conversation.key !== expectedKey) {
    return { ...status, ok: false, mode, insertedChars: 0, skipped: false, error: 'conversation-changed' };
  }
  const composer = selectedComposer();
  if (!composer) {
    return { ...status, ok: false, mode, insertedChars: 0, skipped: false, error: status.error ?? 'composer-not-found' };
  }
  const current = composerText(composer);
  const operation = `${expectedKey}\0${requestId}`;
  if (pending.has(operation) || pendingEditors.has(composer)) return fail('mutation-failed', status);
  const previous = completed.get(operation);
  if (previous !== undefined && previous === current) {
    return { ...status, ok: true, mode: 'keep', insertedChars: 0, skipped: true, error: null };
  }
  if (previous !== undefined) return fail('mutation-failed', status);
  const desired = mode === 'replace' || !current ? text : `${current}${needsSpace(current, text) ? ' ' : ''}${text}`;
  const stillSelected = () => composer.isConnected && selectedComposer() === composer &&
    document.visibilityState !== 'hidden' &&
    threadKeyFromUrl(location.href) === expectedKey && composerStatus().found &&
    owners.get(composer) === expectedKey;
  pending.add(operation);
  pendingEditors.add(composer);
  try {
    if (!writeComposer(composer, desired, stillSelected)) return fail('mutation-failed', status);
    const comparable = (value: string) => composer instanceof HTMLTextAreaElement ? value : value.replace(/\u00a0/g, ' ');
    const immediate = composerText(composer);
    if (comparable(immediate) === comparable(desired)) {
      completed.set(operation, immediate);
      if (completed.size > 128) completed.delete(completed.keys().next().value!);
    }
    // Let controlled editors reconcile before reporting DOM acceptance.
    await new Promise(resolve => setTimeout(resolve, 60));
    if (!stillSelected()) return fail('conversation-changed');
    const accepted = composerText(composer);
    // Chromium's rich editing engine represents preserved spaces as NBSPs.
    // Compare their rendered spacing, retaining the actual DOM for retry checks.
    if (comparable(accepted) !== comparable(desired)) return fail('mutation-failed');
    completed.set(operation, accepted);
  } catch {
    return { ...status, ok: false, mode, insertedChars: 0, skipped: false, error: 'mutation-failed' };
  } finally { pending.delete(operation); pendingEditors.delete(composer); }
  return { ...status, hasText: true, ok: true, mode, insertedChars: text.length, skipped: false, error: null };
}
