import {
  appendPromptVersion,
  getHistoryItem,
  removePromptVersion,
  restorePromptVersion,
} from '@/lib/storage';
import type { RefineResponse } from '@/lib/types';
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
  MIN_WIDTH,
  MIN_HEIGHT,
  VIEWPORT_MARGIN,
} from './geometry';

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
  const matched = versions.find((v) => v.prompt === draft);
  const matchedId = matched?.id;
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
    setCurrentState({
      ...currentState,
      versions: item.versions,
      // 如果用户没在编辑，draft 跟着 prompt 走
      draft: currentState.draft ?? item.prompt,
      prompt: item.prompt,
    });
    renderPanel(currentState);
  } catch (err) {
    console.warn('[PromptExtracto] syncVersions failed', err);
  }
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

export function bindEvents(root: HTMLElement): void {
  bindHeaderDrag(root);
  bindEdgeResize(root);
  const editor = root.querySelector<HTMLTextAreaElement>('[data-role="editor"]');
  if (editor) {
    editor.addEventListener('input', () => {
      if (!currentState) return;
      setCurrentState({ ...currentState, draft: editor.value });
      // 仅刷新关键控件（避免每次按键都重渲染整片，从而丢失光标）
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

  root.querySelectorAll<HTMLElement>('[data-action]').forEach((el) => {
    el.addEventListener('click', (event) => {
      // 历史版本 li 整行带 data-action="select-version"，行内的"复制 / 恢复"
      // 按钮也带各自的 data-action。如果按钮的 click 冒泡上去，会同时触发整行
      // 的"切换版本"动作，导致先恢复一个版本、又被冒泡的 select 把 draft
      // 切回去这种诡异行为。统一在这里截断冒泡：子元素 action 处理完就停。
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
        // 不重渲整面板：只切 .panel-row.versions-open，sidebar 用 CSS transform
        // 滑入/滑出。这样面板尺寸保持不变，编辑器 textarea 不丢焦点、不丢滚动。
        const next = !state.versionsOpen;
        setCurrentState({ ...state, versionsOpen: next });
        const row = root.querySelector<HTMLElement>('.panel-row');
        if (row) row.classList.toggle('versions-open', next);
        // 同步左下角"历史版本"link-btn 的 active 视觉
        const versionsBtn = root.querySelector<HTMLElement>(
          '.meta-left [data-action="toggle-versions"]'
        );
        if (versionsBtn) versionsBtn.classList.toggle('active', next);
        return;
      }
      if (action === 'reset') {
        // 撤销编辑：把 editor textarea 的值改回 prompt，更新 dirty 视觉，
        // 不重渲面板，避免 sidebar 状态、滚动位置等 UI 一起被推平。
        const restored = state.prompt ?? '';
        setCurrentState({ ...state, draft: restored });
        const editor = root.querySelector<HTMLTextAreaElement>('[data-role="editor"]');
        if (editor) editor.value = restored;
        updateDirtyChrome();
        return;
      }
      if (action === 'save') {
        const draft = state.draft ?? state.prompt ?? '';
        if (draft === state.prompt) return;
        void appendPromptVersion(state.requestId, draft, 'edited').then((updated) => {
          if (!updated || !currentState || currentState.requestId !== state.requestId) return;
          setCurrentState({
            ...currentState,
            prompt: updated.prompt,
            draft: updated.prompt,
            versions: updated.versions,
            versionsOpen: true,
          });
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
        // 整行点击 = select-version；旧的 load-version 按钮已从模板去掉，
        // 但 action 名继续兼容（万一有缓存的旧 DOM 还在跑）。
        const vid = el.dataset.versionId;
        const v = state.versions?.find((x) => x.id === vid);
        if (!v || !currentState) return;
        // 局部更新：把版本内容塞进编辑器 textarea，更新 dirty 视觉 + 列表高亮。
        // 不重渲，保留 sidebar 滚动位置、不打断用户视线。
        setCurrentState({ ...currentState, draft: v.prompt });
        const editor = root.querySelector<HTMLTextAreaElement>('[data-role="editor"]');
        if (editor) editor.value = v.prompt;
        // updateDirtyChrome 内部会 toggle .version-item.selected，
        // CSS 同时隐藏被选中行的"恢复此版本"按钮，无需手动 sync。
        updateDirtyChrome();
        return;
      }
      if (action === 'restore-version') {
        const vid = el.dataset.versionId;
        if (!vid) return;
        void restorePromptVersion(state.requestId, vid).then((updated) => {
          if (!updated || !currentState || currentState.requestId !== state.requestId) return;
          setCurrentState({
            ...currentState,
            prompt: updated.prompt,
            draft: updated.prompt,
            versions: updated.versions,
            versionsOpen: true,
          });
          renderPanel(currentState);
          flashCopied(el, '已恢复 ✔');
        });
        return;
      }
      if (action === 'delete-version') {
        // 删除单个历史版本：
        // - 模板里"当前版本"不渲染删除按钮，所以这里不会拿到 versions[0]；
        //   storage 层的 removePromptVersion 也兜底了"不能删当前 / 至少留一条"。
        // - 删除完成后不重置 draft：用户可能正在编辑别的草稿；只调用
        //   syncVersions 刷新版本列表 + 视觉重渲，draft 由 syncVersions 自己保留。
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
        // 不重渲：refine-box 是常驻 DOM 的（templates.ts 里的 .refine-slot），
        // 只切 .hidden 类即可滑入/滑出。这样面板尺寸保持稳定，编辑器和滚动
        // 都不会被影响。
        const opening = !state.refineOpen;
        // 关闭时清掉上一轮的进度残留 / 错误提示 / 输入内容
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

        // 同步左下角"AI 调整"link-btn 的 active 视觉
        const refineBtn = root.querySelector<HTMLElement>(
          '.meta-left [data-action="toggle-refine"]'
        );
        if (refineBtn) refineBtn.classList.toggle('active', opening);

        const refineInput = root.querySelector<HTMLTextAreaElement>(
          '[data-role="refine-input"]'
        );
        if (refineInput) {
          if (!opening) {
            refineInput.value = '';
            // 关闭时同步清掉视觉残留：错误提示 / 进度块。
            // 注意：流式回复现在直接刷到主编辑器（不再有副 .stream-preview 节点），
            // 由 refine 成功 / 失败的 setCurrentState + renderPanel 自然还原。
            slot
              ?.querySelectorAll('.refine-error, .refine-progress')
              .forEach((n) => n.remove());
          } else {
            // 打开时把当前 state 中的 instruction 回填，并自动聚焦
            refineInput.value = nextInstruction;
            setTimeout(() => refineInput.focus(), 0);
          }
        }
        return;
      }
      if (action === 'refine-suggest') {
        const text = el.dataset.text || '';
        if (!currentState) return;
        // 把建议追加到输入框（如果已有内容则用顿号连接），仅做局部更新：
        // 直接改 refine-input 的 value + 同步 state，不重渲面板。
        const prev = (currentState.refineInstruction || '').trim();
        const next = prev ? `${prev}；${text}` : text;
        setCurrentState({ ...currentState, refineInstruction: next });
        const refineInput = root.querySelector<HTMLTextAreaElement>(
          '[data-role="refine-input"]'
        );
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
          // 进度相关字段全部初始化：'calling' + 起始时间，让进度条在按下按钮的
          // 瞬间就能跑出来（不必等首个 REFINE_PROGRESS 到达）。
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
              });
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
    });
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
