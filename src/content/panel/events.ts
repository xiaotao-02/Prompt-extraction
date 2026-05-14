import {
  appendPromptVersion,
  getHistoryItem,
  removePromptVersion,
  restorePromptVersion,
} from '@/lib/storage';
import type { RefineResponse, StrategyId } from '@/lib/types';
import {
  currentState,
  setCurrentState,
  panel,
  panelActions,
  panelGeometry,
} from './state';
import {
  updateGeometry,
  clampGeometry,
  expandPanelForSidebar,
  collapsePanelForSidebar,
  MIN_WIDTH,
  MIN_HEIGHT,
  VIEWPORT_MARGIN,
} from './geometry';
import { versionsListHtml } from './templates';

function renderPanel(...args: Parameters<typeof panelActions.renderPanel>) {
  return panelActions.renderPanel(...args);
}
function closePanel() {
  return panelActions.closePanel();
}

function isContextValid(): boolean {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

function safeSendMessage(message: unknown, callback?: (response: any) => void): void {
  if (!isContextValid()) return;
  try {
    if (callback) {
      chrome.runtime.sendMessage(message, callback);
    } else {
      chrome.runtime.sendMessage(message);
    }
  } catch { /* context invalidated */ }
}

/**
 * 仅刷新和"是否脏"相关的 UI 部分，避免在每次按键时整片重渲染导致 textarea 失焦。
 *
 * 顺便同步历史版本列表的 .selected 高亮：editor 改字后，原本被高亮的那条
 * 可能不再匹配 draft；用户也可能改着改着又改回了某条版本的内容，需要重新
 * 把高亮挪到那条上。这个同步是纯 DOM 操作，不触发重渲。
 */
export function updateDirtyChrome(): void {
  if (!panel || !currentState) return;
  const draft = currentState.draft ?? '';
  const dirty = draft !== (currentState.prompt ?? '');
  const hint = panel.querySelector<HTMLElement>('.dirty-hint');
  if (hint) hint.classList.toggle('show', dirty);
  const setDisabled = (sel: string, disabled: boolean) => {
    const btn = panel!.querySelector<HTMLButtonElement>(sel);
    if (!btn) return;
    btn.disabled = disabled;
    btn.classList.toggle('disabled', disabled);
    if (sel.includes('save')) {
      btn.classList.toggle('primary', !disabled);
      btn.classList.toggle('ghost', disabled);
    }
  };
  setDisabled('[data-action="reset"]', !dirty);
  setDisabled('[data-action="save"]', !dirty);

  const versions = currentState.versions || [];
  const sel = currentState.selectedVersionId;
  let matchedId: string | undefined;
  if (sel) {
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

export async function syncVersions(requestId: string): Promise<void> {
  try {
    const item = await getHistoryItem(requestId);
    if (!item) return;
    if (!currentState || currentState.requestId !== requestId) return;
    let nextSel = currentState.selectedVersionId;
    if (nextSel && !item.versions.some((v) => v.id === nextSel)) {
      nextSel = undefined;
    }
    const nextDraft = currentState.draft ?? item.prompt;
    if (!nextSel) {
      nextSel = item.versions.find((v) => v.prompt === nextDraft)?.id;
    }
    setCurrentState({
      ...currentState,
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
function patchVersionList(): void {
  const st = currentState;
  if (!st || !panel) return;

  const versions = st.versions || [];
  if (versions.length === 0) {
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
    headSpan.textContent = `历史版本 · ${versions.length}`;
  }

  const editorContent = st.draft ?? st.prompt ?? '';
  list.innerHTML = versionsListHtml(
    versions,
    editorContent,
    st.selectedVersionId
  );
  updateDirtyChrome();
}

/**
 * 在 `.versions-list` 上挂一个事件委托，通过冒泡 + closest 找到实际的
 * `[data-action]` 元素。好处：`patchVersionList` 替换 innerHTML 之后
 * 不需要重新绑定——委托挂在 `<ul>` 上，它自身不会被销毁。
 */
function bindVersionListDelegation(root: HTMLElement): void {
  const list = root.querySelector<HTMLElement>('.versions-list');
  if (!list) return;
  list.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!target || !list.contains(target)) return;
    handleDataAction(root, target, event as MouseEvent);
  });
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
 */
function bindHeaderDrag(root: HTMLElement): void {
  const header = root.querySelector<HTMLElement>('.header');
  if (!header) return;

  header.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    // 按到 header 内的可交互控件时，让原本的点击 / 选择行为优先。
    if (target && target.closest('.icon-btn, button, a, input, textarea')) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const rect = root.getBoundingClientRect();
    const startLeft = rect.left;
    const startTop = rect.top;
    // 用拖拽起始时刻的真实尺寸做 clamp 计算 —— panelGeometry 里的 width/height
    // 在用户没主动拖右下角 resize 之前是 undefined，那时面板由 CSS 自适应宽高，
    // 必须用真实尺寸才能算出正确的 maxLeft / maxTop，否则面板会被 clamp 到错位置。
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
      // mousemove 不走 updateGeometry（不写 sessionStorage / setState），
      // 直接改 inline style 走最快路径；松手时再 commit 一次最终位置。
      root.style.left = `${next.left}px`;
      root.style.top = `${next.top}px`;
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      root.classList.remove('dragging');
      const r = root.getBoundingClientRect();
      // 默认只 commit 位置，不动尺寸 —— 拖拽 header 不应固化用户没动过的尺寸。
      const patch: { left: number; top: number; width?: number; height?: number } = {
        left: r.left,
        top: r.top,
      };
      // 防御性接管：如果 panel 上有 inline width/height（一般是 bindEdgeResize
      // 写进去的）但 panelGeometry 还没记录到，把当前实际尺寸一并固化进 geometry。
      // 否则下一次 updateGeometry → applyGeometryToPanel 会因为 panelGeometry.width
      // 还是 undefined 而 removeProperty('width')，把用户拖出来的尺寸抹回 CSS 默认值
      // —— 这就是"拖动窗口松手后窗口被重置大小"的根因之一。
      if (root.style.width && panelGeometry?.width === undefined) {
        patch.width = Math.round(r.width);
      }
      if (root.style.height && panelGeometry?.height === undefined) {
        patch.height = Math.round(r.height);
      }
      updateGeometry(patch);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
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

      // 加 .resizing class：关掉 backdrop-filter / 动画，避免毛玻璃 reflow 卡顿。
      root.classList.add('resizing');
      // 用户首次按下 resize 拉手时，把当前自适应尺寸固化进 geometry。
      // 这样即便用户只小拖一下也不会回到 auto 状态，下次切 tab / 切版本
      // 不会"尺寸还原"。
      updateGeometry({
        width: Math.round(startW),
        height: Math.round(startH),
      });

      const onMove = (mv: MouseEvent) => {
        const dx = mv.clientX - startX;
        const dy = mv.clientY - startY;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        let newL = startL;
        let newT = startT;
        let newW = startW;
        let newH = startH;

        if (dir.includes('e')) {
          newW = clamp(startW + dx, MIN_WIDTH, vw - startL - VIEWPORT_MARGIN);
          newL = startL;
        } else if (dir.includes('w')) {
          // 西边拖动：right 边固定，width = right - newL
          const maxL = right - MIN_WIDTH;
          const minL = Math.max(
            VIEWPORT_MARGIN,
            right - (vw - VIEWPORT_MARGIN * 2)
          );
          newL = clamp(startL + dx, minL, maxL);
          newW = right - newL;
        }

        if (dir.includes('s')) {
          newH = clamp(startH + dy, MIN_HEIGHT, vh - startT - VIEWPORT_MARGIN);
          newT = startT;
        } else if (dir.includes('n')) {
          // 北边拖动：bottom 边固定，height = bottom - newT
          const maxT = bottom - MIN_HEIGHT;
          const minT = Math.max(
            VIEWPORT_MARGIN,
            bottom - (vh - VIEWPORT_MARGIN * 2)
          );
          newT = clamp(startT + dy, minT, maxT);
          newH = bottom - newT;
        }

        // mousemove 不写 sessionStorage / setState，直接改 inline style；
        // 松手时再 commit 一次最终几何。
        root.style.left = `${newL}px`;
        root.style.top = `${newT}px`;
        root.style.width = `${newW}px`;
        root.style.height = `${newH}px`;
      };

      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        root.classList.remove('resizing');
        const r = root.getBoundingClientRect();
        updateGeometry({
          left: r.left,
          top: r.top,
          width: Math.round(r.width),
          height: Math.round(r.height),
        });
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  });
}

function handleDataAction(root: HTMLElement, el: HTMLElement, event: MouseEvent): void {
  // 历史版本 li 整行带 data-action="select-version"，行内的「复制 / 恢复」按钮也各自有
  // data-action；子控件先触发并 stopPropagation，避免父级 li 误判。
  event.stopPropagation();
  const action = el.dataset.action;
  const state = currentState;
  if (!state) return;
  if (action === 'close') return closePanel();
  if (action === 'copy') {
    const text = state.draft ?? state.prompt ?? '';
    navigator.clipboard
      .writeText(text)
      .then(() => flashCopied(el))
      .catch(() => fallbackCopy(text, el));
    return;
  }
  if (action === 'retry') {
    if (!isContextValid()) return;
    safeSendMessage({ type: 'PING' });
    renderPanel({
      ...state,
      status: 'loading',
      prompt: undefined,
      error: undefined,
      draft: undefined,
      versions: undefined,
      versionsOpen: false,
      selectedVersionId: undefined,
      stage: 'calling',
      partial: undefined,
      startedAt: Date.now(),
    });
    safeSendMessage({
      type: 'EXTRACT_PROMPT',
      payload: {
        imageUrl: state.imageUrl,
        pageUrl: location.href,
        pageTitle: document.title,
        requestId: state.requestId,
      },
    });
    return;
  }
  if (action === 'open-options') {
    if (!isContextValid()) return;
    safeSendMessage({ type: 'OPEN_OPTIONS' });
    return;
  }
  if (action === 'open-in-library') {
    if (!isContextValid()) return;
    safeSendMessage({
      type: 'OPEN_OPTIONS',
      payload: { tab: 'library', focusId: state.requestId },
    });
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
  if (action === 'reset') {
    const restored = state.prompt ?? '';
    let nextSel = state.selectedVersionId;
    if (nextSel) {
      const v = state.versions?.find((x) => x.id === nextSel);
      if (!v || v.prompt !== restored) nextSel = undefined;
    }
    setCurrentState({ ...state, draft: restored, selectedVersionId: nextSel });
    const actionRoot = root.isConnected ? root : panel ?? root;
    const ta = actionRoot.querySelector<HTMLTextAreaElement>('[data-role="editor"]');
    if (ta) ta.value = restored;
    updateDirtyChrome();
    return;
  }
  if (action === 'save') {
    const draft = state.draft ?? state.prompt ?? '';
    if (draft === state.prompt) return;
    void appendPromptVersion(state.requestId, draft, 'edited').then((updated) => {
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
    if (currentState?.refineLoading) return;
    const vid = el.dataset.versionId;
    const v = state.versions?.find((x) => x.id === vid);
    if (!v || !currentState || !vid) return;
    setCurrentState({
      ...currentState,
      draft: v.prompt,
      selectedVersionId: vid,
    });
    const actionRoot = root.isConnected ? root : panel ?? root;
    const ta = actionRoot.querySelector<HTMLTextAreaElement>('[data-role="editor"]');
    if (ta) ta.value = v.prompt;
    updateDirtyChrome();
    return;
  }
  if (action === 'restore-version') {
    const vid = el.dataset.versionId;
    if (!vid) return;
    void restorePromptVersion(state.requestId, vid).then((updated) => {
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
    if (!confirm('确定删除该版本吗？此操作不可撤销')) return;
    void removePromptVersion(state.requestId, vid).then(() => {
      if (!currentState || currentState.requestId !== state.requestId) return;
      void syncVersions(state.requestId);
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
      refineStage: opening ? state.refineStage : undefined,
      refinePartial: opening ? state.refinePartial : undefined,
      refineStartedAt: opening ? state.refineStartedAt : undefined,
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
    setCurrentState({
      ...state,
      refineLoading: true,
      refineError: undefined,
      refineInstruction: instruction,
      refineStage: 'calling',
      refinePartial: undefined,
      refineStartedAt: Date.now(),
    });
    renderPanel(currentState!);
    if (!isContextValid()) {
      setCurrentState({
        ...currentState!,
        refineLoading: false,
        refineError: '扩展已更新，请刷新页面',
        refineStage: undefined,
        refinePartial: undefined,
        refineStartedAt: undefined,
      });
      renderPanel(currentState!);
      return;
    }
    const baseline = state.draft ?? state.prompt ?? '';
    try {
      chrome.runtime.sendMessage(
        {
          type: 'REFINE_PROMPT',
          payload: {
            historyId: state.requestId,
            instruction,
            current: baseline,
          },
        },
        (resp: RefineResponse | undefined) => {
          if (!currentState || currentState.requestId !== state.requestId) return;
          if (chrome.runtime.lastError || !resp) {
            setCurrentState({
              ...currentState,
              refineLoading: false,
              refineError:
                chrome.runtime.lastError?.message || '后台未响应，请稍后再试',
              refineStage: undefined,
              refinePartial: undefined,
              refineStartedAt: undefined,
            });
            renderPanel(currentState);
            return;
          }
          if (!resp.ok) {
            setCurrentState({
              ...currentState,
              refineLoading: false,
              refineError: resp.error,
              refineStage: undefined,
              refinePartial: undefined,
              refineStartedAt: undefined,
            });
            renderPanel(currentState);
            return;
          }
          const wasOpen = currentState.versionsOpen;
          setCurrentState({
            ...currentState,
            refineLoading: false,
            refineError: undefined,
            refineInstruction: '',
            refineOpen: false,
            refineStage: undefined,
            refinePartial: undefined,
            refineStartedAt: undefined,
            prompt: resp.prompt,
            draft: resp.prompt,
            versionsOpen: true,
            selectedVersionId: undefined,
          });
          if (!wasOpen) expandPanelForSidebar();
          void syncVersions(state.requestId);
          renderPanel(currentState);
        }
      );
    } catch {
      setCurrentState({
        ...currentState!,
        refineLoading: false,
        refineError: '扩展已更新，请刷新页面',
        refineStage: undefined,
        refinePartial: undefined,
        refineStartedAt: undefined,
      });
      renderPanel(currentState!);
    }
    return;
  }
}

export function bindEvents(root: HTMLElement): void {
  bindHeaderDrag(root);
  bindEdgeResize(root);
  const editor = root.querySelector<HTMLTextAreaElement>('[data-role="editor"]');
  if (editor) {
    editor.addEventListener('input', () => {
      if (!currentState) return;
      const val = editor.value;
      let nextSel = currentState.selectedVersionId;
      if (nextSel) {
        const v = currentState.versions?.find((x) => x.id === nextSel);
        if (!v || v.prompt !== val) nextSel = undefined;
      }
      setCurrentState({ ...currentState, draft: val, selectedVersionId: nextSel });
      updateDirtyChrome();
    });
  }

  const refineInput = root.querySelector<HTMLTextAreaElement>('[data-role="refine-input"]');
  if (refineInput) {
    // 不每次按键 re-render，只是同步到状态以便重渲染时回填
    refineInput.addEventListener('input', () => {
      if (!currentState) return;
      setCurrentState({ ...currentState, refineInstruction: refineInput.value });
    });
    // 自动聚焦
    setTimeout(() => refineInput.focus(), 0);
    // Ctrl/Cmd + Enter 触发
    refineInput.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        const btn = root.querySelector<HTMLButtonElement>('[data-action="run-refine"]');
        btn?.click();
      }
    });
  }

  bindVersionListDelegation(root);

  const strategySelect = root.querySelector<HTMLSelectElement>('[data-role="strategy-select"]');
  if (strategySelect) {
    strategySelect.addEventListener('change', () => {
      if (!currentState || !isContextValid()) return;
      const newStrategy = strategySelect.value as StrategyId;
      if (newStrategy === currentState.strategy) return;

      safeSendMessage({ type: 'PING' });
      renderPanel({
        ...currentState,
        status: 'loading',
        prompt: undefined,
        error: undefined,
        draft: undefined,
        versions: undefined,
        versionsOpen: false,
        selectedVersionId: undefined,
        stage: 'calling',
        partial: undefined,
        startedAt: Date.now(),
        strategy: newStrategy,
      });
      safeSendMessage({
        type: 'EXTRACT_PROMPT',
        payload: {
          imageUrl: currentState.imageUrl,
          pageUrl: location.href,
          pageTitle: document.title,
          requestId: currentState.requestId,
          strategyOverride: newStrategy,
        },
      });
    });
  }

  root.querySelectorAll<HTMLElement>('[data-action]').forEach((el) => {
    if (el.closest('.versions-list')) return;
    el.addEventListener('click', (event) =>
      handleDataAction(root, el, event as MouseEvent)
    );
  });
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
