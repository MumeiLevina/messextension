/**
 * Image preprocessing for OCR fallback.
 *
 * Messenger's chat bubbles are rendered as text on flat, solid backgrounds, so
 * the most valuable transforms are: grayscale, contrast stretch, and a gentle
 * threshold. We avoid binarisation that destroys anti-aliased Vietnamese
 * diacritics.
 */

/** Converts a PNG data URL into an ImageBitmap-like HTMLImageElement. */
export async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Không đọc được ảnh.'));
    img.src = dataUrl;
  });
}

export interface PreprocessOptions {
  grayscale?: boolean;
  /** Contrast enhancement factor; 1 = unchanged. */
  contrast?: number;
  /** Fixed threshold 0..255; when omitted a computed threshold is used. */
  threshold?: number;
  /** Invert before thresholding (for light text on dark bubbles). */
  invert?: boolean;
}

/**
 * Applies preprocessing on a canvas and returns the resulting PNG data URL.
 */
export async function preprocess(
  dataUrl: string,
  options: PreprocessOptions = {},
): Promise<string> {
  const { grayscale = true, contrast = 1.35, threshold, invert = false } = options;
  const img = await loadImage(dataUrl);

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Không tạo được canvas xử lý ảnh.');
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  // Pass 1: grayscale + contrast stretch.
  let min = 255;
  let max = 0;
  for (let i = 0; i < data.length; i += 4) {
    let v = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (grayscale) {
      data[i] = data[i + 1] = data[i + 2] = v;
    }
    if (invert) v = 255 - v;
    v = (v - 128) * contrast + 128;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    data[i] = data[i + 1] = data[i + 2] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  // Pass 2: optional threshold, otherwise leave the stretched image alone.
  if (threshold !== undefined) {
    for (let i = 0; i < data.length; i += 4) {
      const v = data[i] > threshold ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = v;
    }
  } else if (max - min > 24) {
    // Otsu-lite: split the histogram at its midpoint when the range is wide
    // enough that a global threshold is safe.
    const cut = (min + max) / 2;
    for (let i = 0; i < data.length; i += 4) {
      const v = data[i] > cut ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = v;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

/** Crops a region from a data URL, in CSS pixels of the source image. */
export async function crop(
  dataUrl: string,
  region: { x: number; y: number; width: number; height: number },
): Promise<string> {
  const img = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(region.width));
  canvas.height = Math.max(1, Math.round(region.height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Không tạo được canvas cắt ảnh.');
  ctx.drawImage(
    img,
    Math.round(region.x),
    Math.round(region.y),
    canvas.width,
    canvas.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas.toDataURL('image/png');
}

/**
 * Scales an image up. Small rendered text OCRs much better at 2x.
 */
export async function upscale(dataUrl: string, factor = 2): Promise<string> {
  if (factor <= 1) return dataUrl;
  const img = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth * factor;
  canvas.height = img.naturalHeight * factor;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Không tạo được canvas phóng to.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}
