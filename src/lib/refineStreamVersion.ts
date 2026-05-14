/**
 * 哨兵 id：AI 调整流式生成期间，版本侧栏「生成中」占位行与会话内选中态。
 * 不与 storage 落库的版本 id 混用。
 */
export const REFINE_STREAM_VERSION_ID = '__pe_refine_stream__';

/** 反推 / 重新生成（loading 流式）期间的占位行与选中态。 */
export const EXTRACT_STREAM_VERSION_ID = '__pe_extract_stream__';

/** AI 调整流式视图下主编辑器应展示的正文（含首 token 前的基线回落）。 */
export function refineStreamDisplayedBody(state: {
  refinePartial?: string;
  refineBaselinePrompt?: string;
  draft?: string;
  prompt?: string;
}): string {
  return state.refinePartial ?? state.refineBaselinePrompt ?? state.draft ?? state.prompt ?? '';
}

/** loading 态下主编辑器展示的流式正文（含首 token 前的基线）。 */
export function extractStreamDisplayedBody(state: {
  partial?: string;
  extractBaselinePrompt?: string;
  draft?: string;
  prompt?: string;
}): string {
  return state.partial ?? state.extractBaselinePrompt ?? state.prompt ?? state.draft ?? '';
}
