import type { ExtractStage, RefineStage, StrategyId } from '@/lib/types';
import { STRATEGY_LABELS, DEFAULT_STRATEGY_ID } from '@/lib/strategies-meta';
import {
  panel,
  currentState,
  loadingTickHandle,
  setLoadingTickHandle,
  refineTickHandle,
  setRefineTickHandle,
} from './state';
import type { PanelState } from './state';

/**
 * 策略 id → loading 面板上显示的简短中文 label。
 *
 * 直接复用 `strategies.ts` 的 `STRATEGY_LABELS`（顶层纯派生：只读 STRATEGIES
 * 的 label 字段，不会触发 STYLE_PROMPT_SETS 等几 KB 字符串的引用）。content
 * script 这里只 import `STRATEGY_LABELS` / `DEFAULT_STRATEGY_ID`，加上
 * `STRATEGY_LIST` 已改成 lazy 函数 `getStrategyList()`、模块顶层不再 evaluate
 * 重对象，tree-shaking 会把 STYLE_PROMPT_SETS / SAMPLING_PROFILES / CUSTOM_JOINS
 * 从 content chunk 里 drop 掉，不会因为这次改动让 content bundle 变胖。
 *
 * 加 / 删一档策略时这里**完全不需要同步**：strategies.ts 改完 STRATEGIES_INTERNAL
 * 即可，TS 会通过 StrategyId 类型变更自动让所有引用点跟上。
 *
 * 老 settings 里残留的已下线 id（如 'fidelity'）走 DEFAULT_STRATEGY_ID 兜底。
 */
export function strategyLabel(id: StrategyId | undefined): string {
  if (!id) return '';
  return STRATEGY_LABELS[id] || STRATEGY_LABELS[DEFAULT_STRATEGY_ID];
}

// 已用时计时：loading 中每 200ms 更新一次 .elapsed 文本节点。
export function manageLoadingTicker(state: PanelState): void {
  if (state.status !== 'loading' || !state.startedAt) {
    stopLoadingTicker();
    return;
  }
  if (loadingTickHandle !== null) return;
  setLoadingTickHandle(
    window.setInterval(() => {
      if (!panel || !currentState || currentState.status !== 'loading') {
        stopLoadingTicker();
        return;
      }
      const el = panel.querySelector<HTMLElement>('[data-role="elapsed"]');
      if (el && currentState.startedAt) {
        el.textContent = formatElapsed(Date.now() - currentState.startedAt);
      }
    }, 200)
  );
}

export function stopLoadingTicker(): void {
  if (loadingTickHandle !== null) {
    window.clearInterval(loadingTickHandle);
    setLoadingTickHandle(null);
  }
}

export function formatElapsed(ms: number): string {
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)}s`;
  return `${Math.floor(s)}s`;
}

export function stageLabel(_stage: ExtractStage | undefined): string {
  // 标题统一显示"正在反推图片提示词…"，不再随阶段切换。
  // 真正的阶段信息靠下方的进度条和底部 hint 表达。
  return '正在反推图片提示词…';
}

/** loading 阶段下，进度条对应的「视觉百分比」。纯心理安抚，不代表真实进度。 */
export function stageProgress(stage: ExtractStage | undefined, hasPartial: boolean): number {
  if (stage === 'fetching') return 0.18;
  if (stage === 'streaming' || hasPartial) return 0.78;
  if (stage === 'finalizing') return 0.95;
  return 0.42; // calling
}

/**
 * loading 阶段下，进度条下方那行 hint 显示的「当前在做什么」。
 * 跟着 stage 切，让用户能看到扩展真的在推进而不是卡住。
 */
export function stageHint(stage: ExtractStage | undefined, hasPartial: boolean): string {
  if (stage === 'fetching') return '正在下载图片…';
  if (stage === 'streaming' || hasPartial) return '正在接收模型回复…';
  if (stage === 'finalizing') return '正在保存结果…';
  return '正在调用大模型…';
}

/**
 * loading 状态下的"轻量刷新"：只改阶段文案、计时、进度条宽度、流式预览
 * 的 textarea 内容，不替换 DOM 节点。
 */
export function applyLoadingPatch(state: PanelState): void {
  if (!panel) return;
  const stageEl = panel.querySelector<HTMLElement>('[data-role="stage-label"]');
  if (stageEl) stageEl.textContent = stageLabel(state.stage);

  // 策略 badge：可能在 PENDING 时还没有，要在 settings 加载完后追加上去。
  // 直接覆盖文本即可；空值时清空文本但保留节点位置不抖动 header。
  const strategyEl = panel.querySelector<HTMLElement>('[data-role="strategy-badge"]');
  if (strategyEl) {
    const label = strategyLabel(state.strategy);
    strategyEl.textContent = label ? `策略：${label}` : '';
    strategyEl.classList.toggle('hidden', !label);
  }

  // 模型 badge：和 strategy 同时（settings 加载完）补发，用 "provider · model"
  // 形式让用户看清"这次到底用谁的什么模型在跑"。空值时整块隐藏。
  const modelEl = panel.querySelector<HTMLElement>('[data-role="model-badge"]');
  if (modelEl) {
    const modelLabel = state.model
      ? `${state.provider ? state.provider + ' · ' : ''}${state.model}`
      : '';
    modelEl.textContent = modelLabel;
    modelEl.classList.toggle('hidden', !modelLabel);
    if (modelLabel) modelEl.setAttribute('title', `本次使用：${modelLabel}`);
  }

  const hasPartial = !!state.partial;
  const barEl = panel.querySelector<HTMLElement>('[data-role="bar-fill"]');
  if (barEl) {
    barEl.style.width = `${Math.round(stageProgress(state.stage, hasPartial) * 100)}%`;
  }

  const hintEl = panel.querySelector<HTMLElement>('[data-role="stage-hint"]');
  if (hintEl) hintEl.textContent = stageHint(state.stage, hasPartial);

  const elapsedEl = panel.querySelector<HTMLElement>('[data-role="elapsed"]');
  if (elapsedEl && state.startedAt) {
    elapsedEl.textContent = formatElapsed(Date.now() - state.startedAt);
  }

  // 流式预览：如果还没有 partial，则隐藏整块；有了就 lazy 渲染一个 textarea
  const previewBox = panel.querySelector<HTMLElement>('[data-role="stream-preview"]');
  if (previewBox) {
    if (hasPartial) {
      previewBox.classList.remove('hidden');
      let ta = previewBox.querySelector<HTMLTextAreaElement>('textarea');
      if (!ta) {
        ta = document.createElement('textarea');
        ta.className = 'prompt-text streaming';
        ta.setAttribute('readonly', 'true');
        ta.setAttribute('spellcheck', 'false');
        previewBox.appendChild(ta);
      }
      // 用户没主动滚动时自动跟随；否则保持滚动位置
      const atBottom =
        Math.abs(ta.scrollHeight - ta.clientHeight - ta.scrollTop) < 8;
      ta.value = state.partial || '';
      if (atBottom) ta.scrollTop = ta.scrollHeight;
    } else {
      previewBox.classList.add('hidden');
      previewBox.innerHTML = '';
    }
  }
}

// =================== AI 调整（refine）的进度辅助 ===================

/** refine 阶段下进度条的视觉百分比。比 extract 短一档，所以直接给两个固定值。 */
export function refineStageProgress(stage: RefineStage | undefined, hasPartial: boolean): number {
  if (stage === 'streaming' || hasPartial) return 0.78;
  return 0.42; // calling / 还没收到首 token
}

/** refine 阶段下进度条下方的 hint 文案。 */
export function refineStageHint(stage: RefineStage | undefined, hasPartial: boolean): string {
  if (stage === 'streaming' || hasPartial) return '正在接收模型回复…';
  return '正在调用大模型…';
}

/** refine 中每 200ms 更新一次 [data-role="refine-elapsed"]。 */
export function manageRefineTicker(state: PanelState): void {
  if (!state.refineLoading || !state.refineStartedAt) {
    stopRefineTicker();
    return;
  }
  if (refineTickHandle !== null) return;
  setRefineTickHandle(
    window.setInterval(() => {
      if (!panel || !currentState || !currentState.refineLoading) {
        stopRefineTicker();
        return;
      }
      const el = panel.querySelector<HTMLElement>('[data-role="refine-elapsed"]');
      if (el && currentState.refineStartedAt) {
        el.textContent = formatElapsed(Date.now() - currentState.refineStartedAt);
      }
    }, 200)
  );
}

export function stopRefineTicker(): void {
  if (refineTickHandle !== null) {
    window.clearInterval(refineTickHandle);
    setRefineTickHandle(null);
  }
}

/**
 * refine 阶段下的"轻量刷新"：不替换面板节点，只改进度条宽度、hint 文案、
 * elapsed 计时，**并把流式累计的 partial 直接写进主编辑器 textarea**（不再
 * 渲染单独的副预览框）。这样用户视线无需在「主输入框 / 副预览框」之间来回切，
 * 体验上更接近 ChatGPT 那种「就地刷新」的感觉。
 *
 * 注意：写入主 editor 时不会触发 input 事件（直接赋值 .value），所以 events
 * 层的 input handler 不会把 partial 误塞进 currentState.draft；refine 完成
 * 后由 renderPanel 把 editor 恢复到 readonly=false + value=resp.prompt。
 */
export function applyRefinePatch(state: PanelState): void {
  if (!panel) return;
  const hasPartial = !!state.refinePartial;
  const barEl = panel.querySelector<HTMLElement>('[data-role="refine-bar-fill"]');
  if (barEl) {
    barEl.style.width = `${Math.round(refineStageProgress(state.refineStage, hasPartial) * 100)}%`;
  }

  const hintEl = panel.querySelector<HTMLElement>('[data-role="refine-stage-hint"]');
  if (hintEl) hintEl.textContent = refineStageHint(state.refineStage, hasPartial);

  const elapsedEl = panel.querySelector<HTMLElement>('[data-role="refine-elapsed"]');
  if (elapsedEl && state.refineStartedAt) {
    elapsedEl.textContent = formatElapsed(Date.now() - state.refineStartedAt);
  }

  if (hasPartial) {
    const editor = panel.querySelector<HTMLTextAreaElement>('[data-role="editor"]');
    if (editor) {
      // 用户没主动滚动时跟随到底部；如果用户向上看历史内容，保留滚动位置。
      const atBottom =
        Math.abs(editor.scrollHeight - editor.clientHeight - editor.scrollTop) < 8;
      editor.value = state.refinePartial || '';
      if (atBottom) editor.scrollTop = editor.scrollHeight;
    }
  }
}
