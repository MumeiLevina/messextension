import { describe, expect, it } from 'vitest';
import { collapseWhitespace, normalizeForCompare, normalizeForDisplay, fingerprint } from '../../extension/src/core/text-normalizer';

describe('Vietnamese text handling', () => {
  it('preserves diacritics in the display form', () => {
    const text = 'Nguyễn Văn Anh đang học ở Đại học Bách Khoa';
    expect(normalizeForDisplay(text)).toBe(text);
  });

  it('treats composed and decomposed forms as equal when comparing', () => {
    const composed = 'Nguyễn';
    const decomposed = 'Nguyễn';
    expect(normalizeForCompare(composed)).toBe(normalizeForCompare(decomposed));
  });

  it('folds Vietnamese case for comparison but not for display', () => {
    expect(normalizeForCompare('Hà NỘI')).toBe('ha noi');
    expect(normalizeForDisplay('Hà NỘI')).toBe('Hà NỘI');
  });

  it('collapses whitespace including non-breaking spaces', () => {
    expect(collapseWhitespace('  a   b  ')).toBe('a b');
  });

  it('keeps meaningful interior line breaks', () => {
    expect(normalizeForDisplay('dòng 1\n\n\n\ndòng 2')).toBe('dòng 1\n\ndòng 2');
  });

  it('trims trailing newlines', () => {
    expect(normalizeForDisplay('xin chào\n')).toBe('xin chào');
  });

  it('truncates fingerprints deterministically', () => {
    const long = 'a'.repeat(100);
    expect(fingerprint(long, 10)).toHaveLength(10);
    expect(fingerprint('ngắn', 10)).toBe('ngắn');
  });

  it('keeps emoji intact', () => {
    const emoji = 'Chào 👋🏽 bạn 🇻🇳 nhé!';
    expect(normalizeForDisplay(emoji)).toBe(emoji);
    expect(normalizeForCompare(emoji)).toContain('👋');
  });
});
