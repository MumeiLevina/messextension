import { expect, it } from 'vitest';
import { NewMessageSession } from '../../extension/src/core/new-message-session';
import { extractConversation } from '../../extension/src/content/messenger-adapter';
import { appendModernRow, buildModernMessengerDom, stubModernLayout } from '../fixtures/messenger-modern';

function setup() {
  const root = buildModernMessengerDom({ bubbles: [{ text: 'Tin cũ A', direction: 'incoming', id: 'a' }, { text: 'Tin cũ B', direction: 'outgoing', id: 'b' }] });
  document.body.append(root); stubModernLayout(root);
  const session = new NewMessageSession(); session.beginSession();
  const scan = () => {
    const extracted = extractConversation({ root }); session.select(extracted.conversation);
    return session.ingest(extracted.messages, { atBottom: extracted.atBottom });
  };
  return { root, session, scan };
}

it('the actual adapter seeds history and emits later incoming/outgoing text in order', () => {
  const { root, session, scan } = setup();
  expect(scan()).toEqual([]); expect(session.statistics.baselineMessageCount).toBe(2);
  appendModernRow(root, { text: 'Tin mới đến', direction: 'incoming', id: 'c' });
  appendModernRow(root, { text: 'Tin mới đi', direction: 'outgoing', id: 'd' }); stubModernLayout(root);
  expect(scan().map(m => [m.text, m.direction])).toEqual([['Tin mới đến', 'incoming'], ['Tin mới đi', 'outgoing']]);
  expect(scan()).toEqual([]); expect(session.activeMessages).toHaveLength(2);
});

it('prepending older rendered DOM and shifting indexes never generates new messages', () => {
  const { root, session, scan } = setup(); scan();
  const previous = appendModernRow(root, { text: 'Lịch sử trước mốc', direction: 'incoming', id: 'history' });
  root.querySelector('#thread-scroll')!.prepend(previous); stubModernLayout(root);
  (root.querySelector('#thread-scroll') as HTMLElement).scrollTop = 0;
  expect(scan()).toEqual([]); expect(session.statistics.suppressedBackfillCount).toBe(1);
  expect(session.activeMessages).toEqual([]);
});

it('actual DOM replacement without semantic ids is reconciled one-to-one', () => {
  const { root, session, scan } = setup();
  root.querySelectorAll('[data-message-id]').forEach(el => el.removeAttribute('data-message-id')); scan();
  root.querySelectorAll('.msg-row').forEach(el => el.replaceWith(el.cloneNode(true))); stubModernLayout(root);
  expect(scan()).toEqual([]); expect(session.statistics.knownMessageCount).toBe(2);
  appendModernRow(root, { text: 'Tin cũ B', direction: 'outgoing' }); stubModernLayout(root);
  expect(scan()).toHaveLength(1); expect(session.activeMessages[0].text).toBe('Tin cũ B');
});

it('a fresh selected conversation silently baselines its visible history', () => {
  const { root, session, scan } = setup(); scan();
  appendModernRow(root, { text: 'Tin mới A', direction: 'incoming', id: 'new-a' }); stubModernLayout(root); scan();
  const title = root.querySelector('#thread-title')!; title.textContent = 'Synthetic B'; title.setAttribute('aria-label', 'Synthetic B');
  root.querySelector('#thread-scroll')!.replaceChildren();
  appendModernRow(root, { text: 'Tin cũ của B', direction: 'incoming', id: 'old-b' }); stubModernLayout(root);
  expect(scan()).toEqual([]); expect(session.activeMessages).toEqual([]);
  appendModernRow(root, { text: 'Tin mới B', direction: 'outgoing', id: 'new-b' }); stubModernLayout(root);
  expect(scan().map(m => m.text)).toEqual(['Tin mới B']);
});

it('one outgoing message stays one tracked item through Sent, Delivered and DOM replacement', () => {
  const { root, session, scan } = setup(); scan();
  const row = appendModernRow(root, { text: 'Synthetic outgoing payload', direction: 'outgoing', id: 'outgoing' });
  row.setAttribute('aria-label', 'Lúc 15:21, Bạn: Synthetic outgoing payload'); stubModernLayout(root);
  expect(scan()).toHaveLength(1);
  row.insertAdjacentHTML('afterbegin', '<h4 dir="auto">Bạn đã gửi</h4>');
  row.insertAdjacentHTML('beforeend', '<div role="status">Đã gửi</div>');
  expect(scan()).toEqual([]);
  row.querySelector('[role="status"]')!.textContent = 'Đã nhận'; expect(scan()).toEqual([]);
  row.replaceWith(row.cloneNode(true)); stubModernLayout(root); expect(scan()).toEqual([]);
  expect(session.activeMessages.map(m => [m.text, m.timestamp])).toEqual([['Synthetic outgoing payload', '15:21']]);
  expect(session.statistics.newMessagesEmittedCount).toBe(1);
});
