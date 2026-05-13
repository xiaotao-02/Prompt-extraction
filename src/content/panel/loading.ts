import type { ExtractStage, StrategyId } from '@/lib/types';
import {
  panel,
  currentState,
  loadingTickHandle,
  setLoadingTickHandle,
} from './state';
import type { PanelState } from './state';

/**
 * 策略 id → loading 面板上显示的简短中文 label。
 *
 * 这里不直接 import `STRATEGIES` 是为了避免 content script 把 `strategies.ts`
 * 的 4 套 stylePrompts 字符串（几 KB）一起打进 bundle —— 这块代码只需要"档位名"。
 * 如果以后新增了 strategy id，这里加一行即可；未命中走 'classic' 兜底（也是
 * DEFAULT_STRATEGY_ID）。历史上短暂存在过 'fidelity' (v0.1.7) 已下线，老用户
 * 还存着这个值时会落到 fallback 分支。
 */
export const STRATEGY_LABEL: Record<StrategyId, string> = {
  classic: 'v0.1.5 策略',
  v016: 'v0.1.6 策略',
};

export function strategyLabel(id: StrategyId | undefined): string {
  if (!id) return '';
  return STRATEGY_LABEL[id] || STRATEGY_LABEL.classic;
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
