import {
  safeSendMessage,
  isExtensionContextValid,
  appendPromptVersionFromExtension,
  getHistoryItemFromExtension,
  removePromptVersionFromExtension,
  restorePromptVersionFromExtension,
} from '@/content/extensionBridge';
import type {
  OneClickRewriteRandomness,
  RefineResponse,
  RuntimeMessage,
  StrategyId,
} from '@/lib/types';
import {
  buildOneClickRewriteInstruction,
  makeRewriteNonce,
  normalizeOneClickRewriteRandomness,
  REWRITE_RANDOMNESS_LABELS,
} from '@/lib/oneClickRewrite';
import { STRATEGY_LABELS } from '@/lib/strategies-meta';
import {
  currentState,
  setCurrentState,
  panel,
  panelActions,
  panelGeometry,
  type PanelState,
  type PanelRefineJob,
  panelReferenceUrls,
  libraryStorageId,
  panelHasActiveRefine,
  panelRefineJobs,
  panelExtractJobs,
  matchesExtractStreamRequest,
  MAX_PARALLEL_PANEL_REFINES,
  MAX_PARALLEL_PANEL_EXTRACTS,
} from './state';
import { normalizeReferenceList, appendReferenceUrl, MAX_REFERENCE_IMAGES } from '@/lib/referenceImages';
import {
  updateGeometry,
  clampGeometry,
  expandPanelForSidebar,
  collapsePanelForSidebar,
  MIN_WIDTH,
  MIN_HEIGHT,
  VIEWPORT_MARGIN,
  getLayoutViewportBox,
} from './geometry';
import { buildVersionsListInnerHtml, loadingEditorDisplayedText, successEditorDisplayedText } from './templates';
import {
  EXTRACT_STREAM_VERSION_ID,
  REFINE_STREAM_VERSION_ID,
  extractStreamSentinelForJob,
  refineStreamSentinelForJob,
  parseExtractJobSentinel,
  parseRefineJobSentinel,
} from '@/lib/refineStreamVersion';
import { openOptionsMessage } from '@/lib/messaging/openSurfaces';

function renderPanel(...args: Parameters<typeof panelActions.renderPanel>) {
  return panelActions.renderPanel(...args);
}
function closePanel() {
  return panelActions.closePanel();
}

let dirtyVersionHighlightRaf = 0;

/** `.panel` 根上 resize/mousedown/click/input 只绑一次；panel-surface 内 HTML 替换不重绑。 */
const panelShellBound = new WeakSet<HTMLElement>();

export function cancelPendingDirtyChromeDeferred(): void {
  if (dirtyVersionHighlightRaf !== 0) {
    cancelAnimationFrame(dirtyVersionHighlightRaf);
    dirtyVersionHighlightRaf = 0;
  }
}

/**
 * 仅刷新和"是否脏"相关的 UI 部分，避免在每次按键时整片重渲染导致 textarea 失焦。
 *
 * 顺便同步历史版本列表的 .selected 高亮：editor 改字后，原本被高亮的那条
 * 可能不再匹配 draft；用户也可能改着改着又改回了某条版本的内容，需要重新
 * 把高亮挪到那条上。这个同步是纯 DOM 操作，不触发重渲。
 */
function syncDirtyHintsImmediate(): void {
  if (!panel || !currentState) return;
  const root = panel;
  const draft = currentState.draft ?? '';
  const dirty =
    panelHasActiveRefine(currentState) ? false : draft !== (currentState.prompt ?? '');
  const hint = root.querySelector<HTMLElement>('.dirty-hint');
  if (hint) hint.classList.toggle('show', dirty);
  const taEditor = root.querySelector<HTMLTextAreaElement>('[data-role="editor"]');
  const baselineRaw =
    currentState.status === 'success' && taEditor
      ? taEditor.value
      : draft || (currentState.prompt ?? '');
  const baselineEmpty = baselineRaw.trim().length === 0;
  const spinDisabled =
    panelRefineJobs(currentState).length >= MAX_PARALLEL_PANEL_REFINES || baselineEmpty;
  const setDisabled = (sel: string, disabled: boolean) => {
    const btn = root.querySelector<HTMLButtonElement>(sel);
    if (!btn) return;
    btn.disabled = disabled;
    btn.classList.toggle('disabled', disabled);
    if (sel.includes('save')) {
      btn.classList.toggle('primary', !disabled);
      btn.classList.toggle('ghost', disabled);
    }
  };
  setDisabled('[data-action="rewrite-spin"]', spinDisabled);
  const rrDd = root.querySelector<HTMLElement>('[data-role="rewrite-randomness-dropdown"]');
  const rrTrigger = rrDd?.querySelector<HTMLButtonElement>('.sd-trigger');
  if (rrTrigger) rrTrigger.disabled = spinDisabled;
  if (rrDd) rrDd.classList.toggle('is-disabled', spinDisabled);
  setDisabled('[data-action="save"]', !dirty);
  syncEditorCharCount();
}

/** 主编辑器字数（与 templates 首帧一致：按 Unicode 码位计数）。 */
export function syncEditorCharCount(): void {
  if (!panel) return;
  const editor = panel.querySelector<HTMLTextAreaElement>('[data-role="editor"]');
  const label = panel.querySelector<HTMLElement>('[data-role="editor-char-count"]');
  if (!editor || !label) return;
  const n = [...editor.value].length;
  label.textContent = `${n} 字`;
}

function syncVersionHighlightFromState(): void {
  if (!panel || !currentState) return;
  const draft = currentState.draft ?? '';
  const versions = currentState.versions || [];
  const sel = currentState.selectedVersionId;
  let matchedId: string | undefined;
  if (
    sel === REFINE_STREAM_VERSION_ID ||
    sel === EXTRACT_STREAM_VERSION_ID ||
    sel?.startsWith(`${REFINE_STREAM_VERSION_ID}:`) ||
    sel?.startsWith(`${EXTRACT_STREAM_VERSION_ID}:`)
  ) {
    matchedId = sel;
  } else if (sel) {
    const byId = versions.find((v) => v.id === sel);
    if (byId) matchedId = sel;
  }
  if (!matchedId) {
    matchedId = versions.find((v) => v.prompt === draft)?.id;
  }
  panel.querySelectorAll<HTMLElement>('.version-item').forEach((item) => {
    item.classList.toggle(
      'selected',
      !!matchedId && item.dataset.versionId === matchedId
    );
  });
}

/**
 * 编辑器连续输入等高噪声路径：脏提示即时刷新；版本列表 `.selected` 延后到动画帧，
 * 减少 textarea 打字时对每个 `.version-item` 的遍历。
 */
export function updateDirtyChrome(): void {
  syncDirtyHintsImmediate();
  cancelPendingDirtyChromeDeferred();
  dirtyVersionHighlightRaf = requestAnimationFrame(() => {
    dirtyVersionHighlightRaf = 0;
    syncVersionHighlightFromState();
  });
}

/** DOM 结构刚替换或与用户单击强一致时需同步；取消排队的 RAF 再高亮一遍。 */
export function updateDirtyChromeImmediate(): void {
  cancelPendingDirtyChromeDeferred();
  syncDirtyHintsImmediate();
  syncVersionHighlightFromState();
}

export async function syncVersions(): Promise<void> {
  try {
    const st = currentState;
    if (!st) return;
    const storageId = libraryStorageId(st);
    const item = await getHistoryItemFromExtension(storageId);
    if (!item) return;
    const stNow = currentState;
    if (!stNow) return;
    let nextSel = stNow.selectedVersionId;
    if (
      nextSel &&
      nextSel !== REFINE_STREAM_VERSION_ID &&
      nextSel !== EXTRACT_STREAM_VERSION_ID &&
      !nextSel.startsWith(`${REFINE_STREAM_VERSION_ID}:`) &&
      !nextSel.startsWith(`${EXTRACT_STREAM_VERSION_ID}:`) &&
      !item.versions.some((v) => v.id === nextSel)
    ) {
      nextSel = undefined;
    }
    const preserveRefine =
      panelHasActiveRefine(stNow) &&
      !!nextSel &&
      (nextSel === REFINE_STREAM_VERSION_ID || nextSel.startsWith(`${REFINE_STREAM_VERSION_ID}:`));
    const preserveExtract =
      panelExtractJobs(stNow).length > 0 &&
      !!nextSel &&
      (nextSel === EXTRACT_STREAM_VERSION_ID || nextSel.startsWith(`${EXTRACT_STREAM_VERSION_ID}:`));
    const nextDraft = stNow.draft ?? item.prompt;
    if (!preserveRefine && !preserveExtract && !nextSel) {
      nextSel =
        nextDraft === item.prompt
          ? item.versions[0]?.id
          : item.versions.find((v) => v.prompt === nextDraft)?.id;
    }
    setCurrentState({
      ...stNow,
      versions: item.versions,
      selectedVersionId: nextSel,
      draft: nextDraft,
      prompt: item.prompt,
    });
    patchVersionList();
  } catch (err) {
    console.warn('[PromptExtracto] syncVersions failed', err);
  }
}

/**
 * 从历史记录同步 versions 后，只刷新侧栏 DOM，避免整块 renderPanel 抢走用户正在进行
 * 的点击（mousedown 后异步完成导致 click 落在已卸载节点上）。
 */
export function patchVersionList(): void {
  const st = currentState;
  if (!st || !panel) return;

  const versions = st.versions || [];
  if (
    versions.length === 0 &&
    !panelHasActiveRefine(st) &&
    panelExtractJobs(st).length === 0
  ) {
    renderPanel(st);
    return;
  }

  const list = panel.querySelector<HTMLElement>('.versions-list');
  if (!list) {
    renderPanel(st);
    return;
  }

  const headSpan = panel.querySelector<HTMLElement>('.versions-head > span');
  if (headSpan) {
    const extractRows =
      st.status === 'success' || (st.status === 'loading' && versions.length > 0)
        ? panelExtractJobs(st).length
        : 0;
    const n = versions.length + panelRefineJobs(st).length + extractRows;
    headSpan.textContent = `历史版本 · ${n}`;
  }

  list.innerHTML = buildVersionsListInnerHtml(st);
  updateDirtyChromeImmediate();
}

function patchStrategyDropdownSelection(root: HTMLElement, strategy: StrategyId): void {
  const dropdown = root.querySelector<HTMLElement>('[data-role="strategy-dropdown"]');
  if (!dropdown) return;
  const labelEl = dropdown.querySelector<HTMLElement>('.sd-label');
  if (labelEl) labelEl.textContent = STRATEGY_LABELS[strategy] ?? strategy;
  dropdown.querySelectorAll<HTMLElement>('.sd-item').forEach((li) => {
    li.classList.toggle('active', li.dataset.strategy === strategy);
  });
}

function patchRewriteRandomnessDropdownSelection(
  root: HTMLElement,
  level: OneClickRewriteRandomness
): void {
  const dropdown = root.querySelector<HTMLElement>('[data-role="rewrite-randomness-dropdown"]');
  if (!dropdown) return;
  const labelEl = dropdown.querySelector<HTMLElement>('.sd-label');
  if (labelEl) labelEl.textContent = REWRITE_RANDOMNESS_LABELS[level] ?? level;
  dropdown.querySelectorAll<HTMLElement>('.sd-item').forEach((li) => {
    li.classList.toggle('active', li.dataset.randomness === level);
  });
}

/** storage / 其它上下文更新 `promptStrategy` 后，在 success 态面板上同步下拉与历史 chip，不重渲整板。 */
export function applyStoredPromptStrategy(strategy: StrategyId): void {
  const st = currentState;
  if (!st || !panel || st.status !== 'success') return;
  if (st.strategy === strategy) return;
  setCurrentState({ ...st, strategy });
  patchStrategyDropdownSelection(panel, strategy);
  patchVersionList();
}

/** storage 同步「一键洗稿强度」后刷新面板下拉（不重渲整板）。 */
export function applyStoredRewriteRandomness(level: OneClickRewriteRandomness): void {
  const st = currentState;
  if (!st || !panel || st.status !== 'success') return;
  const next = normalizeOneClickRewriteRandomness(level);
  if (st.rewriteRandomness === next) return;
  setCurrentState({ ...st, rewriteRandomness: next });
  patchRewriteRandomnessDropdownSelection(panel, next);
}

/**
 * 在 header 上挂 mousedown，拖动时改写 panel 的 left/top（视口坐标）。
 *
 * - 只在 header 空白区起拖（按到 button / textarea / .icon-btn 不算）
 * - 拖拽期间给 panel 加 .dragging，关闭动画 / 过渡，提升阴影
 * - mouseup 时把最终 left/top 写回 panelGeometry + sessionStorage
 *
 * 不监听 touchstart：MV3 内容脚本里浮动面板主要给桌面用，移动端 Chrome
 * 上右键扩展菜单的入口几乎没人用。如果以后要支持，再加 pointer events。
 *
 * 委托在 `.panel` 根上：panel-surface 替换后 header DOM 会变，根上监听器仍有效。
 */
function bindHeaderDrag(root: HTMLElement): void {
  root.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const header = (e.target as HTMLElement).closest('.header');
    if (!header || !root.contains(header)) return;
    const target = e.target as HTMLElement | null;
    // 按到 header 内的可交互控件时，让原本的点击 / 选择行为优先。
    if (target && target.closest('.icon-btn, button, a, input, textarea')) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const rect = root.getBoundingClientRect();
    const startLeft = rect.left;
    const startTop = rect.top;
    const lockedWidth = rect.width;
    const lockedHeight = rect.height;

    e.preventDefault();
    root.classList.add('dragging');

    const onMove = (mv: MouseEvent) => {
      const next = clampGeometry({
        left: startLeft + (mv.clientX - startX),
        top: startTop + (mv.clientY - startY),
        width: panelGeometry?.width ?? lockedWidth,
        height: panelGeometry?.height ?? lockedHeight,
      });
      root.style.left = `${next.left}px`;
      root.style.top = `${next.top}px`;
    };

    const onUp = () => {
      teardown();
      const r = root.getBoundingClientRect();
      const patch: { left: number; top: number; width?: number; height?: number } = {
        left: r.left,
        top: r.top,
      };
      if (root.style.width && panelGeometry?.width === undefined) {
        patch.width = Math.round(r.width);
      }
      updateGeometry(patch);
    };

    const teardown = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onEscape, true);
      root.classList.remove('dragging');
    };

    const onEscape = (ke: KeyboardEvent) => {
      if (ke.key !== 'Escape') return;
      ke.preventDefault();
      ke.stopPropagation();
      teardown();
      root.style.left = `${startLeft}px`;
      root.style.top = `${startTop}px`;
      updateGeometry({ left: startLeft, top: startTop });
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onEscape, true);
  });
}

/**
 * 8 方向边缘 resize：监听 panel 内侧 8 个 .resize-handle 上的 mousedown，
 * 根据方向（n/s/e/w + 4 角）实时改写 panel 的 left/top/width/height。
 *
 * 方向编码：
 *   - 含 'e' → 拖东边：固定 left、增减 width
 *   - 含 'w' → 拖西边：保持 right 固定（startL + startW），left = right - newW
 *   - 含 's' → 拖南边：固定 top、增减 height
 *   - 含 'n' → 拖北边：保持 bottom 固定，top = bottom - newH
 *
 * 这种"保持对侧边固定"的算法在尺寸触底（MIN_WIDTH / MIN_HEIGHT）时也不会让
 * 面板被推走——只会卡在最小尺寸不动。
 *
 * 拖拽过程直接改 inline style 走最快路径，松手时再 commit 一次到 panelGeometry +
 * sessionStorage（updateGeometry）。
 */
function bindEdgeResize(root: HTMLElement): void {
  const clamp = (v: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, v));

  root.querySelectorAll<HTMLElement>('.resize-handle').forEach((h) => {
    h.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const dir = h.dataset.dir || '';
      if (!dir) return;

      e.preventDefault();
      e.stopPropagation();

      const rect = root.getBoundingClientRect();
      const startL = rect.left;
      const startT = rect.top;
      const startW = rect.width;
      const startH = rect.height;
      const right = startL + startW;
      const bottom = startT + startH;
      const startX = e.clientX;
      const startY = e.clientY;
      const resizeW = dir.includes('e') || dir.includes('w');
      const resizeH = dir.includes('n') || dir.includes('s');

      // 加 .resizing class：与 .dragging 共用「轻量 blur」分支，避免满载毛玻璃
      // + 位移每帧全视口采样导致卡顿；动画在此关闭。
      root.classList.add('resizing');
      // 只固化本次拖动涉及的轴；另一轴传 undefined 以解除 session 里旧的 width/height 锁，
      // 避免「只拖左右边」却钉死高度 → 内容变高时面板不再长高、底部留白。
      updateGeometry({
        width: resizeW ? Math.round(startW) : undefined,
        height: resizeH ? Math.round(startH) : undefined,
      });

      const onMove = (mv: MouseEvent) => {
        const dx = mv.clientX - startX;
        const dy = mv.clientY - startY;
        const { width: vvW, height: vvH, originLeft: oLeft, originTop: oTop } =
          getLayoutViewportBox();

        let newL = startL;
        let newT = startT;
        let newW = startW;
        let newH = startH;

        const edgeRight = oLeft + vvW - VIEWPORT_MARGIN;
        const edgeBottom = oTop + vvH - VIEWPORT_MARGIN;

        if (dir.includes('e')) {
          newW = clamp(startW + dx, MIN_WIDTH, edgeRight - startL);
          newL = startL;
        } else if (dir.includes('w')) {
          const maxL = right - MIN_WIDTH;
          const minL = Math.max(
            oLeft + VIEWPORT_MARGIN,
            right - (vvW - VIEWPORT_MARGIN * 2),
          );
          newL = clamp(startL + dx, minL, maxL);
          newW = right - newL;
        }

        if (dir.includes('s')) {
          newH = clamp(startH + dy, MIN_HEIGHT, edgeBottom - startT);
          newT = startT;
        } else if (dir.includes('n')) {
          const maxT = bottom - MIN_HEIGHT;
          const minT = Math.max(
            oTop + VIEWPORT_MARGIN,
            bottom - (vvH - VIEWPORT_MARGIN * 2),
          );
          newT = clamp(startT + dy, minT, maxT);
          newH = bottom - newT;
        }

        // mousemove 不写 sessionStorage / setState，直接改 inline style；
        // 松手时再 commit 一次最终几何。未拖动的轴去掉 inline，交给 CSS/内容自适应。
        root.style.left = `${newL}px`;
        root.style.top = `${newT}px`;
        if (resizeW) root.style.width = `${newW}px`;
        else root.style.removeProperty('width');
        if (resizeH) root.style.height = `${newH}px`;
        else root.style.removeProperty('height');
      };

      const teardownResize = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('keydown', onEscapeResize, true);
        root.classList.remove('resizing');
      };

      const onUp = () => {
        teardownResize();
        const r = root.getBoundingClientRect();
        updateGeometry({
          left: r.left,
          top: r.top,
          width: resizeW ? Math.round(r.width) : undefined,
          height: resizeH ? Math.round(r.height) : undefined,
        });
      };

      const onEscapeResize = (ke: KeyboardEvent) => {
        if (ke.key !== 'Escape') return;
        ke.preventDefault();
        ke.stopPropagation();
        teardownResize();
        root.style.left = `${startL}px`;
        root.style.top = `${startT}px`;
        if (resizeW) root.style.width = `${startW}px`;
        else root.style.removeProperty('width');
        if (resizeH) root.style.height = `${startH}px`;
        else root.style.removeProperty('height');
        updateGeometry({
          left: Math.round(startL),
          top: Math.round(startT),
          width: resizeW ? Math.round(startW) : undefined,
          height: resizeH ? Math.round(startH) : undefined,
        });
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      window.addEventListener('keydown', onEscapeResize, true);
    });
  });
}

function removeRefineJobById(state: PanelState, jobId: string): PanelState {
  const jobs = panelRefineJobs(state).filter((j) => j.jobId !== jobId);
  return { ...state, refineJobs: jobs.length ? jobs : undefined };
}

function beginPanelRefineSession(
  sessionState: PanelState,
  baseline: string,
  instruction: string,
  refineInstructionSnapshot: string
): void {
  const requestIdSnapshot = sessionState.requestId;
  if (panelRefineJobs(sessionState).length >= MAX_PARALLEL_PANEL_REFINES) return;

  const jobId = crypto.randomUUID();
  const kind: PanelRefineJob['kind'] = refineInstructionSnapshot.trim() ? 'refine' : 'rewrite';
  const jobs: PanelRefineJob[] = [
    ...panelRefineJobs(sessionState),
    {
      jobId,
      kind,
      stage: 'calling',
      partial: undefined,
      startedAt: Date.now(),
      refineBaselinePrompt: baseline,
      refineInstructionSnapshot: refineInstructionSnapshot || undefined,
    },
  ];

  setCurrentState({
    ...sessionState,
    refineJobs: jobs,
    refineError: undefined,
    refineInstruction: refineInstructionSnapshot,
    selectedVersionId: refineStreamSentinelForJob(jobId),
    versionsOpen: true,
  });
  renderPanel(currentState!);
  if (!isExtensionContextValid()) {
    const cleared = removeRefineJobById(currentState!, jobId);
    setCurrentState({
      ...cleared,
      refineError: '扩展已更新，请刷新页面',
    });
    renderPanel(currentState!);
    return;
  }
  try {
    chrome.runtime.sendMessage(
      {
        type: 'REFINE_PROMPT',
        payload: {
          historyId: libraryStorageId(sessionState),
          instruction,
          current: baseline,
          refineJobId: jobId,
        },
      },
      (resp: RefineResponse | undefined) => {
        if (!currentState || currentState.requestId !== requestIdSnapshot) return;
        const rid = resp?.ok ? resp.refineJobId ?? jobId : jobId;
        if (chrome.runtime.lastError || !resp) {
          let next = removeRefineJobById(currentState, rid);
          next = {
            ...next,
            refineError: chrome.runtime.lastError?.message || '后台未响应，请稍后再试',
          };
          setCurrentState(next);
          renderPanel(next);
          return;
        }
        if (!resp.ok) {
          let next = removeRefineJobById(currentState, rid);
          next = { ...next, refineError: resp.error };
          setCurrentState(next);
          renderPanel(next);
          return;
        }
        let next = removeRefineJobById(currentState, rid);
        const stillRefining = panelRefineJobs(next).length > 0;
        const wasOpen = next.versionsOpen;
        const prevSel = currentState.selectedVersionId;
        const viewingCompleted =
          prevSel === refineStreamSentinelForJob(rid) ||
          prevSel === REFINE_STREAM_VERSION_ID ||
          parseRefineJobSentinel(prevSel ?? undefined) === rid;
        let nextSel = prevSel;
        if (!stillRefining || viewingCompleted || parseRefineJobSentinel(prevSel ?? undefined) === rid) {
          nextSel = resp.versionId;
        }
        next = {
          ...next,
          refineError: undefined,
          refineInstruction: stillRefining ? next.refineInstruction : '',
          refineOpen: stillRefining ? next.refineOpen : false,
          prompt: resp.prompt,
          draft: resp.prompt,
          versionsOpen: true,
          selectedVersionId: nextSel,
        };
        setCurrentState(next);
        if (!wasOpen) expandPanelForSidebar();
        void syncVersions();
        renderPanel(currentState!);
      }
    );
  } catch {
    const cleared = removeRefineJobById(currentState!, jobId);
    setCurrentState({
      ...cleared,
      refineError: '扩展已更新，请刷新页面',
    });
    renderPanel(currentState!);
  }
}

function handleDataAction(root: HTMLElement, el: HTMLElement, event: MouseEvent): void {
  // 历史版本 li 整行带 data-action="select-version"，行内的「复制 / 恢复」按钮也各自有
  // data-action；子控件先触发并 stopPropagation，避免父级 li 误判。
  event.stopPropagation();
  const action = el.dataset.action;
  const state = currentState;
  if (!state) return;
  if (action === 'close') return closePanel();
  if (action === 'run-extract') {
    if (state.status !== 'compose') return;
    const urls = normalizeReferenceList(panelReferenceUrls(state));
    if (!urls.length || !isExtensionContextValid()) return;
    safeSendMessage({ type: 'PING' });
    const newReq = crypto.randomUUID();
    renderPanel({
      ...state,
      requestId: newReq,
      extractJobs: [{ streamRequestId: newReq, startedAt: Date.now() }],
      status: 'loading',
      stage: 'calling',
      startedAt: Date.now(),
      prompt: undefined,
      error: undefined,
      draft: undefined,
      selectedVersionId: undefined,
      partial: undefined,
      extractBaselinePrompt: undefined,
      linkedHistoryId: undefined,
      versions: undefined,
      versionsOpen: false,
      refineOpen: false,
      refineJobs: undefined,
      refineError: undefined,
    });
    safeSendMessage({
      type: 'EXTRACT_PROMPT',
      payload: {
        imageUrl: urls[0]!,
        imageUrls: urls,
        pageUrl: location.href,
        pageTitle: document.title,
        requestId: newReq,
        ...(state.strategy !== undefined ? { strategyOverride: state.strategy } : {}),
      },
    });
    return;
  }
  if (action === 'remove-reference') {
    const idx = Number.parseInt(el.dataset.index || '-1', 10);
    if (state.status !== 'compose' && state.status !== 'success' && state.status !== 'error') return;
    const urls = [...panelReferenceUrls(state)];
    if (idx < 0 || idx >= urls.length) return;
    urls.splice(idx, 1);
    const next = normalizeReferenceList(urls);
    if (next.length === 0) {
      closePanel();
      return;
    }
    renderPanel({ ...state, imageUrls: next, imageUrl: next[0] || state.imageUrl });
    return;
  }
  if (action === 'add-ref-url') {
    if (state.status !== 'compose') return;
    const prev = panelReferenceUrls(state);
    if (prev.length >= MAX_REFERENCE_IMAGES) return;
    const input = root.querySelector<HTMLInputElement>('[data-role="ref-url-input"]');
    const raw = (input?.value || '').trim();
    if (!raw) return;
    const next = appendReferenceUrl(prev, raw);
    if (next.length === prev.length) return;
    if (input) input.value = '';
    renderPanel({ ...state, imageUrls: next, imageUrl: next[0] || state.imageUrl });
    return;
  }
  if (action === 'pick-ref-file') {
    if (state.status !== 'compose') return;
    root.querySelector<HTMLInputElement>('[data-role="ref-file-input"]')?.click();
    return;
  }
  if (action === 'copy') {
    const text =
      state.status === 'loading'
        ? loadingEditorDisplayedText(state)
        : state.status === 'success'
          ? successEditorDisplayedText(state)
          : state.draft ?? state.prompt ?? state.partial ?? '';
    navigator.clipboard
      .writeText(text)
      .then(() => flashCopied(el))
      .catch(() => fallbackCopy(text, el));
    return;
  }
  if (action === 'retry') {
    if (!isExtensionContextValid()) return;
    safeSendMessage({ type: 'PING' });
    const versions = state.versions || [];
    const hasHistory = versions.length > 0;
    const urls = normalizeReferenceList(panelReferenceUrls(state));
    if (!urls.length) return;
    if (panelExtractJobs(state).length >= MAX_PARALLEL_PANEL_EXTRACTS) return;

    const streamId = crypto.randomUUID();

    if (hasHistory && state.status === 'success') {
      const ej = [...panelExtractJobs(state), { streamRequestId: streamId, startedAt: Date.now() }];
      const wasOpen = state.versionsOpen;
      renderPanel({
        ...state,
        extractJobs: ej,
        selectedVersionId: extractStreamSentinelForJob(streamId),
        versionsOpen: true,
        linkedHistoryId: undefined,
      });
      if (!wasOpen) expandPanelForSidebar();
      safeSendMessage({
        type: 'EXTRACT_PROMPT',
        payload: {
          imageUrl: urls[0]!,
          imageUrls: urls,
          pageUrl: location.href,
          pageTitle: document.title,
          requestId: streamId,
          ...(state.strategy !== undefined ? { strategyOverride: state.strategy } : {}),
        },
      });
      return;
    }

    if (state.status === 'loading') {
      const ej = [...panelExtractJobs(state), { streamRequestId: streamId, startedAt: Date.now() }];
      renderPanel({
        ...state,
        extractJobs: ej,
        selectedVersionId:
          versions.length > 0 ? extractStreamSentinelForJob(streamId) : state.selectedVersionId,
        versionsOpen: versions.length > 0 ? true : state.versionsOpen,
      });
      safeSendMessage({
        type: 'EXTRACT_PROMPT',
        payload: {
          imageUrl: urls[0]!,
          imageUrls: urls,
          pageUrl: location.href,
          pageTitle: document.title,
          requestId: streamId,
          ...(state.strategy !== undefined ? { strategyOverride: state.strategy } : {}),
        },
      });
      return;
    }

    renderPanel({
      ...state,
      requestId: streamId,
      extractJobs: [{ streamRequestId: streamId, startedAt: Date.now() }],
      status: 'loading',
      prompt: undefined,
      error: undefined,
      draft: undefined,
      selectedVersionId: hasHistory ? extractStreamSentinelForJob(streamId) : undefined,
      extractBaselinePrompt: undefined,
      stage: 'calling',
      partial: undefined,
      startedAt: Date.now(),
      linkedHistoryId: undefined,
      refineJobs: undefined,
      refineError: undefined,
      refineOpen: false,
    });
    safeSendMessage({
      type: 'EXTRACT_PROMPT',
      payload: {
        imageUrl: urls[0]!,
        imageUrls: urls,
        pageUrl: location.href,
        pageTitle: document.title,
        requestId: streamId,
        ...(state.strategy !== undefined ? { strategyOverride: state.strategy } : {}),
      },
    });
    return;
  }
  if (action === 'open-options') {
    if (!isExtensionContextValid()) return;
    safeSendMessage(openOptionsMessage());
    return;
  }
  if (action === 'open-in-library') {
    if (!isExtensionContextValid()) return;
    safeSendMessage(
      openOptionsMessage({ tab: 'library', focusId: libraryStorageId(state) }),
      () => void chrome.runtime.lastError
    );
    return;
  }
  if (action === 'toggle-versions') {
    const next = !state.versionsOpen;
    setCurrentState({ ...state, versionsOpen: next });
    const row = root.querySelector<HTMLElement>('.panel-row');
    if (row) row.classList.toggle('versions-open', next);
    const versionsBtn = root.querySelector<HTMLElement>(
      '.meta-left [data-action="toggle-versions"]'
    );
    if (versionsBtn) versionsBtn.classList.toggle('active', next);

    // 面板宽度同步：加过渡 class → 强制 reflow → expand/collapse → transitionend 清理
    const p = panel;
    if (p) {
      p.classList.add('sidebar-transition');
      void p.offsetWidth;
      if (next) expandPanelForSidebar();
      else collapsePanelForSidebar();
      const cleanup = (e: TransitionEvent) => {
        if (e.propertyName === 'width') {
          p.classList.remove('sidebar-transition');
          p.removeEventListener('transitionend', cleanup);
        }
      };
      p.addEventListener('transitionend', cleanup);
    }
    return;
  }
  if (action === 'rewrite-spin') {
    if (state.status !== 'success') return;
    if (panelRefineJobs(state).length >= MAX_PARALLEL_PANEL_REFINES) return;
    const actionRoot = root.isConnected ? root : panel ?? root;
    const ta = actionRoot.querySelector<HTMLTextAreaElement>('[data-role="editor"]');
    const baseline = (ta?.value ?? state.draft ?? state.prompt ?? '').trim();
    if (!baseline) return;
    const level = normalizeOneClickRewriteRandomness(state.rewriteRandomness);
    const instruction = buildOneClickRewriteInstruction(level, makeRewriteNonce());
    beginPanelRefineSession(state, baseline, instruction, '');
    return;
  }
  if (
    state.status === 'loading' &&
    (action === 'copy-version' || action === 'restore-version' || action === 'delete-version')
  ) {
    return;
  }
  if (action === 'save') {
    const draft = state.draft ?? state.prompt ?? '';
    if (draft === state.prompt) return;
    void appendPromptVersionFromExtension(libraryStorageId(state), draft, 'edited').then((updated) => {
      if (!updated || !currentState || currentState.requestId !== state.requestId) return;
      const wasOpen = currentState.versionsOpen;
      setCurrentState({
        ...currentState,
        prompt: updated.prompt,
        draft: updated.prompt,
        versions: updated.versions,
        versionsOpen: true,
        selectedVersionId: updated.versions[0]?.id,
      });
      if (!wasOpen) expandPanelForSidebar();
      renderPanel(currentState);
      flashCopied(el, '已保存 ✔');
    });
    return;
  }
  if (action === 'copy-version') {
    const vid = el.dataset.versionId;
    const v = state.versions?.find((x) => x.id === vid);
    if (!v) return;
    navigator.clipboard
      .writeText(v.prompt)
      .then(() => flashCopied(el, '已复制 ✔'))
      .catch(() => fallbackCopy(v.prompt, el));
    return;
  }
  if (action === 'load-version' || action === 'select-version') {
    const vid = el.dataset.versionId;
    if (!currentState || !vid) return;

    const refineJid = parseRefineJobSentinel(vid);
    if (refineJid && panelRefineJobs(state).some((j) => j.jobId === refineJid)) {
      const next = { ...currentState, selectedVersionId: vid };
      setCurrentState(next);
      const actionRoot = root.isConnected ? root : panel ?? root;
      const ta = actionRoot.querySelector<HTMLTextAreaElement>('[data-role="editor"]');
      if (ta) ta.value = successEditorDisplayedText(next);
      updateDirtyChromeImmediate();
      return;
    }

    const extractSid = parseExtractJobSentinel(vid);
    if (extractSid && matchesExtractStreamRequest(state, extractSid)) {
      const next = { ...currentState, selectedVersionId: vid };
      setCurrentState(next);
      const actionRoot = root.isConnected ? root : panel ?? root;
      const ta = actionRoot.querySelector<HTMLTextAreaElement>('[data-role="editor"]');
      if (ta) {
        ta.value =
          state.status === 'success'
            ? successEditorDisplayedText(next)
            : loadingEditorDisplayedText(next);
      }
      updateDirtyChromeImmediate();
      return;
    }

    if (vid === REFINE_STREAM_VERSION_ID && panelHasActiveRefine(state)) {
      const first = panelRefineJobs(state)[0]?.jobId;
      const selId = first ? refineStreamSentinelForJob(first) : vid;
      const next = { ...currentState, selectedVersionId: selId };
      setCurrentState(next);
      const actionRoot = root.isConnected ? root : panel ?? root;
      const ta = actionRoot.querySelector<HTMLTextAreaElement>('[data-role="editor"]');
      if (ta) ta.value = successEditorDisplayedText(next);
      updateDirtyChromeImmediate();
      return;
    }

    if (vid === EXTRACT_STREAM_VERSION_ID && panelExtractJobs(state).length > 0) {
      const first = panelExtractJobs(state)[0]?.streamRequestId;
      const selId = first ? extractStreamSentinelForJob(first) : vid;
      const next = { ...currentState, selectedVersionId: selId };
      setCurrentState(next);
      const actionRoot = root.isConnected ? root : panel ?? root;
      const ta = actionRoot.querySelector<HTMLTextAreaElement>('[data-role="editor"]');
      if (ta) {
        ta.value =
          state.status === 'success'
            ? successEditorDisplayedText(next)
            : loadingEditorDisplayedText(next);
      }
      updateDirtyChromeImmediate();
      return;
    }

    const v = state.versions?.find((x) => x.id === vid);
    if (!v) return;

    if (panelHasActiveRefine(state)) {
      const next = { ...currentState, selectedVersionId: vid };
      setCurrentState(next);
      const actionRoot = root.isConnected ? root : panel ?? root;
      const ta = actionRoot.querySelector<HTMLTextAreaElement>('[data-role="editor"]');
      if (ta) ta.value = v.prompt;
      updateDirtyChromeImmediate();
      return;
    }

    if (state.status === 'loading') {
      const next = { ...currentState, selectedVersionId: vid };
      setCurrentState(next);
      const actionRoot = root.isConnected ? root : panel ?? root;
      const ta = actionRoot.querySelector<HTMLTextAreaElement>('[data-role="editor"]');
      if (ta) ta.value = v.prompt;
      updateDirtyChromeImmediate();
      return;
    }

    setCurrentState({
      ...currentState,
      draft: v.prompt,
      selectedVersionId: vid,
    });
    const actionRoot = root.isConnected ? root : panel ?? root;
    const ta = actionRoot.querySelector<HTMLTextAreaElement>('[data-role="editor"]');
    if (ta) ta.value = v.prompt;
    updateDirtyChromeImmediate();
    return;
  }
  if (action === 'restore-version') {
    const vid = el.dataset.versionId;
    if (!vid) return;
    void restorePromptVersionFromExtension(libraryStorageId(state), vid).then((updated) => {
      if (!updated || !currentState || currentState.requestId !== state.requestId) return;
      const wasOpen = currentState.versionsOpen;
      setCurrentState({
        ...currentState,
        prompt: updated.prompt,
        draft: updated.prompt,
        versions: updated.versions,
        versionsOpen: true,
        selectedVersionId: updated.versions[0]?.id,
      });
      if (!wasOpen) expandPanelForSidebar();
      renderPanel(currentState);
      flashCopied(el, '已恢复 ✔');
    });
    return;
  }
  if (action === 'delete-version') {
    const vid = el.dataset.versionId;
    if (!vid) return;
    if ((state.versions?.length || 0) <= 1) return;
    const isCurrent = state.versions?.[0]?.id === vid;
    const msg = isCurrent
      ? '确定删除「当前版本」吗？删除后将由下一条版本自动顶替为新的当前版本，此操作不可撤销'
      : '确定删除该版本吗？此操作不可撤销';
    if (!confirm(msg)) return;
    void removePromptVersionFromExtension(libraryStorageId(state), vid).then((updated) => {
      if (!currentState || currentState.requestId !== state.requestId) return;
      if (updated && isCurrent) {
        setCurrentState({
          ...currentState,
          prompt: updated.prompt,
          draft: updated.prompt,
          versions: updated.versions,
          versionsOpen: true,
          selectedVersionId: updated.versions[0]?.id,
        });
        renderPanel(currentState);
        flashCopied(el, '已切换到下一版本 ✔');
        return;
      }
      void syncVersions();
    });
    return;
  }
  if (action === 'toggle-refine') {
    const opening = !state.refineOpen;
    const nextInstruction = opening ? state.refineInstruction || '' : '';
    setCurrentState({
      ...state,
      refineOpen: opening,
      refineError: undefined,
      refineInstruction: nextInstruction,
    });

    const slot = root.querySelector<HTMLElement>('[data-role="refine-slot"]');
    if (slot) slot.classList.toggle('hidden', !opening);

    const refineBtn = root.querySelector<HTMLElement>(
      '.meta-left [data-action="toggle-refine"]'
    );
    if (refineBtn) refineBtn.classList.toggle('active', opening);

    const refineInput = root.querySelector<HTMLTextAreaElement>('[data-role="refine-input"]');
    if (refineInput) {
      if (!opening) {
        refineInput.value = '';
        slot
          ?.querySelectorAll('.refine-error, .refine-progress')
          .forEach((n) => n.remove());
      } else {
        refineInput.value = nextInstruction;
        setTimeout(() => refineInput.focus(), 0);
      }
    }
    return;
  }
  if (action === 'refine-suggest') {
    const text = el.dataset.text || '';
    if (!currentState) return;
    const prev = (currentState.refineInstruction || '').trim();
    const next = prev ? `${prev}；${text}` : text;
    setCurrentState({ ...currentState, refineInstruction: next });
    const refineInput = root.querySelector<HTMLTextAreaElement>('[data-role="refine-input"]');
    if (refineInput) {
      refineInput.value = next;
      refineInput.focus();
      refineInput.setSelectionRange(next.length, next.length);
    }
    return;
  }
  if (action === 'run-refine') {
    const instruction = (currentState?.refineInstruction || '').trim();
    if (!instruction) {
      setCurrentState({ ...state, refineError: '请先输入修改要求' });
      renderPanel(currentState!);
      return;
    }
    const baseline = state.draft ?? state.prompt ?? '';
    beginPanelRefineSession(state, baseline, instruction, instruction);
    return;
  }
}

/**
 * 根委托：策略下拉、所有 `[data-action]`（含 .versions-list 内条目），
 * panel-surface 替换 innerHTML 后无需重绑。
 */
function bindPanelDelegatedClicks(root: HTMLElement): void {
  root.addEventListener('click', (event: MouseEvent) => {
    const t = event.target as HTMLElement;

    const sdItem = t.closest<HTMLElement>('.sd-item');
    if (sdItem) {
      const parentDd = sdItem.closest<HTMLElement>(
        '[data-role="strategy-dropdown"], [data-role="rewrite-randomness-dropdown"]'
      );
      if (parentDd && root.contains(parentDd)) {
        event.stopPropagation();
        parentDd.classList.remove('open');

        if (parentDd.matches('[data-role="strategy-dropdown"]')) {
          if (!currentState) return;
          const prevStatus = currentState.status;
          const newStrategy = sdItem.dataset.strategy as StrategyId;
          if (!newStrategy || newStrategy === currentState.strategy) return;
          if (
            (prevStatus !== 'success' && prevStatus !== 'compose') ||
            !isExtensionContextValid()
          )
            return;

          setCurrentState({ ...currentState, strategy: newStrategy });
          patchStrategyDropdownSelection(root, newStrategy);
          if (prevStatus === 'success') {
            patchVersionList();
          }
          safeSendMessage(
            {
              type: 'SET_PROMPT_STRATEGY',
              payload: { strategy: newStrategy },
            } satisfies RuntimeMessage,
            () => void chrome.runtime.lastError
          );
          return;
        }

        if (!currentState || currentState.status !== 'success' || panelHasActiveRefine(currentState))
          return;
        const level = sdItem.dataset.randomness as OneClickRewriteRandomness;
        if (level !== 'subtle' && level !== 'moderate' && level !== 'bold') return;
        if (level === currentState.rewriteRandomness) return;
        setCurrentState({ ...currentState, rewriteRandomness: level });
        patchRewriteRandomnessDropdownSelection(root, level);
        safeSendMessage(
          {
            type: 'SET_ONE_CLICK_REWRITE_RANDOMNESS',
            payload: { level },
          } satisfies RuntimeMessage,
          () => void chrome.runtime.lastError
        );
        return;
      }
    }

    const sdTrigger = t.closest<HTMLElement>('.sd-trigger');
    if (sdTrigger) {
      const parentDd = sdTrigger.closest<HTMLElement>(
        '[data-role="strategy-dropdown"], [data-role="rewrite-randomness-dropdown"]'
      );
      if (parentDd && root.contains(parentDd)) {
        if ((sdTrigger as HTMLButtonElement).disabled) return;
        event.stopPropagation();
        root
          .querySelectorAll<HTMLElement>(
            '[data-role="strategy-dropdown"], [data-role="rewrite-randomness-dropdown"]'
          )
          .forEach((dd) => {
            if (dd !== parentDd) dd.classList.remove('open');
          });
        parentDd.classList.toggle('open');
        return;
      }
    }

    root
      .querySelectorAll<HTMLElement>(
        '[data-role="strategy-dropdown"], [data-role="rewrite-randomness-dropdown"]'
      )
      .forEach((dd) => {
        if (!dd.contains(t)) dd.classList.remove('open');
      });

    const actionEl = t.closest<HTMLElement>('[data-action]');
    if (!actionEl || !root.contains(actionEl)) return;
    handleDataAction(root, actionEl, event);
  });
}

function bindPanelDelegatedInput(root: HTMLElement): void {
  root.addEventListener('input', (e: Event) => {
    const t = e.target as HTMLElement;
    if (!root.contains(t)) return;
    if (t.matches('[data-role="editor"]')) {
      const editor = t as HTMLTextAreaElement;
      if (!currentState) return;
      const val = editor.value;
      let nextSel = currentState.selectedVersionId;
      if (nextSel) {
        const v = currentState.versions?.find((x) => x.id === nextSel);
        if (!v || v.prompt !== val) nextSel = undefined;
      }
      setCurrentState({ ...currentState, draft: val, selectedVersionId: nextSel });
      updateDirtyChrome();
      return;
    }
    if (t.matches('[data-role="refine-input"]')) {
      const refineInput = t as HTMLTextAreaElement;
      if (!currentState) return;
      setCurrentState({ ...currentState, refineInstruction: refineInput.value });
    }
  });

  root.addEventListener('keydown', (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (!t.matches('[data-role="refine-input"]') || !root.contains(t)) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      const btn = root.querySelector<HTMLButtonElement>('[data-action="run-refine"]');
      btn?.click();
    }
  });

  root.addEventListener('change', (e: Event) => {
    const t = e.target as HTMLElement;
    if (!root.contains(t) || !t.matches('[data-role="ref-file-input"]')) return;
    const inp = t as HTMLInputElement;
    const file = inp.files?.[0];
    inp.value = '';
    const st = currentState;
    if (!file || !st || st.status !== 'compose') return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      const cur = currentState;
      if (!dataUrl || !cur || cur.status !== 'compose') return;
      const prev = panelReferenceUrls(cur);
      if (prev.length >= MAX_REFERENCE_IMAGES) return;
      const next = appendReferenceUrl(prev, dataUrl);
      if (next.length === prev.length) return;
      renderPanel({ ...cur, imageUrls: next, imageUrl: next[0] || cur.imageUrl });
    };
    reader.readAsDataURL(file);
  });
}

export function bindEvents(root: HTMLElement): void {
  if (panelShellBound.has(root)) return;
  panelShellBound.add(root);
  bindHeaderDrag(root);
  bindEdgeResize(root);
  bindPanelDelegatedClicks(root);
  bindPanelDelegatedInput(root);
}

export function flashCopied(btn: HTMLElement, text = '已复制 ✔'): void {
  const span = btn.querySelector('span');
  const original = span?.textContent || '';
  if (span) span.textContent = text;
  btn.classList.add('copied');
  setTimeout(() => {
    if (span) span.textContent = original;
    btn.classList.remove('copied');
  }, 1500);
}

export function fallbackCopy(text: string, btn: HTMLElement): void {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    flashCopied(btn);
  } finally {
    ta.remove();
  }
}
