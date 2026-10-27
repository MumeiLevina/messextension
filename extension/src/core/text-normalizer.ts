/**
 * Text normalization helpers.
 *
 * Vietnamese diacritics are preserved verbatim in the visible text; we only
 * collapse whitespace and apply Unicode-aware case folding for comparisons.
 */

/** Collapses runs of whitespace (including NBSP) into a single space. */
export function collapseWhitespace(text: string): string {
  return text.replace(/[\s\u00a0]+/g, ' ').trim();
}

/**
 * Normalizes text for identity comparison.
 *
 * Uses NFKD so that "Nguyễn" and "Nguyễn" (composed vs decomposed) compare
 * equal, and strips combining marks only for the *comparison* form — the
 * displayed text always keeps its original diacritics.
 */
export function normalizeForCompare(text: string): string {
  return collapseWhitespace(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Normalizes text for display inside a bubble while keeping meaningful line
 * breaks. A single trailing newline is dropped; interior breaks are kept.
 */
export function normalizeForDisplay(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Truncates for neighbour fingerprints without losing identity. */
export function fingerprint(text: string, max = 40): string {
  const n = collapseWhitespace(text).normalize('NFC').toLowerCase();
  return n.length <= max ? n : n.slice(0, max);
}
