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
import type { ExtractStage, PromptVersion, RefineStage, StrategyId } from '@/lib/types';

export interface PanelState {
  /** 本次会话用于路由 EXTRACT_* 消息的 id；同图合并后可能与库 id 不同，见 {@link linkedHistoryId}。 */
  requestId: string;
  imageUrl: string;
  status: 'loading' | 'success' | 'error';
  prompt?: string;
  error?: string;
  provider?: string;
  model?: string;
  /** 当前展示的版本快照；为空表示尚未与 storage 同步 */
  versions?: PromptVersion[];
  /**
   * 提示词库里已存在的记录 id（预取命中同图时由 HISTORY_PREFETCH 填入）。
   * 在 HISTORY_READY 把 requestId 切到 actualId 之前，读写库应优先使用本字段。
   */
  linkedHistoryId?: string;
  /** 是否展开历史面板 */
  versionsOpen?: boolean;
  /** textarea 当前编辑值（脏值），与 prompt 不同则视为已编辑 */
  draft?: string;
  /**
   * 侧栏中高亮对应的版本 id（用户点击选中）。用于多条历史 prompt 文本相同时仍能
   * 区分高亮条；编辑器 input 会与 canonical prompt 对齐时清理该字段。
   */
  selectedVersionId?: string;
  /** 是否展开"AI 调整"输入区 */
  refineOpen?: boolean;
  /** 调整中 */
  refineLoading?: boolean;
  /** 调整失败信息 */
  refineError?: string;
  /** AI 调整输入框的内容（不在每次按键重渲染，仅在重新渲染时回填） */
  refineInstruction?: string;
  /**
   * AI 调整流式进度：当前阶段。仅在 refineLoading 期间有效，
   * 完成后由 events 层清空，避免下一次 refine 复用残值。
   */
  refineStage?: RefineStage;
  /** AI 调整流式累积到的文本（每次都是全文，不是 delta）。 */
  refinePartial?: string;
  /**
   * 本次 AI 调整开始瞬间的编辑器基线（与发往后台的 current 一致）。
   * 首 token 未到时主编辑区回落到此，避免空白；结束/失败后清空。
   */
  refineBaselinePrompt?: string;
  /** AI 调整开始时间戳，用于 UI 上显示 "已用时 xx s"。 */
  refineStartedAt?: number;
  /**
   * 反推进度阶段。loading 状态下用来切换"下载图片 / 调用模型 / 接收回复"
   * 三段文案，success/error 时被清成 undefined。
   */
  stage?: ExtractStage;
  /** 流式阶段累积到的提示词文本（loading 时实时显示）。 */
  partial?: string;
  /**
   * 点击「重新生成」进入 loading 时，保留上一份提示词作基线（首 token 前主编辑区回落）。
   * success/error 后清空。
   */
  extractBaselinePrompt?: string;
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

/**
 * 浮动面板的位置 + 尺寸。
 *
 * - left/top：必填，视口坐标（px）。
 * - width：可选；用户没动过 resize 时为 undefined，让 CSS 默认值生效。
 * - height：可选；同上，默认 auto，由内容决定。
 *
 * 用户拖动 header 时会更新 left/top；用户拖任意边缘 / 角落 resize 时会更新
 * width/height（西/北方向同时会动 left/top 以保持对侧边固定）。
 * 跨 renderPanel 重渲染时这块状态不变，确保面板"哪儿就停哪儿"。
 */
export interface PanelGeometry {
  left: number;
  top: number;
  width?: number;
  height?: number;
}

export let host: HTMLDivElement | null = null;
export let shadow: ShadowRoot | null = null;
export let panel: HTMLDivElement | null = null;
export let currentState: PanelState | null = null;
/**
 * loading 状态下每 200ms 跑一次的"已用时"刷新句柄。
 * 只更新 DOM 文本节点，不重渲整片面板，以免抖动。
 */
export let loadingTickHandle: number | null = null;
/**
 * AI 调整中的"已用时"刷新句柄。和 loadingTickHandle 互不重叠 ——
 * loading 状态没有 refine 框，refine 只在 success 状态下出现。
 */
export let refineTickHandle: number | null = null;
/**
 * 当前面板的几何快照。null 表示尚未初始化（首次 ensureHost 时会设上）。
 * 这是模块级单例，跨 renderPanel 重渲染保留。
 */
export let panelGeometry: PanelGeometry | null = null;

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
export function setRefineTickHandle(v: number | null) {
  refineTickHandle = v;
}
export function setPanelGeometry(v: PanelGeometry | null) {
  panelGeometry = v;
}

export const panelActions = {
  renderPanel: (_state: PanelState): void => {},
  closePanel: (): void => {},
};
