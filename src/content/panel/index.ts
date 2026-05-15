/**
 * 浮动面板对外的入口：renderPanel / extract & refine 流式补丁 / closePanel。
 */
import { STYLE } from './styles';
import type {
  ExtractStage,
  OneClickRewriteRandomness,
  PromptVersion,
  RefineStage,
  StrategyId,
} from '@/lib/types';
import { parseExtractJobSentinel, extractStreamSentinelForJob } from '@/lib/refineStreamVersion';
import { normalizeReferenceList, appendReferenceUrl } from '@/lib/referenceImages';
import {
  HOST_ID,
  host,
  shadow,
  panel,
  currentState,
  setHost,
  setShadow,
  setPanel,
  setCurrentState,
  panelActions,
  type PanelState,
  panelReferenceUrls,
  libraryStorageId,
  matchesExtractStreamRequest,
  panelExtractJobs,
  panelHasActiveRefine,
  panelRefineJobs,
  type PanelRefineJob,
} from './state';
import {
  manageLoadingTicker,
  manageLoadingStallWatchdog,
  stopLoadingTicker,
  stopLoadingStallWatchdog,
  applyLoadingPatch,
  manageRefineTicker,
  stopRefineTicker,
  applyRefinePatch,
} from './loading';
import { panelHtml } from './templates';
import {
  bindEvents,
  syncVersions,
  cancelPendingDirtyChromeDeferred,
  updateDirtyChromeImmediate,
  patchVersionList,
  syncEditorCharCount,
} from './events';

export { applyStoredPromptStrategy, applyStoredRewriteRandomness } from './events';
import {
  ensureGeometry,
  applyGeometryToPanel,
  scheduleReclampOnViewportChange,
} from './geometry';

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
    window.addEventListener('resize', scheduleReclampOnViewportChange);
    viewportListenerBound = true;
  }
  return { host: h, shadow: s };
}

/**
 * 8 个边缘 / 角落 resize 拉手。作为 panel 的直接子节点插入，
 * 由 events.ts:bindEdgeResize 监听 mousedown 实现任意方向缩放。
 *
 * 必须在 panelHtml 之后追加（而不是塞进 panelHtml 字符串里），这样换状态
 * （loading → success → error）整片重渲也不影响 handle 的存在与样式。
 */
const RESIZE_DIRS = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'] as const;
function appendResizeHandles(p: HTMLElement): void {
  for (const d of RESIZE_DIRS) {
    const h = document.createElement('div');
    h.className = `resize-handle ${d}`;
    h.dataset.dir = d;
    p.appendChild(h);
  }
}

/**
 * 面板主内容容器：header / body / panel-row 等全部放在其内。
 * `.panel` 根节点与 8 个 resize-handle 在会话内常驻，仅替换本容器 innerHTML，
 * 避免整节点 `panel.remove()` 造成的合成层闪断（计划：stable shell）。
 */
const PANEL_SURFACE_SELECTOR = '[data-role="panel-surface"]';

function setPanelSurfaceHtml(root: HTMLElement, state: PanelState): void {
  let surface = root.querySelector<HTMLElement>(PANEL_SURFACE_SELECTOR);
  if (!surface) {
    surface = document.createElement('div');
    surface.dataset.role = 'panel-surface';
    root.insertBefore(surface, root.firstChild);
  }
  surface.innerHTML = panelHtml(state);
}

export function renderPanel(state: PanelState): void {
  const { shadow } = ensureHost();
  setCurrentState(state);

  if (panel) {
    const surface = panel.querySelector(PANEL_SURFACE_SELECTOR);
    if (surface) {
      setPanelSurfaceHtml(panel, state);
      applyGeometryToPanel(panel, ensureGeometry());
      bindEvents(panel);
      if (state.status === 'loading') {
        syncEditorCharCount();
      }
      if (state.status === 'success') {
        updateDirtyChromeImmediate();
      }
      manageLoadingTicker(state);
      manageLoadingStallWatchdog(state);
      manageRefineTicker(state);
      return;
    }
  }

  // 无可用 shell（首次挂载或旧结构兜底）：创建完整 .panel。
  // 同页第二次起 panel 时不再播 panelIn（避免 loading→success 整段淡入像「闪一下」）。
  const hadExistingPanel = panel !== null;
  if (panel) panel.remove();
  const next = document.createElement('div');
  next.className = 'panel';
  setPanelSurfaceHtml(next, state);
  appendResizeHandles(next);
  shadow.appendChild(next);
  setPanel(next);
  // 应用上一次的位置 / 尺寸（首次渲染会用居中默认值）。
  // 必须在 bindEvents 之前调用，确保 ResizeObserver 挂载时尺寸已经稳定,
  // 避免拿到瞬时的 0 / 默认值，造成误存。
  applyGeometryToPanel(next, ensureGeometry());
  // 入场动画 panelIn 跑完后给 panel 打上 .mounted，永久禁用 animation。
  // 关键作用：之后用户拖动 header / resize 时会反复切换 .dragging / .resizing
  // class，CSS 里这两个 class 用 `animation: none !important` 强行打断动画；
  // 一旦松手 class 被移除，浏览器会把恢复有效的 animation 视为「新声明」
  // 而**重新从 from 状态播放一次**——视觉上就是「窗口闪一下/像被重建」。
  // 加上 .mounted 后 animation 永远是 none，移除 .dragging 不再触发重播。
  //
  // 兜底 setTimeout(260ms)：用户在 panelIn 还没播完（< 220ms）就立刻拖动 header
  // 会导致 animation 被中断、animationend 永远不触发；这种情况下也要按时挂上
  // .mounted，否则本次"修复"反而失效。重复 add class 是幂等的，安全。
  //
  // stable shell 路径下 .panel 节点不销毁，.mounted 一直保留，不再触发本节。
  const markMounted = () => next.classList.add('mounted');
  if (hadExistingPanel) {
    markMounted();
  } else {
    next.addEventListener('animationend', markMounted, { once: true });
    setTimeout(markMounted, 260);
  }
  bindEvents(next);
  if (state.status === 'loading') {
    syncEditorCharCount();
  }
  if (state.status === 'success') {
    updateDirtyChromeImmediate();
  }
  manageLoadingTicker(state);
  manageLoadingStallWatchdog(state);
  manageRefineTicker(state);
}

/**
 * 右键「添加到参考」：并入参考列表，进入 compose，不触发反推。
 */
export function appendReferenceFromBackground(imageUrl: string): void {
  const url = (imageUrl || '').trim();
  if (!url) return;
  const cur = currentState;
  if (!cur || cur.status === 'loading' || panelExtractJobs(cur).length > 0) {
    console.debug('[PromptExtracto] skip PANEL_APPEND_REFERENCE during loading');
    return;
  }

  const freshCompose = (
    requestId: string,
    urls: string[],
    inherit?: Pick<PanelState, 'strategy' | 'rewriteRandomness'>
  ): PanelState => {
    const list = normalizeReferenceList(urls);
    const first = list[0] || '';
    return {
      requestId,
      imageUrl: first,
      imageUrls: list,
      status: 'compose',
      strategy: inherit?.strategy,
      rewriteRandomness: inherit?.rewriteRandomness,
    };
  };

  if (!cur) {
    renderPanel(freshCompose(crypto.randomUUID(), [url]));
    return;
  }
  if (cur.status === 'success' || cur.status === 'error') {
    renderPanel(
      freshCompose(crypto.randomUUID(), [url], {
        strategy: cur.strategy,
        rewriteRandomness: cur.rewriteRandomness,
      })
    );
    return;
  }
  if (cur.status === 'compose') {
    const next = appendReferenceUrl(panelReferenceUrls(cur), url);
    renderPanel({
      ...cur,
      imageUrls: next,
      imageUrl: next[0] || cur.imageUrl,
    });
    return;
  }
}

/**
 * 处理 EXTRACT_PENDING：续跑合并状态；并行任务用 extractJobs[].streamRequestId 对齐。
 */
export function renderPanelForExtractPending(payload: {
  requestId: string;
  imageUrl: string;
  imageUrls?: string[];
  strategy?: StrategyId;
  rewriteRandomness?: OneClickRewriteRandomness;
}): void {
  const urls = normalizeReferenceList(
    payload.imageUrls?.length ? payload.imageUrls : [payload.imageUrl]
  );
  const primary = urls[0] || payload.imageUrl;
  const prev = currentState;
  const sid = payload.requestId;

  if (prev != null && matchesExtractStreamRequest(prev, sid)) {
    const ej = panelExtractJobs(prev).map((j) =>
      j.streamRequestId === sid
        ? { ...j, startedAt: Date.now(), stage: 'calling' as const, partial: undefined }
        : j
    );
    renderPanel({
      ...prev,
      imageUrl: primary,
      imageUrls: urls,
      extractJobs: ej,
      strategy: payload.strategy ?? prev.strategy,
      rewriteRandomness: payload.rewriteRandomness ?? prev.rewriteRandomness,
      linkedHistoryId: undefined,
    });
    return;
  }

  if (prev != null && prev.requestId === sid) {
    const versions = prev.versions || [];
    const hasHistory = versions.length > 0;
    renderPanel({
      ...prev,
      requestId: sid,
      imageUrl: primary,
      imageUrls: urls,
      extractJobs: [{ streamRequestId: sid, startedAt: Date.now() }],
      status: 'loading',
      stage: 'calling',
      startedAt: Date.now(),
      strategy: payload.strategy ?? prev.strategy,
      rewriteRandomness: payload.rewriteRandomness ?? prev.rewriteRandomness,
      prompt: undefined,
      error: undefined,
      draft: undefined,
      selectedVersionId: hasHistory ? extractStreamSentinelForJob(sid) : undefined,
      extractBaselinePrompt: undefined,
      partial: undefined,
      refineJobs: undefined,
      refineError: undefined,
      linkedHistoryId: undefined,
    });
    return;
  }

  renderPanel({
    requestId: sid,
    imageUrl: primary,
    imageUrls: urls,
    extractJobs: [{ streamRequestId: sid, startedAt: Date.now() }],
    status: 'loading',
    stage: 'calling',
    startedAt: Date.now(),
    strategy: payload.strategy,
    rewriteRandomness: payload.rewriteRandomness,
    linkedHistoryId: undefined,
  });
}

export function applyExtractStreamProgress(
  streamRequestId: string,
  patch: {
    stage?: ExtractStage;
    partial?: string;
    strategy?: StrategyId;
    provider?: string;
    model?: string;
    rewriteRandomness?: OneClickRewriteRandomness;
  }
): void {
  const cur = currentState;
  if (!cur) return;

  const ej = [...panelExtractJobs(cur)];
  const ix = ej.findIndex((j) => j.streamRequestId === streamRequestId);
  let merged: PanelState;

  if (ix >= 0) {
    ej[ix] = {
      ...ej[ix]!,
      ...(patch.stage !== undefined ? { stage: patch.stage } : {}),
      ...(patch.partial !== undefined ? { partial: patch.partial } : {}),
    };
    merged = { ...cur, extractJobs: ej };
  } else if (cur.status === 'loading' && cur.requestId === streamRequestId) {
    merged = {
      ...cur,
      ...(patch.stage !== undefined ? { stage: patch.stage } : {}),
      ...(patch.partial !== undefined ? { partial: patch.partial } : {}),
    };
  } else {
    return;
  }

  if (patch.strategy !== undefined) merged.strategy = patch.strategy;
  if (patch.provider !== undefined) merged.provider = patch.provider;
  if (patch.model !== undefined) merged.model = patch.model;
  if (patch.rewriteRandomness !== undefined) merged.rewriteRandomness = patch.rewriteRandomness;

  setCurrentState(merged);

  const lightExtract =
    merged.status === 'loading' &&
    (patch.stage !== undefined ||
      patch.partial !== undefined ||
      patch.strategy !== undefined ||
      patch.provider !== undefined ||
      patch.model !== undefined ||
      patch.rewriteRandomness !== undefined);

  if (lightExtract && panel) {
    applyLoadingPatch(merged);
    manageLoadingTicker(merged);
    manageLoadingStallWatchdog(merged);
    return;
  }

  if (merged.status === 'success' && panelExtractJobs(merged).length > 0) {
    renderPanel(merged);
    return;
  }

  renderPanel(merged);
}

export function applyExtractStreamResult(
  streamRequestId: string,
  result: {
    prompt: string;
    provider?: string;
    model?: string;
  }
): void {
  const cur = currentState;
  if (!cur) return;

  const prevEj = panelExtractJobs(cur);
  const ej = prevEj.filter((j) => j.streamRequestId !== streamRequestId);
  const wasTracked = prevEj.some((j) => j.streamRequestId === streamRequestId);
  const legacyMatch =
    cur.status === 'loading' && cur.requestId === streamRequestId && prevEj.length === 0;

  if (!wasTracked && !legacyMatch) return;

  let nextSel = cur.selectedVersionId;
  if (
    nextSel === extractStreamSentinelForJob(streamRequestId) ||
    parseExtractJobSentinel(nextSel ?? undefined) === streamRequestId
  ) {
    nextSel = undefined;
  }

  const merged: PanelState = {
    ...cur,
    extractJobs: ej.length ? ej : undefined,
    partial: undefined,
    stage: undefined,
    extractBaselinePrompt: undefined,
    prompt: result.prompt,
    draft: result.prompt,
    provider: result.provider ?? cur.provider,
    model: result.model ?? cur.model,
    status: 'success',
    error: undefined,
    linkedHistoryId: undefined,
    selectedVersionId: nextSel,
  };

  setCurrentState(merged);

  const shouldSync = !cur.linkedHistoryId && cur.status === 'loading';
  if (shouldSync) void syncVersions();

  renderPanel(currentState!);
}

export function applyExtractStreamError(streamRequestId: string, error: string): void {
  const cur = currentState;
  if (!cur) return;

  const prevEj = panelExtractJobs(cur);
  const ej = prevEj.filter((j) => j.streamRequestId !== streamRequestId);
  const wasTracked = prevEj.some((j) => j.streamRequestId === streamRequestId);
  const legacyMatch =
    cur.status === 'loading' && cur.requestId === streamRequestId && prevEj.length === 0;

  if (!wasTracked && !legacyMatch) return;

  let merged: PanelState = {
    ...cur,
    extractJobs: ej.length ? ej : undefined,
    partial: undefined,
    stage: undefined,
  };

  if (
    merged.status === 'loading' &&
    panelExtractJobs(merged).length === 0 &&
    !(merged.prompt ?? '').trim()
  ) {
    merged = { ...merged, status: 'error', error };
  }

  setCurrentState(merged);
  renderPanel(merged);
}

export function patchRefineProgress(payload: {
  historyId: string;
  refineJobId?: string;
  stage?: RefineStage;
  partial?: string;
}): void {
  const cur = currentState;
  if (!cur || libraryStorageId(cur) !== payload.historyId) return;

  const jobs = [...panelRefineJobs(cur)];
  if (jobs.length === 0) return;

  const patchJob = (j: PanelRefineJob): PanelRefineJob => ({
    ...j,
    ...(payload.stage !== undefined ? { stage: payload.stage } : {}),
    ...(payload.partial !== undefined ? { partial: payload.partial } : {}),
  });

  let nextJobs: PanelRefineJob[];
  if (payload.refineJobId) {
    const ix = jobs.findIndex((x) => x.jobId === payload.refineJobId);
    if (ix < 0) return;
    nextJobs = jobs.map((j, i) => (i === ix ? patchJob(j) : j));
  } else if (jobs.length === 1) {
    nextJobs = [patchJob(jobs[0]!)];
  } else {
    return;
  }

  const merged = { ...cur, refineJobs: nextJobs };
  setCurrentState(merged);

  const refineLightUpdate =
    merged.status === 'success' &&
    panelHasActiveRefine(merged) &&
    (payload.stage !== undefined || payload.partial !== undefined);

  if (refineLightUpdate && panel) {
    applyRefinePatch(merged);
    manageRefineTicker(merged);
    return;
  }
  renderPanel(merged);
}

/**
 * 同图识图：落库前把库中已有 versions 填进面板，避免 loading 阶段「历史版本 · 0」。
 */
export function applyHistoryPrefetch(
  requestId: string,
  payload: {
    storageId: string;
    versions: PromptVersion[];
    prompt: string;
  },
): void {
  const cur = currentState;
  if (!cur || (cur.requestId !== requestId && !matchesExtractStreamRequest(cur, requestId))) return;

  const hasHistory = payload.versions.length > 0;
  setCurrentState({
    ...cur,
    linkedHistoryId: payload.storageId,
    versions: payload.versions,
    selectedVersionId:
      cur.status === 'loading' && hasHistory
        ? extractStreamSentinelForJob(requestId)
        : cur.selectedVersionId,
  });
  patchVersionList();
}

/**
 * Background 端 persistHistory 完成后：对齐 storage id，并从并行队列移除已完成反推。
 */
export function applyHistoryReady(
  requestId: string,
  actualId: string,
  versions: PromptVersion[],
  prompt: string
): void {
  const cur = currentState;
  if (!cur) return;

  const hitStream = matchesExtractStreamRequest(cur, requestId);
  if (!hitStream && cur.requestId !== requestId) return;

  const nextEj = hitStream
    ? panelExtractJobs(cur).filter((j) => j.streamRequestId !== requestId)
    : panelExtractJobs(cur);

  const nextRequestId = cur.requestId === requestId ? actualId : cur.requestId;

  const nextDraft = cur.draft ?? prompt;
  const nextPrompt = cur.prompt ?? prompt;
  let nextSel = cur.selectedVersionId;
  if (
    nextSel === extractStreamSentinelForJob(requestId) ||
    parseExtractJobSentinel(nextSel ?? undefined) === requestId
  ) {
    nextSel = undefined;
  }
  if (nextSel && !versions.some((v) => v.id === nextSel)) {
    nextSel = undefined;
  }
  if (!nextSel) {
    nextSel =
      nextDraft === prompt
        ? versions[0]?.id
        : versions.find((v) => v.prompt === nextDraft)?.id;
  }

  setCurrentState({
    ...cur,
    requestId: nextRequestId,
    linkedHistoryId: undefined,
    versions,
    prompt: nextPrompt,
    draft: nextDraft,
    selectedVersionId: nextSel,
    extractJobs: nextEj.length ? nextEj : undefined,
  });
  renderPanel(currentState!);
}

export function closePanel(): void {
  cancelPendingDirtyChromeDeferred();
  stopLoadingTicker();
  stopLoadingStallWatchdog();
  stopRefineTicker();
  if (panel) {
    panel.remove();
    setPanel(null);
  }
  setCurrentState(null);
}

panelActions.renderPanel = renderPanel;
panelActions.closePanel = closePanel;
