/**
 * 浮动面板「多图参考」条目的上限与列表规范化（去重、截断）。
 */
export const MAX_REFERENCE_IMAGES = 8;

export function normalizeReferenceList(urls: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const u of urls) {
    const s = (u || '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= MAX_REFERENCE_IMAGES) break;
  }
  return out;
}

export function appendReferenceUrl(urls: readonly string[], url: string): string[] {
  return normalizeReferenceList([...urls, url]);
}

/** 解析 EXTRACT_PROMPT：优先 imageUrls，否则 [imageUrl]。 */
export function resolveExtractImageUrls(payload: {
  imageUrl?: string;
  imageUrls?: string[];
}): string[] {
  if (payload.imageUrls?.length) {
    return normalizeReferenceList(payload.imageUrls);
  }
  const one = (payload.imageUrl || '').trim();
  return one ? [one] : [];
}
