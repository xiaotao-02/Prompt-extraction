/**
 * 仅遍历可读的同源 iframe 子文档，避免跨域 SecurityError 与深层嵌套性能问题。
 */

/** 与 videoSegmentSample / index.ts 的扫描预算同一量级 */
export const MAX_SAME_ORIGIN_IFRAME_DEPTH = 5;
export const MAX_SAME_ORIGIN_IFRAME_TOTAL = 40;

/**
 * 深度优先遍历 `rootDoc` 及其中可达的同源子 document（含 `about:blank` 等同源内联页）。
 * `visit` 对每个 document 恰好调用一次（`WeakSet` 去重）。
 */
export function forEachAccessibleSameOriginDocument(
  rootDoc: Document,
  visit: (doc: Document) => void
): void {
  const seen = new WeakSet<Document>();
  let iframeSeen = 0;

  const walk = (doc: Document, depth: number): void => {
    if (depth > MAX_SAME_ORIGIN_IFRAME_DEPTH) return;
    if (seen.has(doc)) return;
    seen.add(doc);
    visit(doc);

    if (iframeSeen >= MAX_SAME_ORIGIN_IFRAME_TOTAL) return;

    for (const iframe of doc.querySelectorAll('iframe')) {
      if (iframeSeen >= MAX_SAME_ORIGIN_IFRAME_TOTAL) return;
      let child: Document | null = null;
      try {
        child = iframe.contentDocument;
      } catch {
        continue;
      }
      if (!child) continue;
      iframeSeen += 1;
      walk(child, depth + 1);
    }
  };

  walk(rootDoc, 0);
}
