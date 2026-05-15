/**
 * 哨兵 id：AI 调整流式生成期间，版本侧栏「生成中」占位行与会话内选中态。
 * 不与 storage 落库的版本 id 混用。
 */
export const REFINE_STREAM_VERSION_ID = '__pe_refine_stream__';

/** 反推 / 重新生成（loading 流式）期间的占位行与选中态。 */
export const EXTRACT_STREAM_VERSION_ID = '__pe_extract_stream__';

export function refineStreamSentinelForJob(jobId: string): string {
  return `${REFINE_STREAM_VERSION_ID}:${jobId}`;
}

export function extractStreamSentinelForJob(streamRequestId: string): string {
  return `${EXTRACT_STREAM_VERSION_ID}:${streamRequestId}`;
}

export function parseRefineJobSentinel(selectedVersionId: string | undefined): string | undefined {
  if (!selectedVersionId?.startsWith(`${REFINE_STREAM_VERSION_ID}:`)) return undefined;
  return selectedVersionId.slice(REFINE_STREAM_VERSION_ID.length + 1);
}

export function parseExtractJobSentinel(selectedVersionId: string | undefined): string | undefined {
  if (!selectedVersionId?.startsWith(`${EXTRACT_STREAM_VERSION_ID}:`)) return undefined;
  return selectedVersionId.slice(EXTRACT_STREAM_VERSION_ID.length + 1);
}

/** AI 调整流式视图下主编辑器应展示的正文（含首 token 前的基线回落）。 */
export function refineStreamDisplayedBody(state: {
  refineJobs?: ReadonlyArray<{
    jobId: string;
    partial?: string;
    refineBaselinePrompt: string;
  }>;
  refinePartial?: string;
  refineBaselinePrompt?: string;
  draft?: string;
  prompt?: string;
  selectedVersionId?: string | null;
}): string {
  const jid = parseRefineJobSentinel(state.selectedVersionId ?? undefined);
  if (jid) {
    const job = state.refineJobs?.find((j) => j.jobId === jid);
    if (job) {
      return job.partial ?? job.refineBaselinePrompt ?? state.draft ?? state.prompt ?? '';
    }
  }
  if (
    state.selectedVersionId === REFINE_STREAM_VERSION_ID &&
    state.refineJobs?.length === 1
  ) {
    const one = state.refineJobs[0]!;
    return one.partial ?? one.refineBaselinePrompt ?? state.draft ?? state.prompt ?? '';
  }
  return (
    state.refinePartial ??
    state.refineBaselinePrompt ??
    state.draft ??
    state.prompt ??
    ''
  );
}

/** loading 态下主编辑器展示的流式正文（含首 token 前的基线）。 */
export function extractStreamDisplayedBody(state: {
  extractJobs?: ReadonlyArray<{
    streamRequestId: string;
    partial?: string;
  }>;
  partial?: string;
  extractBaselinePrompt?: string;
  draft?: string;
  prompt?: string;
  selectedVersionId?: string | null;
}): string {
  const sid = parseExtractJobSentinel(state.selectedVersionId ?? undefined);
  if (sid) {
    const job = state.extractJobs?.find((j) => j.streamRequestId === sid);
    if (job) {
      return job.partial ?? state.extractBaselinePrompt ?? state.prompt ?? state.draft ?? '';
    }
  }
  if (
    state.selectedVersionId === EXTRACT_STREAM_VERSION_ID &&
    state.extractJobs?.length === 1
  ) {
    const one = state.extractJobs[0]!;
    return one.partial ?? state.extractBaselinePrompt ?? state.prompt ?? state.draft ?? '';
  }
  return state.partial ?? state.extractBaselinePrompt ?? state.prompt ?? state.draft ?? '';
}
