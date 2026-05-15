/**
 * api 内部共享的类型与回调签名。
 *
 * 这些类型同时被 extract / refine / provider 各实现使用，
 * 抽到独立文件避免循环依赖。
 */
import type { AppSettings, ExtractStage, OutputStyle, ProviderId, RefineStage } from '../types';
import type { FetchedImage } from '../image';

/**
 * 反推过程中的进度事件。stage 表示当前阶段，partial 表示流式阶段已经
 * 累积到的提示词文本（每一条都是"到目前为止的全文"，不是 delta）。
 */
export interface ExtractProgressEvent {
  stage: ExtractStage;
  partial?: string;
}

export type ExtractProgressFn = (ev: ExtractProgressEvent) => void;

/**
 * AI 调整（refine）过程中的进度事件。和反推共用相同的 partial 语义
 * （累计全文，不是 delta），只是阶段集更小（calling / streaming）。
 */
export interface RefineProgressEvent {
  stage: RefineStage;
  partial?: string;
}

export type RefineProgressFn = (ev: RefineProgressEvent) => void;

export interface ExtractParams {
  /** 有序参考图 URL 列表，至少 1 张 */
  imageUrls: string[];
  settings: AppSettings;
  /**
   * 调用方提前下载/规整好的图片。如果传了且长度与 imageUrls 一致，extractPrompt 会跳过内部的
   * {@link import('../image').fetchImageAsBase64}，直接用这份预处理结果——用来在
   * background 里把图片下载和 settings 读取、content script 注入并行起来，节
   * 省一次串行等待。
   */
  prefetched?: FetchedImage[];
  /**
   * 反推进度回调。流式阶段会被节流到约 80ms 一次，避免给 content script
   * 发太多 chrome.tabs.sendMessage。回调里抛错不影响主流程。
   */
  onProgress?: ExtractProgressFn;
}

export interface ExtractResult {
  prompt: string;
  provider: ProviderId;
  model: string;
  style: OutputStyle;
}

export interface RefineParams {
  settings: AppSettings;
  current: string;
  instruction: string;
  /**
   * 调整进度回调。和反推一样，流式阶段会被节流到约 80ms 一次。
   * 调用方（background）通过它把 stage / partial 转发给 panel。
   * 不传则走老的"非流式静默"路径。
   */
  onProgress?: RefineProgressFn;
}

export interface RefineResult {
  prompt: string;
  provider: ProviderId;
  model: string;
}

/** 安全调用 onProgress：回调里抛错不影响主流程。 */
export function safeProgress(
  onProgress: ExtractProgressFn | undefined,
  ev: ExtractProgressEvent
): void {
  if (!onProgress) return;
  try {
    onProgress(ev);
  } catch (err) {
    console.debug('[PromptExtracto] onProgress threw', err);
  }
}

/** safeProgress 的 refine 版，签名不同（stage 取值范围更窄），逻辑一致。 */
export function safeRefineProgress(
  onProgress: RefineProgressFn | undefined,
  ev: RefineProgressEvent
): void {
  if (!onProgress) return;
  try {
    onProgress(ev);
  } catch (err) {
    console.debug('[PromptExtracto] refine onProgress threw', err);
  }
}
