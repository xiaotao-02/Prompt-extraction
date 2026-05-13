/**
 * 浮动面板对外的 3 个公开 API：renderPanel / updatePanel / closePanel。
 * 这是 src/content/index.ts 唯一引用到的入口。
 */
import { STYLE } from './styles';
import type { PromptVersion } from '@/lib/types';
import {
  HOST_ID,
  host,
  shadow,
  panel,
  currentState,
  panelResizeObserver,
  setHost,
  setShadow,
  setPanel,
  setCurrentState,
  setPanelResizeObserver,
  panelActions,
  type PanelState,
} from './state';
import {
  manageLoadingTicker,
  stopLoadingTicker,
  applyLoadingPatch,
  manageRefineTicker,
  stopRefineTicker,
  applyRefinePatch,
} from './loading';
import { panelHtml } from './templates';
import { bindEvents, syncVersions } from './events';
import { ensureGeometry, applyGeometryToPanel, reclampOnViewportChange } from './geometry';

let viewportListenerBound = false;

function ensureHost(): { host: HTMLDivElement; shadow: ShadowRoot } {
  if (host && shadow) return { host, shadow };
  const h = document.createElement('div');
  h.id = HOST_ID;
  h.style.cssText = `
    position: fixed; inset: 0;
    z-index: 2147483647; width: 0; height: 0;
    color-scheme: light dark;
  `;
  const s = h.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = STYLE;
  s.appendChild(style);
  document.documentElement.appendChild(h);
  setHost(h);
  setShadow(s);
  // 视口尺寸变化时，把当前几何 clamp 回安全范围；避免「窗口缩小后面板留在屏幕外」。
  if (!viewportListenerBound) {
    window.addEventListener('resize', reclampOnViewportChange);
    viewportListenerBound = true;
  }
  return { host: h, shadow: s };
}

export function renderPanel(state: PanelState): void {
  const { shadow } = ensureHost();
  setCurrentState(state);
  if (panel) panel.remove();
  const next = document.createElement('div');
  next.className = 'panel';
  next.innerHTML = panelHtml(state);
  shadow.appendChild(next);
  setPanel(next);
  // 应用上一次的位置 / 尺寸（首次渲染会用居中默认值）。
  // 必须在 bindEvents 之前调用，确保 ResizeObserver 挂载时尺寸已经稳定，
  // 避免拿到瞬时的 0 / 默认值，造成误存。
  applyGeometryToPanel(next, ensureGeometry());
  bindEvents(next);
  manageLoadingTicker(state);
  manageRefineTicker(state);
}

export function updatePanel(requestId: string, patch: Partial<PanelState>): void {
  if (!currentState || currentState.requestId !== requestId) return;
  const prev = currentState;
  const merged = { ...prev, ...patch } as PanelState;
  setCurrentState(merged);

  if (patch.status === 'success') {
    void syncVersions(requestId);
  }

  const lightUpdate =
    prev.status === 'loading' &&
    merged.status === 'loading' &&
    patch.status === undefined &&
    (patch.stage !== undefined ||
      patch.partial !== undefined ||
      patch.strategy !== undefined);

  if (lightUpdate && panel) {
    applyLoadingPatch(merged);
    manageLoadingTicker(merged);
    return;
  }

  // refine 阶段的轻量刷新：refineLoading 期间的 stage / partial 增量只更新
  // 进度条 + hint + 流式 textarea，不重渲整面板，避免主 editor textarea 失焦
  // 和历史版本列表回滚到顶部。
  const refineLightUpdate =
    prev.status === 'success' &&
    merged.status === 'success' &&
    patch.status === undefined &&
    prev.refineLoading === true &&
    merged.refineLoading === true &&
    (patch.refineStage !== undefined || patch.refinePartial !== undefined);

  if (refineLightUpdate && panel) {
    applyRefinePatch(merged);
    manageRefineTicker(merged);
    return;
  }
  renderPanel(merged);
}

/**
 * Background 端 `persistHistory` 完成后通过 HISTORY_READY 调过来。
 *
 * 关键作用：当用户对**同一张图**反复反推时，addHistory 会把新结果合并到旧记录上，
 * storage 里真实存在的 id 仍是旧的 existing.id，但 background 当时是用一个新生成的
 * requestId 发的 EXTRACT_RESULT，content 持有的 currentState.requestId 是 storage
 * 里根本不存在的 id —— 后续 save / restore / syncVersions 全部 findIndex<0 静默失败，
 * 表现为「编辑保存后历史版本没更新」。
 *
 * 这里收到通知后直接把 currentState.requestId 切到 actualId，并把版本数组填好。
 * panel 本身不需要重建，只是改一下 state + 重渲染。
 */
export function applyHistoryReady(
  requestId: string,
  actualId: string,
  versions: PromptVersion[],
  prompt: string
): void {
  if (!currentState || currentState.requestId !== requestId) return;
  // 用户已经在编辑了就保留 draft；没编辑时 draft 跟着真实 prompt 走。
  // currentState.prompt 一般已经被 EXTRACT_RESULT 设过，但拿不到时用落库的 prompt 兜底。
  const nextDraft = currentState.draft ?? prompt;
  const nextPrompt = currentState.prompt ?? prompt;
  setCurrentState({
    ...currentState,
    requestId: actualId,
    versions,
    prompt: nextPrompt,
    draft: nextDraft,
  });
  renderPanel(currentState!);
}

export function closePanel(): void {
  stopLoadingTicker();
  stopRefineTicker();
  // 关掉用户拖右下角触发的 ResizeObserver；下次 renderPanel 时会重新挂载到新 div 上。
  if (panelResizeObserver) {
    panelResizeObserver.disconnect();
    setPanelResizeObserver(null);
  }
  if (panel) {
    panel.remove();
    setPanel(null);
  }
  setCurrentState(null);
}

panelActions.renderPanel = renderPanel;
panelActions.closePanel = closePanel;
