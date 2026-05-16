import type { PanelState } from './state';
import { panelReferenceUrls } from './state';
import { MAX_REFERENCE_IMAGES, appendReferenceUrl, normalizeReferenceList } from '@/lib/referenceImages';

/**
 * 「反推进行中」右键追加参考时先入队（见 appendReferenceFromBackground），
 * 无进行中任务后再合并回 {@link PanelState.imageUrls}。
 */
const MAX_PENDING_APPEND = Math.max(MAX_REFERENCE_IMAGES, 16);
let queuedAppendUrls: string[] = [];

export function clearPendingAppendReferenceQueue(): void {
  queuedAppendUrls.length = 0;
}

export function enqueuePendingAppendReference(imageUrl: string): void {
  const u = (imageUrl || '').trim();
  if (!u || queuedAppendUrls.includes(u)) return;
  queuedAppendUrls.push(u);
  if (queuedAppendUrls.length > MAX_PENDING_APPEND) {
    queuedAppendUrls.splice(0, queuedAppendUrls.length - MAX_PENDING_APPEND);
  }
}

/** 并入当前列表并清空队列（仅应在一次应用点调用） */
export function mergePendingAppendUrlsInto(state: PanelState): PanelState {
  if (queuedAppendUrls.length === 0) return state;
  const urls = [...queuedAppendUrls];
  queuedAppendUrls.length = 0;
  let next = normalizeReferenceList(panelReferenceUrls(state));
  for (const raw of urls) {
    next = appendReferenceUrl(next, raw);
  }
  const first = next[0] || state.imageUrl;
  return { ...state, imageUrls: next, imageUrl: first };
}
