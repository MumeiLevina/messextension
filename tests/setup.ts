/**
 * Vitest setup: provide the browser APIs jsdom does not implement that the
 * extension relies on.
 */
import { beforeEach, vi } from 'vitest';

// jsdom has no layout engine; the adapter only needs a stable shape.
if (!('getBoundingClientRect' in Element.prototype)) {
  (Element.prototype as unknown as { getBoundingClientRect: () => unknown }).getBoundingClientRect =
    function () {
    return { x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, toJSON: () => ({}) };
  };
}

// jsdom does not implement the clipboard API.
if (!navigator.clipboard) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn(async () => undefined) },
    configurable: true,
  });
}

// The content script and service worker import `chrome`; tests that exercise
// them install a stub. Provide a minimal default so imports do not throw.
if (typeof (globalThis as Record<string, unknown>).chrome === 'undefined') {
  Object.defineProperty(globalThis, 'chrome', {
    value: {
      runtime: {
        sendMessage: vi.fn(),
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        lastError: undefined,
      },
      tabs: { query: vi.fn(async () => []), sendMessage: vi.fn() },
      storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) } },
    },
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  document.body.innerHTML = '';
});
