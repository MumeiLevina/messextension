import { test as base, chromium, expect, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, sep, basename } from 'node:path';

type Fixtures = { extension: { context: BrowserContext; worker: Worker; messenger: Page; panel: Page; id: string; errors: string[] } };
const test = base.extend<Fixtures>({
  // Playwright requires destructuring, even for a fixture with no dependencies.
  // eslint-disable-next-line no-empty-pattern
  extension: async ({}, use) => {
    const profile = mkdtempSync(join(tmpdir(), 'echo-fixture-'));
    const path = resolve('dist');
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    });
    const errors: string[] = [];
    context.on('page', page => page.on('pageerror', e => errors.push(e.message)));
    await context.route('https://www.facebook.com/**', route => route.fulfill({
      contentType: 'text/html', body: readFileSync(route.request().url().includes('modern-')
        ? 'tests/fixtures/messenger-modern.html' : 'tests/fixtures/messenger.html', 'utf8'),
    }));
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    const messenger = await context.newPage();
    await messenger.goto('https://www.facebook.com/messages/t/fixture-a');
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    await messenger.bringToFront();
    await use({ context, worker, messenger, panel, id, errors });
    await context.close();
    // Only the temporary fixture profile created above is removed.
    if (!resolve(profile).startsWith(resolve(tmpdir()) + sep) || !basename(profile).startsWith('echo-fixture-')) throw new Error('Unexpected fixture profile path');
    rmSync(profile, { recursive: true, force: true });
  },
});

const snapshot = (panel: Page) => panel.evaluate(() => chrome.runtime.sendMessage({ type: 'echo:getState' }));

async function installSyntheticTts(panel: Page) {
  await panel.addInitScript(() => {
    const spoken: { text: string; lang: string; rate: number; voice: string | null }[] = [];
    // Native utterance.voice rejects synthetic voice objects; simulate both ends
    // of the audio boundary while keeping the real extension/message relay.
    class SyntheticUtterance {
      lang = ''; rate = 1; voice: SpeechSynthesisVoice | null = null;
      onend: ((event: SpeechSynthesisEvent) => void) | null = null;
      onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null;
      constructor(public text: string) {}
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: SyntheticUtterance });
    let current: SpeechSynthesisUtterance | null = null;
    let canceled = 0;
    const synth = new EventTarget();
    Object.assign(synth, {
      getVoices: () => [{ voiceURI: 'synthetic-vi', name: 'Synthetic Vietnamese', lang: 'vi-VN', localService: true, default: true }],
      speak: (u: SpeechSynthesisUtterance) => { current = u; spoken.push({ text: u.text, lang: u.lang, rate: u.rate, voice: u.voice?.voiceURI ?? null }); },
      cancel: () => { current = null; canceled++; },
    });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synth });
    Object.assign(window, { echoTtsFixture: {
      spoken,
      finish: () => { const u = current; current = null; u?.onend?.({} as SpeechSynthesisEvent); },
      cancels: () => canceled,
    } });
  });
  await panel.reload();
}

async function spokenTts(panel: Page) {
  return panel.evaluate(() => (window as unknown as { echoTtsFixture: { spoken: { text: string; lang: string; rate: number; voice: string | null }[] } }).echoTtsFixture.spoken);
}

async function finishTts(panel: Page) {
  await panel.evaluate(() => (window as unknown as { echoTtsFixture: { finish(): void } }).echoTtsFixture.finish());
}

async function installSyntheticStt(panel: Page) {
  await panel.evaluate(() => {
    class Recognition {
      lang = ''; continuous = false; interimResults = false; maxAlternatives = 1; aborted = false;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      constructor() { Object.assign(window, { echoRecognition: this }); }
      start() { this.onstart?.(); }
      stop() { this.onend?.(); }
      abort() { this.aborted = true; this.onend?.(); }
    }
    Object.assign(window, { SpeechRecognition: Recognition });
  });
}

async function recognizeFinal(panel: Page, text: string) {
  await panel.evaluate(value => {
    const rec = (window as unknown as { echoRecognition: { onresult: (e: unknown) => void } }).echoRecognition;
    rec.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: value }], { isFinal: true })] });
  }, text);
}

test('TTS opt-in reads only new incoming IDs in order, survives polling and cancels on pause/Stop', async ({ extension: e }) => {
  expect(await e.panel.evaluate(() => ({ synthesis: typeof speechSynthesis, utterance: typeof SpeechSynthesisUtterance })))
    .toEqual({ synthesis: 'object', utterance: 'function' });
  await installSyntheticTts(e.panel);
  await e.messenger.bringToFront();
  await e.panel.getByRole('button', { name: 'Bắt đầu theo dõi', exact: true }).click();
  await appendClassic(e.messenger, 'Already tracked before TTS', 'before-tts');
  await expect.poll(async () => (await snapshot(e.panel)).messages.length).toBe(1);
  expect(await spokenTts(e.panel)).toEqual([]);
  await e.panel.getByLabel('Tốc độ TTS').selectOption('1.25');
  await e.panel.getByRole('button', { name: 'Bật TTS', exact: true }).click();
  await expect.poll(async () => (await spokenTts(e.panel)).length).toBe(1);
  await finishTts(e.panel);
  for (const id of ['tts-1', 'tts-2', 'tts-3']) await appendClassic(e.messenger, 'Tin đến giống nhau', id);
  await e.messenger.evaluate(() => {
    const row = document.createElement('div'); row.setAttribute('role', 'listitem');
    row.className = 'bubble outgoing'; row.setAttribute('data-message-id', 'tts-self');
    row.innerHTML = '<span dir="auto">Tin tự gửi không đọc</span>';
    document.querySelector('#message-list')!.append(row);
  });
  await expect.poll(async () => (await snapshot(e.panel)).messages.length).toBe(5);
  await expect.poll(async () => (await spokenTts(e.panel)).length).toBe(2);
  await finishTts(e.panel); await finishTts(e.panel); await finishTts(e.panel);
  expect((await spokenTts(e.panel)).slice(1)).toEqual(Array.from({ length: 3 }, () => ({ text: 'Tin đến giống nhau', lang: 'vi-VN', rate: 1.25, voice: 'synthetic-vi' })));
  // Actual periodic snapshots must not replay messages.
  await e.panel.waitForTimeout(3300);
  expect(await spokenTts(e.panel)).toHaveLength(4);
  await e.panel.setViewportSize({ width: 420, height: 900 });
  await e.panel.screenshot({ path: '.artifacts/tts-validation/tts-controls-synthetic.png', fullPage: true });
  await appendClassic(e.messenger, 'Cancel me on pause', 'tts-pause');
  await expect(e.panel.getByTestId('tts-status')).toContainText('Đang đọc');
  await e.panel.getByRole('button', { name: 'Tạm dừng', exact: true }).click();
  await expect(e.panel.getByTestId('tts-status')).toContainText('Chờ tin nhắn');
  await e.panel.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
  await appendClassic(e.messenger, 'Cancel me on stop', 'tts-stop');
  await expect.poll(async () => (await spokenTts(e.panel)).length).toBe(6);
  await e.panel.getByRole('button', { name: 'Dừng theo dõi', exact: true }).click();
  await expect(e.panel.getByTestId('tts-status')).not.toContainText('Đang đọc');
  expect(e.errors).toEqual([]);
});

test('TTS preview and Stop reading work without monitoring; closing/reopening never replays backlog', async ({ extension: e }) => {
  await installSyntheticTts(e.panel); await e.messenger.bringToFront();
  await expect(e.panel.getByRole('button', { name: 'Bắt đầu theo dõi', exact: true })).toBeEnabled();
  await e.panel.getByRole('button', { name: 'Đọc thử', exact: true }).click();
  await expect(e.panel.getByTestId('tts-status')).toContainText('Đang đọc');
  await e.panel.waitForTimeout(3300);
  await expect(e.panel.getByTestId('tts-status')).toContainText('Đang đọc');
  await e.panel.getByRole('button', { name: 'Dừng đọc', exact: true }).click();
  await expect(e.panel.getByRole('button', { name: 'Bật TTS', exact: true })).toBeVisible();
  await e.panel.getByRole('button', { name: 'Bắt đầu theo dõi', exact: true }).click();
  await e.panel.getByRole('button', { name: 'Bật TTS', exact: true }).click(); await finishTts(e.panel);
  await appendClassic(e.messenger, 'Before panel reopen', 'tts-reopen');
  await expect.poll(async () => (await spokenTts(e.panel)).length).toBe(3);
  await e.panel.reload(); await e.messenger.bringToFront();
  await expect(e.panel.getByRole('button', { name: 'Bật TTS', exact: true })).toBeVisible();
  expect(await spokenTts(e.panel)).toEqual([]);
  await e.panel.getByRole('button', { name: 'Bật TTS', exact: true }).click(); await finishTts(e.panel);
  expect(await spokenTts(e.panel)).toHaveLength(1);
  await appendClassic(e.messenger, 'After panel reopen', 'tts-after-reopen');
  await expect.poll(async () => (await spokenTts(e.panel)).length).toBe(2);
  expect(e.errors).toEqual([]);
});
async function appendClassic(page: Page, text: string, id: string) {
  await page.evaluate(({ text, id }) => {
    const row = document.createElement('div'); row.setAttribute('role', 'listitem');
    row.className = 'bubble incoming'; row.setAttribute('data-message-id', id);
    const span = document.createElement('span'); span.setAttribute('dir', 'auto'); span.textContent = text;
    row.append(span); document.querySelector('#message-list')!.append(row);
  }, { text, id });
}

test('MV3 worker, panel, selected conversation, live updates, deduplication and Stop', async ({ extension: e }) => {
  await expect(e.panel.getByRole('button', { name: 'Bắt đầu theo dõi', exact: true })).toBeEnabled();
  await e.panel.getByRole('button', { name: 'Bắt đầu theo dõi', exact: true }).click();
  await e.panel.getByRole('tab', { name: 'Hội thoại', exact: true }).click();
  await expect(e.panel.locator('.messages > .bubble')).toHaveCount(0);
  expect((await snapshot(e.panel)).diagnostics).toMatchObject({ baselineEstablished: true, baselineMessageCount: 3, newMessagesEmittedCount: 0 });
  await e.messenger.evaluate(() => {
    for (let i = 0; i < 5; i++) {
      const bubble = document.createElement('div');
      bubble.setAttribute('role', 'listitem');
      bubble.className = 'bubble incoming';
      bubble.innerHTML = '<span dir="auto">Giống nhau</span>';
      document.querySelector('#message-list')!.append(bubble);
    }
  });
  await expect(e.panel.locator('.messages > .bubble')).toHaveCount(5);
  await expect(e.panel.locator('.messages')).not.toContainText('Trần Thị B');
  await expect(e.panel.locator('.messages > .bubble').filter({ hasText: 'Giống nhau' })).toHaveCount(5);
  await e.panel.getByRole('button', { name: 'Dừng theo dõi', exact: true }).click();
  await expect(e.panel.locator('.messages > .bubble')).toHaveCount(0);
  const snap = await e.panel.evaluate(async () => chrome.runtime.sendMessage({ type: 'echo:getState' }));
  expect(snap.monitoring).toBe('stopped');
  expect(snap.messages).toEqual([]);
  expect(e.errors).toEqual([]);
});

test('reconciles after five seconds when the observed message list is replaced', async ({ extension: e }) => {
  await e.panel.getByRole('button', { name: 'Bắt đầu theo dõi', exact: true }).click();
  await e.panel.getByRole('tab', { name: 'Hội thoại', exact: true }).click();
  await expect(e.panel.locator('.messages > .bubble')).toHaveCount(0);
  const started = Date.now();
  await e.messenger.evaluate(() => {
    const list = document.querySelector('#message-list')!;
    const replacement = list.cloneNode(true) as HTMLElement;
    const bubble = document.createElement('div');
    bubble.setAttribute('role', 'listitem');
    bubble.className = 'bubble incoming';
    bubble.innerHTML = '<span dir="auto">Đối soát định kỳ</span>';
    replacement.append(bubble);
    list.replaceWith(replacement);
  });
  await expect(e.panel.locator('.messages')).toContainText('Đối soát định kỳ', { timeout: 7000 });
  expect(Date.now() - started).toBeGreaterThan(3500);
  expect(Date.now() - started).toBeLessThan(7000);
  await expect(e.panel.locator('.messages > .bubble')).toHaveCount(1);
});

test('clears the previous thread while a new thread loads and isolates new messages', async ({ extension: e }) => {
  await e.panel.getByRole('button', { name: 'Bắt đầu theo dõi', exact: true }).click();
  await e.panel.getByRole('tab', { name: 'Hội thoại', exact: true }).click();
  await appendClassic(e.messenger, 'New tracked A', 'new-a');
  await expect(e.panel.locator('.messages > .bubble')).toHaveCount(1);
  await e.messenger.evaluate(() => {
    history.pushState({}, '', '/messages/t/fixture-b');
    document.querySelector('#message-list')!.replaceChildren();
    document.querySelector('#thread-title')!.textContent = 'Người B';
  });
  await expect(e.panel.locator('.messages > .bubble')).toHaveCount(0);
  await e.messenger.evaluate(() => {
    document.querySelector('#message-list')!.innerHTML = '<div role="listitem" class="bubble incoming"><span dir="auto">Chỉ của B</span></div>';
  });
  await expect.poll(async () => (await snapshot(e.panel)).diagnostics.baselineEstablished).toBe(true);
  await expect(e.panel.locator('.messages > .bubble')).toHaveCount(0);
  await appendClassic(e.messenger, 'Chỉ của B mới', 'new-b');
  await expect(e.panel.locator('.messages > .bubble')).toHaveCount(1);
  await expect(e.panel.locator('.messages')).toContainText('Chỉ của B mới');
  await expect(e.panel.locator('.messages')).not.toContainText('Chào bạn');
});

test('loads real local OCR worker, WASM and Vietnamese/English languages under extension CSP', async ({ extension: e }) => {
  const remote: string[] = [];
  e.panel.on('request', request => { if (/^https?:/.test(request.url())) remote.push(request.url()); });
  await e.panel.getByRole('tab', { name: 'Chẩn đoán', exact: true }).click();
  const row = e.panel.locator('.row').filter({ hasText: 'OCR (Tesseract, cục bộ)' });
  await expect(row).toContainText('Sẵn sàng', { timeout: 25000 });
  expect(remote).toEqual([]);
  expect(e.errors).toEqual([]);
});

test('supports editable drafts and manual copy without altering the Messenger composer', async ({ extension: e }) => {
  await e.panel.getByRole('tab', { name: 'Bản nháp', exact: true }).click();
  await e.panel.locator('textarea').fill('Xin chào, đây là bản nháp tiếng Việt.');
  await e.panel.getByRole('button', { name: 'Sao chép' }).click();
  await expect(e.panel.getByRole('button', { name: 'Đã sao chép' })).toBeVisible();
  await expect(e.messenger.getByRole('textbox')).toHaveText('');
  expect(await e.panel.getByRole('button', { name: /^Gửi$/ }).count()).toBe(0);
  const nativeSpeech = await e.panel.evaluate(() => ({
    supported: 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window,
    microphone: typeof navigator.mediaDevices?.getUserMedia === 'function',
  }));
  console.log('Native browser capabilities:', nativeSpeech);
});

test('a URL switch cannot relabel stale DOM as the new conversation', async ({ extension: e }) => {
  await e.panel.getByRole('button', { name: 'Bắt đầu theo dõi', exact: true }).click();
  await e.panel.getByRole('tab', { name: 'Hội thoại', exact: true }).click();
  await appendClassic(e.messenger, 'Post-baseline A', 'a-post');
  await expect(e.panel.locator('.messages > .bubble')).toHaveCount(1);
  await e.messenger.evaluate(() => history.pushState({}, '', '/messages/t/still-loading'));
  await expect(e.panel.locator('.messages > .bubble')).toHaveCount(0);
  await e.messenger.waitForTimeout(1500);
  await expect(e.panel.locator('.messages > .bubble')).toHaveCount(0);
  await e.messenger.evaluate(() => {
    document.querySelector('#thread-title')!.textContent = 'Thread mới';
    document.querySelector('#message-list')!.innerHTML = '<div role="listitem" class="bubble incoming"><span dir="auto">Nội dung mới</span></div>';
  });
  await expect.poll(async () => (await snapshot(e.panel)).diagnostics.baselineEstablished).toBe(true);
  await expect(e.panel.locator('.messages > .bubble')).toHaveCount(0);
  await appendClassic(e.messenger, 'Nội dung sau mốc mới', 'b-post');
  await expect(e.panel.locator('.messages > .bubble')).toHaveCount(1);
  await expect(e.panel.locator('.messages')).toContainText('Nội dung sau mốc mới');
});

test('does not route controls to an inactive Messenger tab', async ({ extension: e }) => {
  await e.panel.getByRole('button', { name: 'Bắt đầu theo dõi', exact: true }).click();
  const other = await e.context.newPage();
  await other.goto('https://www.facebook.com/messages/t/other-tab');
  await other.bringToFront();
  await expect.poll(async () => e.worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: '*://www.facebook.com/messages/t/fixture-a' });
    return chrome.tabs.sendMessage(tabs[0].id!, { type: 'echo:getState' });
  })).toMatchObject({ monitoring: 'stopped', messages: [] });
  await other.goto('about:blank');
  const routed = await e.panel.evaluate(() => chrome.runtime.sendMessage({ type: 'echo:getState' }));
  expect(routed).toBeNull();
});

test('synthetic Vietnamese speech uses microphone permission flow, Stop and an editable manual draft', async ({ extension: e }) => {
  await e.panel.evaluate(() => {
    class SyntheticRecognition {
      lang = ''; continuous = false; interimResults = false; maxAlternatives = 1;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      constructor() { Object.assign(window, { echoRecognition: this }); }
      start() { this.onstart?.(); }
      stop() { this.onend?.(); }
      abort() { this.onend?.(); }
    }
    Object.assign(window, { SpeechRecognition: SyntheticRecognition });
  });
  await e.panel.getByRole('tab', { name: 'Giọng nói', exact: true }).click();
  expect(await e.panel.evaluate(() => 'echoRecognition' in window)).toBe(false);
  await e.panel.getByRole('button', { name: '🎙 Bắt đầu ghi âm', exact: true }).click();
  await expect(e.panel.getByText('Đang nghe', { exact: true })).toBeVisible();
  await e.panel.evaluate(() => {
    const rec = (window as unknown as { echoRecognition: { lang: string; onresult: (event: unknown) => void } }).echoRecognition;
    if (rec.lang !== 'vi-VN') throw new Error('Incorrect recognition language');
    rec.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'Xin chào Việt Nam', confidence: .98 }], { isFinal: true })] });
  });
  await e.panel.getByRole('button', { name: '⏹ Dừng', exact: true }).click();
  await expect(e.panel.getByText('Rảnh', { exact: true })).toBeVisible();
  await e.panel.getByRole('button', { name: 'Chèn vào bản nháp', exact: true }).click();
  await e.panel.getByRole('tab', { name: 'Bản nháp', exact: true }).click();
  await expect(e.panel.locator('textarea')).toHaveValue('Xin chào Việt Nam');
  await e.panel.locator('textarea').fill('Xin chào Việt Nam — đã chỉnh sửa');
  await expect(e.panel.locator('textarea')).toHaveValue('Xin chào Việt Nam — đã chỉnh sửa');
  await expect(e.messenger.getByRole('textbox')).toHaveText('');
  await e.panel.screenshot({ path: '.artifacts/validation/synthetic-draft.png' });
  expect(e.errors).toEqual([]);
});

test('STT replays one final once but retains identical utterances from separate recordings', async ({ extension: e }) => {
  await installSyntheticStt(e.panel);
  await e.panel.getByRole('tab', { name: 'Bản nháp', exact: true }).click();
  await expect(e.panel.getByTestId('draft-recipient')).toHaveText('Nguyễn Văn A');
  await e.panel.getByRole('tab', { name: 'Giọng nói', exact: true }).click();
  for (let i = 0; i < 2; i++) {
    await e.panel.getByRole('button', { name: '🎙 Bắt đầu ghi âm', exact: true }).click();
    await expect(e.panel.getByText('Đang nghe', { exact: true })).toBeVisible();
    await recognizeFinal(e.panel, '  chào Việt Nam  ');
    await recognizeFinal(e.panel, '  chào Việt Nam  ');
    await expect(e.panel.getByRole('button', { name: 'Chèn vào bản nháp', exact: true })).toBeDisabled();
    await e.panel.getByRole('button', { name: '⏹ Dừng', exact: true }).click();
    await e.panel.getByRole('button', { name: 'Chèn vào bản nháp', exact: true }).click();
    await expect(e.panel.getByRole('button', { name: 'Chèn vào bản nháp', exact: true })).toBeDisabled();
  }
  await e.panel.getByRole('tab', { name: 'Bản nháp', exact: true }).click();
  await expect(e.panel.locator('textarea')).toHaveValue('  chào Việt Nam    chào Việt Nam  ');
  await e.panel.getByTestId('insert-messenger').click();
  await expect(e.panel.getByTestId('insert-messenger')).toContainText('Đã chèn');
  const visible = () => e.messenger.getByRole('textbox').evaluate(el => (el as HTMLElement).innerText.replace(/\u00a0/g, ' '));
  expect(await visible()).toBe('  chào Việt Nam    chào Việt Nam  ');
  await e.panel.getByTestId('insert-messenger').click();
  expect(await visible()).toBe('  chào Việt Nam    chào Việt Nam  ');
});

test('thread navigation cancels STT and late results cannot change the retained draft', async ({ extension: e }) => {
  await installSyntheticStt(e.panel);
  await e.panel.getByRole('tab', { name: 'Bản nháp', exact: true }).click();
  await expect(e.panel.getByTestId('draft-recipient')).toHaveText('Nguyễn Văn A');
  await e.panel.locator('textarea').fill('draft for A');
  await e.panel.getByRole('tab', { name: 'Giọng nói', exact: true }).click();
  await e.panel.getByRole('button', { name: '🎙 Bắt đầu ghi âm', exact: true }).click();
  await expect(e.panel.getByText('Đang nghe', { exact: true })).toBeVisible();
  await recognizeFinal(e.panel, 'old recipient transcript');
  await e.messenger.evaluate(() => {
    const input = document.querySelector('[contenteditable="true"]')!;
    input.replaceWith(input.cloneNode(false));
    document.querySelector('#thread-title')!.textContent = 'Trần Thị B';
    history.pushState({}, '', '/messages/t/fixture-b');
  });
  await expect.poll(() => e.panel.evaluate(() => (window as unknown as { echoRecognition: { aborted: boolean } }).echoRecognition.aborted)).toBe(true);
  await recognizeFinal(e.panel, 'late transcript must be ignored');
  await expect(e.panel.getByRole('button', { name: 'Chèn vào bản nháp', exact: true })).toBeDisabled();
  // A new recording for B must not be combined with the retained draft for A.
  await e.panel.getByRole('button', { name: '🎙 Bắt đầu ghi âm', exact: true }).click();
  await expect(e.panel.getByText('Đang nghe', { exact: true })).toBeVisible();
  await recognizeFinal(e.panel, 'transcript for B');
  await e.panel.getByRole('button', { name: '⏹ Dừng', exact: true }).click();
  await e.panel.getByRole('button', { name: 'Chèn vào bản nháp', exact: true }).click();
  await expect(e.panel.locator('.notice.warn').filter({ hasText: 'bản nháp dành cho người khác' })).toBeVisible();
  await expect(e.panel.getByText('transcript for B', { exact: true })).toBeVisible();
  await e.panel.getByRole('tab', { name: 'Bản nháp', exact: true }).click();
  await expect(e.panel.locator('textarea')).toHaveValue('draft for A');
  await e.panel.getByTestId('insert-messenger').click();
  await expect(e.messenger.getByRole('textbox')).toHaveText('');
});

test('microphone denial leaves manual drafting usable', async ({ extension: e }) => {
  await e.panel.evaluate(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true,
      value: () => Promise.reject(new DOMException('Synthetic denial', 'NotAllowedError')) });
  });
  await e.panel.getByRole('tab', { name: 'Giọng nói', exact: true }).click();
  await e.panel.getByRole('button', { name: '🎙 Bắt đầu ghi âm', exact: true }).click();
  await expect(e.panel.locator('.notice.danger')).toContainText('Không truy cập được microphone');
  await e.panel.getByRole('tab', { name: 'Bản nháp', exact: true }).click();
  await e.panel.locator('textarea').fill('Nhập tay vẫn dùng được');
  await expect(e.panel.locator('textarea')).toHaveValue('Nhập tay vẫn dùng được');
});

test('modern DOM seeds a silent baseline, then delivers only new messages with observed pipeline counts', async ({ extension: e }) => {
  await e.messenger.goto('https://www.facebook.com/messages/e2ee/t/modern-a');
  await e.panel.getByRole('button', { name: 'Bắt đầu theo dõi', exact: true }).click();
  await e.panel.getByRole('tab', { name: 'Hội thoại', exact: true }).click();
  await expect(e.panel.locator('.messages > .bubble')).toHaveCount(0);
  expect((await snapshot(e.panel)).diagnostics).toMatchObject({ baselineMessageCount: 4, newMessagesEmittedCount: 0 });
  await e.messenger.evaluate(() => {
    const list = document.querySelector('#thread-scroll')!;
    for (const original of Array.from(list.children)) {
      const row = original.cloneNode(true) as HTMLElement;
      row.setAttribute('data-message-id', `post-baseline:${row.getAttribute('data-message-id')}`);
      list.append(row);
    }
  });
  await expect(e.panel.locator('.messages > .bubble')).toHaveCount(4);
  await expect(e.panel.locator('.messages > .bubble').nth(0)).toContainText('Tin nhắn hiện có');
  await expect(e.panel.locator('.messages > .bubble').nth(0)).toContainText('10:30');
  await expect(e.panel.locator('.messages > .bubble').nth(1)).toHaveClass(/outgoing/);
  await expect(e.panel.locator('.messages > .bubble').nth(2)).toContainText('dòng một\ndòng hai');
  await expect(e.panel.locator('.messages')).not.toContainText('SIDEBAR');
  await expect(e.panel.locator('.messages')).not.toContainText('Thích 2');
  await e.messenger.evaluate(() => {
    for (let i = 0; i < 4; i++) {
      const row = document.createElement('div'); row.className = 'msg-row in';
      row.innerHTML = '<div class="msg-wrapper"><div class="msg-bubble"><span dir="auto">OK</span></div></div>';
      document.querySelector('#thread-scroll')!.append(row);
    }
  });
  await expect(e.panel.locator('.messages > .bubble')).toHaveCount(8);
  const getSnapshot = () => e.panel.evaluate(() => chrome.runtime.sendMessage({ type: 'echo:getState' }));
  await expect.poll(async () => (await getSnapshot()).diagnostics.lastStatus, { timeout: 8000 }).toBe('already-ingested');
  await expect(e.panel.locator('.messages > .bubble')).toHaveCount(8);
  await e.panel.getByRole('tab', { name: 'Chẩn đoán', exact: true }).click();
  await expect(e.panel.getByTestId('content-ready')).toHaveText('Sẵn sàng');
  await expect(e.panel.getByTestId('adapter-strategy')).toHaveText('scroller');
  await expect(e.panel.getByTestId('conversation-key')).toHaveText('thread:modern-a');
  for (const id of ['received-count', 'rendered-count', 'delivered-count', 'new-emitted-count']) {
    await expect(e.panel.getByTestId(id)).toHaveText('8');
  }
  for (const id of ['candidate-count', 'parsed-count', 'deduplicated-count']) await expect(e.panel.getByTestId(id)).toHaveText('12');
  await expect(e.panel.getByTestId('baseline-count')).toHaveText('4');
  await expect(e.panel.getByTestId('known-count')).toHaveText('12');
  await expect(e.panel.getByTestId('rejected-count')).toHaveText('0');
  await expect(e.panel.getByTestId('last-success')).not.toHaveText('—');
  await e.panel.getByRole('button', { name: 'Dừng theo dõi', exact: true }).click();
  const stopped = await getSnapshot();
  expect(stopped.diagnostics.lastStatus).toBe('stopped');
  await e.messenger.evaluate(() => document.querySelector('#thread-scroll')!.append(document.createTextNode('Synthetic post-stop change')));
  await e.messenger.waitForTimeout(900);
  const after = await getSnapshot();
  expect(after.diagnostics.scanCount).toBe(stopped.diagnostics.scanCount);
  expect(after.messages).toEqual([]);
  expect(e.errors).toEqual([]);
});

test('modern E2EE navigation holds stale content and isolates a new thread', async ({ extension: e }) => {
  await e.messenger.goto('https://www.facebook.com/messages/e2ee/t/modern-a');
  await e.panel.getByRole('button', { name: 'Bắt đầu theo dõi', exact: true }).click();
  await e.panel.getByRole('tab', { name: 'Hội thoại', exact: true }).click();
  await e.messenger.evaluate(() => {
    const row = document.querySelector('[data-message-id="modern-1"]')!.cloneNode(true) as HTMLElement;
    row.setAttribute('data-message-id', 'new-a'); document.querySelector('#thread-scroll')!.append(row);
  });
  await expect(e.panel.locator('.messages > .bubble')).toHaveCount(1);
  await e.messenger.evaluate(() => history.pushState({}, '', '/messages/e2ee/t/modern-b'));
  await expect(e.panel.locator('.messages > .bubble')).toHaveCount(0);
  await e.messenger.waitForTimeout(1500);
  await expect(e.panel.locator('.messages > .bubble')).toHaveCount(0);
  await e.messenger.evaluate(() => {
    document.querySelector('#thread-title')!.textContent = 'Second synthetic recipient';
    document.querySelector('#thread-scroll')!.innerHTML = '<div class="msg-row in" data-message-id="b1"><div class="msg-wrapper"><div class="msg-bubble"><span dir="auto">Chỉ thuộc B</span></div></div></div>';
  });
  await expect.poll(async () => (await snapshot(e.panel)).diagnostics.baselineEstablished).toBe(true);
  await expect(e.panel.locator('.messages > .bubble')).toHaveCount(0);
  await e.messenger.evaluate(() => {
    const row = document.querySelector('[data-message-id="b1"]')!.cloneNode(true) as HTMLElement;
    row.setAttribute('data-message-id', 'new-b'); document.querySelector('#thread-scroll')!.append(row);
  });
  await expect(e.panel.locator('.messages > .bubble')).toHaveCount(1);
  await expect(e.panel.locator('.messages')).toContainText('Chỉ thuộc B');
  await expect(e.panel.locator('.messages')).not.toContainText('Tin nhắn hiện có');
});

test('modern list replacement recovers on the five-second reconciliation timer', async ({ extension: e }) => {
  await e.messenger.goto('https://www.facebook.com/messages/e2ee/t/modern-a');
  await e.panel.getByRole('button', { name: 'Bắt đầu theo dõi', exact: true }).click();
  await expect(e.panel.locator('.messages > .bubble')).toHaveCount(0);
  await e.messenger.evaluate(() => {
    const list = document.querySelector('#thread-scroll')!;
    const next = list.cloneNode(true) as HTMLElement;
    next.insertAdjacentHTML('beforeend', '<div class="msg-row in" data-message-id="new"><div class="msg-wrapper"><div class="msg-bubble"><span dir="auto">Đối soát hiện đại</span></div></div></div>');
    list.replaceWith(next);
  });
  await expect(e.panel.locator('.messages > .bubble')).toHaveCount(1, { timeout: 7500 });
  await e.panel.getByRole('tab', { name: 'Hội thoại', exact: true }).click();
  await expect(e.panel.locator('.messages')).toContainText('Đối soát hiện đại');
});

test('distinguishes a connected Messenger tab from an absent content script without mocking messaging', async ({ extension: e }) => {
  // The content script does not match /not-messenger. An SPA URL change does
  // not inject a missing content script, just as after a late extension install.
  await e.messenger.goto('https://www.facebook.com/not-messenger');
  await e.messenger.evaluate(() => history.pushState({}, '', '/messages/e2ee/t/modern-uninjected'));
  await e.panel.getByRole('tab', { name: 'Chẩn đoán', exact: true }).click();
  await expect(e.panel.getByTestId('messenger-connected')).toHaveText('Đã kết nối');
  await expect(e.panel.getByTestId('content-ready')).toHaveText('Chưa phản hồi');
  await expect(e.panel.locator('main')).toContainText('content script chưa phản hồi');
});

test('does not credit panel delivery when no real panel can acknowledge the snapshot', async ({ extension: e }) => {
  await e.panel.getByRole('button', { name: 'Bắt đầu theo dõi', exact: true }).click();
  await expect.poll(async () => (await e.panel.evaluate(() => chrome.runtime.sendMessage({ type: 'echo:getState' }))).diagnostics.deliveryState).toBe('delivered');
  await e.panel.close();
  await e.messenger.bringToFront();
  const snapshot = () => e.worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return chrome.tabs.sendMessage(tab.id!, { type: 'echo:getState' });
  });
  const previous = await snapshot();
  await expect.poll(async () => (await snapshot()).diagnostics.deliveryState, { timeout: 7500 }).toBe('panel-unavailable');
  const after = await snapshot();
  expect(after.diagnostics.lastSentAt).toBe(previous.diagnostics.lastSentAt);
  expect(after.diagnostics.lastDeliveryError).toBeTruthy();
});

test('observed log/scroller nesting excludes sender headings and resolves the distant thread header', async ({ extension: e }) => {
  await e.messenger.goto('https://www.facebook.com/messages/e2ee/t/modern-observed');
  await e.messenger.evaluate(() => {
    const thread = document.querySelector('#thread')!;
    const list = document.querySelector('#thread-scroll')!;
    const composer = document.querySelector('#composer')!;
    const group = document.createElement('div'); group.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0';
    thread.append(group); group.append(list, composer);
    let current = group;
    for (let i = 0; i < 7; i++) {
      const next = document.createElement('div'); next.style.cssText = group.style.cssText;
      next.append(...Array.from(current.childNodes)); current.append(next); current = next;
    }
    const log = document.createElement('div'); log.setAttribute('role', 'log');
    log.style.cssText = 'display:flex;flex:1;min-height:0;overflow:hidden';
    list.replaceWith(log); log.append(list);
    for (const row of list.querySelectorAll('.msg-row')) row.insertAdjacentHTML('afterbegin', '<h4 dir="auto" style="position:absolute">Synthetic sender</h4>');
    current.insertAdjacentHTML('afterbegin', '<h3 style="position:absolute;width:1px;height:1px;clip:rect(0px,0px,0px,0px);clip-path:inset(50%)">Tin nhắn</h3>');
  });
  await e.panel.getByRole('button', { name: 'Bắt đầu theo dõi', exact: true }).click();
  await e.panel.getByRole('tab', { name: 'Hội thoại', exact: true }).click();
  await expect(e.panel.locator('.messages > .bubble')).toHaveCount(0);
  await e.messenger.evaluate(() => {
    const row = document.querySelector('[data-message-id="modern-1"]')!.cloneNode(true) as HTMLElement;
    row.setAttribute('data-message-id', 'new-observed'); document.querySelector('#thread-scroll')!.append(row);
  });
  await expect(e.panel.locator('.messages > .bubble')).toHaveCount(1);
  await expect(e.panel.locator('.messages')).not.toContainText('Synthetic sender');
  await expect(e.panel.locator('.messages > .bubble').nth(0)).toContainText('Tin nhắn hiện có');
  const state = await e.panel.evaluate(() => chrome.runtime.sendMessage({ type: 'echo:getState' }));
  expect(state.conversation.label).toBe('Synthetic test recipient');
  expect(state.diagnostics.strategy).toBe('semantic-log');
  expect(state.diagnostics.lastParsed).toBe(5);
  expect(e.errors).toEqual([]);
});

test('scrolling older history and rerendering it does not surface fake new messages', async ({ extension: e }) => {
  await e.messenger.goto('https://www.facebook.com/messages/e2ee/t/modern-history');
  await e.panel.getByRole('button', { name: 'Bắt đầu theo dõi', exact: true }).click();
  expect((await snapshot(e.panel)).diagnostics.baselineMessageCount).toBe(4);
  await e.messenger.evaluate(() => {
    const list = document.querySelector('#thread-scroll')!;
    for (let i = 0; i < 25; i++) {
      const row = document.createElement('div'); row.className = 'msg-row in'; row.setAttribute('data-message-id', `history-${i}`);
      row.innerHTML = '<div class="msg-wrapper"><div class="msg-bubble"><span dir="auto">Historical backfill</span></div></div>';
      list.prepend(row);
    }
    list.scrollTop = 0;
  });
  await expect.poll(async () => (await snapshot(e.panel)).diagnostics.suppressedBackfillCount).toBe(25);
  await expect(e.panel.locator('.messages > .bubble')).toHaveCount(0);
  await e.messenger.evaluate(() => {
    const list = document.querySelector('#thread-scroll')!;
    list.replaceChildren(...Array.from(list.children).map(el => el.cloneNode(true)));
  });
  await expect.poll(async () => (await snapshot(e.panel)).diagnostics.lastDuplicates).toBe(29);
  await expect(e.panel.locator('.messages > .bubble')).toHaveCount(0);
  await e.messenger.evaluate(() => {
    const list = document.querySelector('#thread-scroll')!; list.scrollTop = list.scrollHeight;
    const row = document.createElement('div'); row.className = 'msg-row out'; row.setAttribute('data-message-id', 'post-history-new');
    row.innerHTML = '<div class="msg-wrapper"><div class="msg-bubble"><span dir="auto">Only new after history</span></div></div>'; list.append(row);
  });
  await e.panel.getByRole('tab', { name: 'Hội thoại', exact: true }).click();
  await expect(e.panel.locator('.messages > .bubble')).toHaveCount(1);
  await expect(e.panel.locator('.messages')).toContainText('Only new after history');
  await expect(e.panel.locator('.messages')).not.toContainText('Historical backfill');
});

test('Pause/Resume preserves the baseline and catches only a newly appended suffix', async ({ extension: e }) => {
  await e.messenger.goto('https://www.facebook.com/messages/e2ee/t/modern-pause');
  await e.panel.getByRole('button', { name: 'Bắt đầu theo dõi', exact: true }).click();
  const before = await snapshot(e.panel);
  await e.panel.getByRole('button', { name: 'Tạm dừng', exact: true }).click();
  await e.messenger.evaluate(() => {
    const list = document.querySelector('#thread-scroll')!;
    const old = document.querySelector('[data-message-id="modern-1"]')!.cloneNode(true) as HTMLElement;
    old.setAttribute('data-message-id', 'pause-history'); list.prepend(old);
    const fresh = document.querySelector('[data-message-id="modern-4"]')!.cloneNode(true) as HTMLElement;
    fresh.setAttribute('data-message-id', 'pause-new'); list.append(fresh);
  });
  await e.messenger.waitForTimeout(700);
  const paused = await snapshot(e.panel);
  expect(paused.monitoring).toBe('paused'); expect(paused.diagnostics.scanCount).toBe(before.diagnostics.scanCount);
  expect(paused.messages).toEqual([]);
  await e.panel.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
  await expect(e.panel.locator('.messages > .bubble')).toHaveCount(1);
  const resumed = await snapshot(e.panel);
  expect(resumed.diagnostics.monitoringSessionStartedAt).toBe(before.diagnostics.monitoringSessionStartedAt);
  expect(resumed.diagnostics.baselineMessageCount).toBe(4);
  expect(resumed.diagnostics.suppressedBackfillCount).toBe(1);
  expect(resumed.messages.map((m: { text: string }) => m.text)).toEqual(['OK']);
});

test('Stop/Start creates a new silent baseline including messages tracked in the previous session', async ({ extension: e }) => {
  await e.panel.getByRole('button', { name: 'Bắt đầu theo dõi', exact: true }).click();
  await appendClassic(e.messenger, 'Later identical text', 'first-later');
  await expect(e.panel.locator('.messages > .bubble')).toHaveCount(1);
  await e.panel.getByRole('button', { name: 'Dừng theo dõi', exact: true }).click();
  await expect(e.panel.locator('.messages > .bubble')).toHaveCount(0);
  await e.panel.getByRole('button', { name: 'Bắt đầu theo dõi', exact: true }).click();
  const restarted = await snapshot(e.panel);
  expect(restarted.diagnostics).toMatchObject({ baselineEstablished: true, baselineMessageCount: 4, newMessagesEmittedCount: 0 });
  expect(restarted.messages).toEqual([]);
  await appendClassic(e.messenger, 'Later identical text', 'second-later');
  await e.panel.getByRole('tab', { name: 'Hội thoại', exact: true }).click();
  await expect(e.panel.locator('.messages > .bubble')).toHaveCount(1);
  expect((await snapshot(e.panel)).diagnostics.newMessagesEmittedCount).toBe(1);
});

test('query and E2EE route changes for the same thread do not reset its baseline or tracked output', async ({ extension: e }) => {
  await e.panel.getByRole('button', { name: 'Bắt đầu theo dõi', exact: true }).click();
  await appendClassic(e.messenger, 'Keep this new message', 'same-thread-new');
  await expect(e.panel.locator('.messages > .bubble')).toHaveCount(1);
  const before = await snapshot(e.panel);
  await e.messenger.evaluate(() => history.pushState({}, '', '/messages/e2ee/t/fixture-a?view=changed#same-thread'));
  await e.messenger.waitForTimeout(1300);
  const after = await snapshot(e.panel);
  expect(after.diagnostics.monitoringSessionStartedAt).toBe(before.diagnostics.monitoringSessionStartedAt);
  expect(after.diagnostics.baselineEstablishedAt).toBe(before.diagnostics.baselineEstablishedAt);
  expect(after.messages.map((m: { text: string }) => m.text)).toEqual(['Keep this new message']);
});

test('inserts the draft into the selected Messenger composer without sending', async ({ extension: e }) => {
  await e.messenger.bringToFront();
  await e.panel.getByRole('tab', { name: 'Bản nháp', exact: true }).click();
  await expect(e.panel.getByTestId('draft-recipient')).toHaveText('Nguyễn Văn A');
  const composer = e.messenger.getByRole('textbox');
  expect(await composer.textContent()).toBe('');
  await e.messenger.evaluate(() => {
    const send = document.createElement('button'); send.textContent = 'Gửi';
    send.addEventListener('click', () => { document.body.dataset.sent = 'yes'; });
    document.querySelector('#composer')!.append(send);
  });
  await e.panel.locator('textarea').fill('Xin chào, tôi nhận được tin của bạn.');
  await e.panel.getByTestId('insert-messenger').click();
  await expect(e.panel.getByRole('button', { name: '✓ Đã chèn vào Messenger' })).toBeVisible();
  await expect(composer).toHaveText('Xin chào, tôi nhận được tin của bạn.');
  // A second click must not duplicate the text already in the composer.
  await e.panel.getByTestId('insert-messenger').click();
  await expect(composer).toHaveText('Xin chào, tôi nhận được tin của bạn.');
  // A real send target exists, but insertion must never invoke it.
  expect(await e.messenger.evaluate(() => document.body.dataset.sent)).toBeUndefined();
  expect(await e.panel.getByRole('button', { name: /^Gửi$/ }).count()).toBe(0);
});

test('composer insertion refuses when the selected thread changed', async ({ extension: e }) => {
  await e.panel.getByRole('tab', { name: 'Bản nháp', exact: true }).click();
  await expect(e.panel.getByTestId('draft-recipient')).toHaveText('Nguyễn Văn A');
  await e.panel.locator('textarea').fill('Nhắn cho A');
  const status = await e.panel.evaluate(() => chrome.runtime.sendMessage({ type: 'echo:composerStatus' }));
  const draft = (text: string, expectedKey: string, mode: 'append' | 'replace' = 'append') =>
    e.panel.evaluate((payload) => chrome.runtime.sendMessage(payload), {
      type: 'echo:insertDraft', text, mode, expectedKey, expectedTabId: status.tabId,
    }) as Promise<{ ok: boolean; error: string | null }>;
  const composer = e.messenger.getByRole('textbox');

  // The live thread is fixture-a. A stale expectedKey (fixture-b) is refused
  // and must not write anything.
  const stale = await draft('Nhắn cho B', 'thread:fixture-b');
  expect(stale).toMatchObject({ ok: false, error: 'conversation-changed' });
  await expect(composer).toHaveText('');
  await expect(e.panel.locator('textarea')).toHaveValue('Nhắn cho A');

  // The matching key succeeds.
  const ok = await draft('Nhắn cho A', 'thread:fixture-a');
  expect(ok).toMatchObject({ ok: true });
  await expect(composer).toHaveText('Nhắn cho A');

  // Reset the composer so the next step starts from a clean placeholder.
  await e.messenger.evaluate(() => {
    (document.querySelector('[contenteditable="true"]') as HTMLElement).textContent = '';
  });

  // The user now switches the live thread to fixture-b.
  await e.messenger.evaluate(() => {
    document.querySelector('#message-list')!.replaceChildren();
    document.querySelector('#thread-title')!.textContent = 'Trần Thị B';
    history.pushState({}, '', '/messages/t/fixture-b');
  });

  // The same draft, still carrying the old thread key, is refused and never
  // leaks into the newly selected thread's composer.
  const rejected = await draft('Nhắn cho A', 'thread:fixture-a');
  expect(rejected).toMatchObject({ ok: false, error: 'conversation-changed' });
  await expect(composer).toHaveText('');

  // The draft survives the refused insertion.
  await expect(e.panel.locator('textarea')).toHaveValue('Nhắn cho A');
  // Exercise the UI after its live state has caught up, too: it must retain
  // the original draft recipient rather than silently adopt the new thread.
  await expect(e.panel.getByTestId('confirm-recipient')).toBeVisible();
  await e.panel.getByTestId('insert-messenger').click();
  await expect(e.panel.locator('.notice.danger')).toContainText('Cuộc trò chuyện');
  await expect(composer).toHaveText('');
  await expect(e.panel.locator('textarea')).toHaveValue('Nhắn cho A');
});

test('existing composer draft text is preserved in append mode', async ({ extension: e }) => {
  await e.messenger.bringToFront();
  // Give the composer a real draft (not a placeholder).
  await e.messenger.evaluate(() => {
    const composer = document.querySelector('[contenteditable="true"]');
    composer!.textContent = 'bản nháp sẵn có';
  });
  await e.panel.getByRole('tab', { name: 'Bản nháp', exact: true }).click();
  await expect(e.panel.getByTestId('draft-recipient')).toHaveText('Nguyễn Văn A');
  await e.panel.locator('textarea').fill('câu mới');
  await e.panel.getByTestId('insert-messenger').click();
  await expect(e.messenger.getByRole('textbox')).toHaveText('bản nháp sẵn có câu mới');
  await expect(e.panel.getByTestId('insert-messenger')).toContainText('Đã chèn');
  await e.panel.getByTestId('insert-messenger').click();
  await expect(e.messenger.getByRole('textbox')).toHaveText('bản nháp sẵn có câu mới');
});

test('a controlled editor rejecting insertion preserves the panel draft and reports failure', async ({ extension: e }) => {
  await e.messenger.evaluate(() => {
    const input = document.querySelector<HTMLElement>('[contenteditable="true"]')!;
    input.textContent = 'existing';
    input.addEventListener('input', () => queueMicrotask(() => { input.textContent = 'existing'; }));
  });
  await e.panel.getByRole('tab', { name: 'Bản nháp', exact: true }).click();
  await expect(e.panel.getByTestId('draft-recipient')).toHaveText('Nguyễn Văn A');
  await e.panel.locator('textarea').fill('keep this draft');
  await e.panel.getByTestId('insert-messenger').click();
  await expect(e.panel.locator('.notice.danger')).toContainText('không thành công');
  await expect(e.panel.locator('textarea')).toHaveValue('keep this draft');
  await expect(e.messenger.getByRole('textbox')).toHaveText('existing');
  await expect(e.panel.getByTestId('insert-messenger')).not.toContainText('Đã chèn');
});

test('textarea insertion notifies its controller and preserves whitespace; replace is explicit', async ({ extension: e }) => {
  await e.messenger.evaluate(() => {
    const input = document.createElement('textarea'); input.setAttribute('aria-label', 'Nhắn tin');
    input.value = 'old\n';
    input.addEventListener('input', () => { input.dataset.accepted = input.value; });
    document.querySelector('[contenteditable="true"]')!.replaceWith(input);
  });
  await e.panel.getByRole('tab', { name: 'Bản nháp', exact: true }).click();
  await expect(e.panel.getByTestId('draft-recipient')).toHaveText('Nguyễn Văn A');
  await e.panel.locator('textarea').fill('  mới  ');
  await e.panel.getByTestId('insert-messenger').click();
  await expect(e.panel.getByTestId('insert-messenger')).toContainText('Đã chèn');
  await expect(e.messenger.getByRole('textbox')).toHaveValue('old\n  mới  ');
  await expect(e.messenger.getByRole('textbox')).toHaveAttribute('data-accepted', 'old\n  mới  ');
  await e.panel.locator('textarea').fill('replacement');
  await e.panel.getByLabel('Cách chèn vào ô soạn').selectOption('replace');
  await e.panel.getByTestId('insert-messenger').click();
  await expect(e.messenger.getByRole('textbox')).toHaveValue('replacement');
});

test('ambiguous composers refuse insertion without losing either draft', async ({ extension: e }) => {
  await e.panel.getByRole('tab', { name: 'Bản nháp', exact: true }).click();
  await expect(e.panel.getByTestId('draft-recipient')).toHaveText('Nguyễn Văn A');
  await e.panel.locator('textarea').fill('panel draft');
  await e.messenger.evaluate(() => {
    const second = document.createElement('textarea'); second.value = 'second draft';
    document.querySelector('#composer')!.append(second);
  });
  await e.panel.getByTestId('insert-messenger').click();
  await expect(e.panel.locator('.notice.danger')).toContainText('Nhiều ô soạn');
  await expect(e.panel.locator('textarea')).toHaveValue('panel draft');
  await expect(e.messenger.getByRole('textbox').nth(0)).toHaveText('');
  await expect(e.messenger.getByRole('textbox').nth(1)).toHaveValue('second draft');
});

test('switching to another tab for the same thread cannot silently retarget the draft', async ({ extension: e }) => {
  await e.panel.getByRole('tab', { name: 'Bản nháp', exact: true }).click();
  await expect(e.panel.getByTestId('draft-recipient')).toHaveText('Nguyễn Văn A');
  await e.panel.locator('textarea').fill('original tab only');
  const other = await e.context.newPage();
  await other.goto('https://www.facebook.com/messages/t/fixture-a');
  await other.bringToFront();
  await e.panel.getByTestId('insert-messenger').click();
  await expect(e.panel.locator('.notice.danger')).toContainText('Cuộc trò chuyện');
  await expect(other.getByRole('textbox')).toHaveText('');
  await expect(e.messenger.getByRole('textbox')).toHaveText('');
  await expect(e.panel.locator('textarea')).toHaveValue('original tab only');
});

test('a retained draft can target a new thread only after explicit recipient confirmation', async ({ extension: e }) => {
  await e.panel.getByRole('tab', { name: 'Bản nháp', exact: true }).click();
  await expect(e.panel.getByTestId('draft-recipient')).toHaveText('Nguyễn Văn A');
  await e.panel.locator('textarea').fill('retained draft');
  await e.messenger.evaluate(() => {
    const old = document.querySelector('[contenteditable="true"]')!;
    old.replaceWith(old.cloneNode(false));
    document.querySelector('#message-list')!.replaceChildren();
    document.querySelector('#thread-title')!.textContent = 'Trần Thị B';
    history.pushState({}, '', '/messages/t/fixture-b');
  });
  await expect(e.panel.getByTestId('confirm-recipient')).toBeVisible();
  await e.panel.getByTestId('insert-messenger').click();
  await expect(e.messenger.getByRole('textbox')).toHaveText('');
  await expect(e.panel.locator('textarea')).toHaveValue('retained draft');
  await e.panel.getByTestId('confirm-recipient').click();
  await expect(e.panel.getByTestId('draft-recipient')).toHaveText('Trần Thị B');
  await e.panel.getByTestId('insert-messenger').click();
  await expect(e.messenger.getByRole('textbox')).toHaveText('retained draft');
});

test('three outgoing messages remain exactly three through delivery updates and rerenders', async ({ extension: e }) => {
  await e.messenger.goto('https://www.facebook.com/messages/e2ee/t/modern-outgoing');
  await e.panel.getByRole('button', { name: 'Bắt đầu theo dõi', exact: true }).click();
  await e.panel.getByRole('tab', { name: 'Hội thoại', exact: true }).click();
  await e.messenger.evaluate(() => {
    const list = document.querySelector('#thread-scroll')!;
    for (let i = 0; i < 3; i++) {
      const row = document.createElement('div'); row.className = 'msg-row out'; row.setAttribute('data-message-id', `outgoing-${i}`);
      row.setAttribute('aria-label', `Lúc 15:21, Bạn: Synthetic outgoing ${i}`);
      row.innerHTML = `<h4 dir="auto">Bạn đã gửi</h4><div class="msg-wrapper"><div class="msg-bubble"><span dir="auto">Synthetic outgoing ${i}</span></div></div><div role="status">Đang gửi</div>`;
      list.append(row);
    }
  });
  await expect(e.panel.locator('.messages > .bubble')).toHaveCount(3);
  const before = await snapshot(e.panel);
  expect(before.messages.map((m: { text: string; timestamp: string }) => [m.text, m.timestamp])).toEqual([
    ['Synthetic outgoing 0', '15:21'], ['Synthetic outgoing 1', '15:21'], ['Synthetic outgoing 2', '15:21'],
  ]);
  await e.messenger.evaluate(() => document.querySelectorAll('[data-message-id^="outgoing-"] [role="status"]').forEach(el => { el.textContent = 'Đã gửi'; }));
  await expect.poll(async () => (await snapshot(e.panel)).diagnostics.scanCount).toBeGreaterThan(before.diagnostics.scanCount);
  await expect(e.panel.locator('.messages > .bubble')).toHaveCount(3);
  const sent = await snapshot(e.panel);
  await e.messenger.evaluate(() => document.querySelectorAll('[data-message-id^="outgoing-"]').forEach(el => {
    const replacement = el.cloneNode(true) as HTMLElement;
    replacement.querySelector('[role="status"]')!.textContent = 'Đã nhận'; el.replaceWith(replacement);
  }));
  await expect.poll(async () => (await snapshot(e.panel)).diagnostics.scanCount).toBeGreaterThan(sent.diagnostics.scanCount);
  await expect(e.panel.locator('.messages > .bubble')).toHaveCount(3);
  await expect(e.panel.locator('.messages')).not.toContainText('Đã gửi');
  await expect(e.panel.locator('.messages')).not.toContainText('Đã nhận');
  expect((await snapshot(e.panel)).diagnostics.newMessagesEmittedCount).toBe(3);
  expect(e.errors).toEqual([]);
  await e.panel.screenshot({ path: '.artifacts/new-only-validation/three-outgoing-synthetic.png' });
});
