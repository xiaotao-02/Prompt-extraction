import { describe, expect, it } from 'vitest';
import { appendReferenceUrl, normalizeReferenceList, resolveExtractImageUrls, MAX_REFERENCE_IMAGES } from './referenceImages';

describe('referenceImages', () => {
  it('normalizeReferenceList dedupes and caps', () => {
    const a = 'https://a/x.jpg';
    expect(normalizeReferenceList([a, a, ' ', a])).toEqual([a]);
    const many = Array.from({ length: MAX_REFERENCE_IMAGES + 3 }, (_, i) => `u${i}`);
    expect(normalizeReferenceList(many)).toHaveLength(MAX_REFERENCE_IMAGES);
  });

  it('appendReferenceUrl appends unique', () => {
    expect(appendReferenceUrl(['a'], 'b')).toEqual(['a', 'b']);
    expect(appendReferenceUrl(['a'], 'a')).toEqual(['a']);
  });

  it('resolveExtractImageUrls prefers imageUrls', () => {
    expect(
      resolveExtractImageUrls({
        imageUrl: 'https://single',
        imageUrls: ['https://a', 'https://b'],
      })
    ).toEqual(['https://a', 'https://b']);
    expect(resolveExtractImageUrls({ imageUrl: 'https://only' })).toEqual(['https://only']);
  });
});
