/**
 * OCR engine wrapper around Tesseract.js.
 *
 * The worker and the language data are bundled locally — no remote code is
 * executed and no image leaves the machine. Vietnamese (`vie`) is the primary
 * model; English is loaded as a helper for mixed-language screenshots.
 */

export interface OcrResult {
  text: string;
  /** Mean confidence, 0..100, as reported by Tesseract. */
  confidence: number;
  /** Wall-clock duration of the recognition pass. */
  durationMs: number;
}

type TesseractWorker = {
  recognize: (image: unknown) => Promise<{ data: { text: string; confidence: number } }>;
  setParameters: (params: Record<string, string>) => Promise<unknown>;
  terminate: () => Promise<unknown>;
};

type TesseractFactory = {
  createWorker: (
    lang: string,
    oem?: number,
    options?: Record<string, unknown>,
  ) => Promise<TesseractWorker>;
};

let workerPromise: Promise<TesseractWorker | null> | null = null;
let workerLang: string | null = null;

async function getFactory(): Promise<TesseractFactory | null> {
  try {
    const mod = await import('tesseract.js');
    return (mod.default ?? mod) as unknown as TesseractFactory;
  } catch {
    return null;
  }
}

export async function isOcrAvailable(): Promise<boolean> {
  return (await getOcrWorker()) !== null;
}

/**
 * Creates (or reuses) a worker. The worker is terminated by `disposeOcr`
 * so large image buffers are released after a session.
 */
export async function getOcrWorker(lang = 'vie+eng'): Promise<TesseractWorker | null> {
  if (workerPromise && workerLang === lang) return workerPromise;

  if (workerPromise) {
    const old = await workerPromise;
    await old?.terminate().catch(() => undefined);
  }

  const factory = await getFactory();
  if (!factory) return null;

  workerLang = lang;
  workerPromise = factory
    .createWorker(lang, 1, {
      // Bundle the worker and the language data locally.
      workerPath: chrome.runtime.getURL('ocr/worker.min.js'),
      corePath: chrome.runtime.getURL('ocr/core/tesseract-core-lstm.wasm.js'),
      langPath: chrome.runtime.getURL('ocr/tessdata'),
      workerBlobURL: false,
      cacheMethod: 'none',
      gzip: true,
      logger: () => undefined,
    })
    .then(async (worker) => {
      await worker.setParameters({
        preserve_interword_spaces: '1',
      });
      return worker;
    })
    .catch(() => null);

  return workerPromise;
}

/** Runs OCR on a data URL (PNG/JPEG). */
export async function recognize(dataUrl: string, lang = 'vie+eng'): Promise<OcrResult | null> {
  const worker = await getOcrWorker(lang);
  if (!worker) return null;

  const started = performance.now();
  try {
    const { data } = await worker.recognize(dataUrl);
    return {
      text: data.text ?? '',
      confidence: typeof data.confidence === 'number' ? data.confidence : 0,
      durationMs: performance.now() - started,
    };
  } catch {
    return null;
  }
}

/** Releases the worker and its memory. */
export async function disposeOcr(): Promise<void> {
  if (!workerPromise) return;
  const worker = await workerPromise;
  workerPromise = null;
  workerLang = null;
  await worker?.terminate().catch(() => undefined);
}
