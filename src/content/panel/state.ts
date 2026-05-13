/**
 * 浮动面板的运行时状态。
 *
 * 这些是 content script 模块内的单例状态：
 * - host / shadow / panel：DOM 节点引用
 * - currentState：当前面板状态快照
 * - loadingTickHandle：loading 状态下"已用时"刷新的 setInterval 句柄
 *
 * 使用 `export let` + 显式 setter 函数模式，
 * 让所有子模块都能读到同一份单例，避免重复挂载 Shadow DOM。
 */
import type { ExtractStage, PromptVersion, StrategyId } from '@/lib/types';

export interface PanelState {
  requestId: string;
  imageUrl: string;
  status: 'loading' | 'success' | 'error';
  prompt?: string;
  error?: string;
  provider?: string;
  model?: string;
  /** 当前展示的版本快照；为空表示尚未与 storage 同步 */
  versions?: PromptVersion[];
  /** 是否展开历史面板 */
  versionsOpen?: boolean;
  /** textarea 当前编辑值（脏值），与 prompt 不同则视为已编辑 */
  draft?: string;
  /** 是否展开"AI 调整"输入区 */
  refineOpen?: boolean;
  /** 调整中 */
  refineLoading?: boolean;
  /** 调整失败信息 */
  refineError?: string;
  /** AI 调整输入框的内容（不在每次按键重渲染，仅在重新渲染时回填） */
  refineInstruction?: string;
  /**
   * 反推进度阶段。loading 状态下用来切换"下载图片 / 调用模型 / 接收回复"
   * 三段文案，success/error 时被清成 undefined。
   */
  stage?: ExtractStage;
  /** 流式阶段累积到的提示词文本（loading 时实时显示）。 */
  partial?: string;
  /** loading 开始时间戳，用于 UI 上显示 "已用时 xx s"。 */
  startedAt?: number;
  /**
   * 本次反推使用的「提示词策略档位」id。
   *
   * 由后台在 settings 加载完成后通过 EXTRACT_PENDING / EXTRACT_PROGRESS 透传，
   * 仅用于在 loading 状态下亮一个 "策略：v0.1.5 策略" 之类的标签，
   * 让用户清楚当前生效的是哪一档。后续如果想在 success 状态也显示，
   * 直接复用同一字段即可。
   */
  strategy?: StrategyId;
}

export const HOST_ID = '__image_prompt_extractor_host__';

export let host: HTMLDivElement | null = null;
export let shadow: ShadowRoot | null = null;
export let panel: HTMLDivElement | null = null;
export let currentState: PanelState | null = null;
/**
 * loading 状态下每 200ms 跑一次的"已用时"刷新句柄。
 * 只更新 DOM 文本节点，不重渲整片面板，以免抖动。
 */
export let loadingTickHandle: number | null = null;

export function setHost(v: HTMLDivElement | null) {
  host = v;
}
export function setShadow(v: ShadowRoot | null) {
  shadow = v;
}
export function setPanel(v: HTMLDivElement | null) {
  panel = v;
}
export function setCurrentState(v: PanelState | null) {
  currentState = v;
}
export function setLoadingTickHandle(v: number | null) {
  loadingTickHandle = v;
}

export const panelActions = {
  renderPanel: (_state: PanelState): void => {},
  closePanel: (): void => {},
};
