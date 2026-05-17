import type { OneClickRewriteRandomness, PromptVersion } from '@/lib/types';
import {
  normalizeOneClickRewriteRandomness,
  REWRITE_RANDOMNESS_LABELS,
} from '@/lib/oneClickRewrite';
import {
  REFINE_STREAM_VERSION_ID,
  EXTRACT_STREAM_VERSION_ID,
  extractStreamDisplayedBody,
  refineStreamDisplayedBody,
  extractStreamSentinelForJob,
  refineStreamSentinelForJob,
  parseExtractJobSentinel,
  parseRefineJobSentinel,
} from '@/lib/refineStreamVersion';
import { getVersionOrdinalLabel } from '@/lib/versionLabel';
import { DEFAULT_STRATEGY_ID, STRATEGY_LABELS, type StrategyId } from '@/lib/strategies-meta';
import type { PanelState, PanelRefineJob } from './state';
import {
  panelExtractJobs,
  panelHasActiveRefine,
  panelRefineJobs,
  primaryRefineJobForUi,
} from './state';
import { panelReferenceUrls } from './state';
import { MAX_REFERENCE_IMAGES } from '@/lib/referenceImages';
import { REFINE_PRESETS } from '@/lib/refineSuggestions';
import { formatTime } from '@/lib/format/time';
import {
  ICON_CLOSE,
  ICON_COPY,
  ICON_REFRESH,
  ICON_SAVE,
  ICON_HISTORY,
  ICON_RESTORE,
  ICON_SPARK,
  ICON_LIBRARY,
  ICON_TRASH,
} from './icons';
import {
  stageLabel,
  stageHint,
  stageProgress,
  formatElapsed,
  strategyLabel,
  refineStageHint,
  refineStageProgress,
} from './loading';

export function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
export function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
}

function referenceStripHtml(state: PanelState, removable: boolean): string {
  const urls = panelReferenceUrls(state);
  if (urls.length === 0) {
    return '<div class="ref-strip ref-strip-empty" data-role="ref-strip"></div>';
  }
  return (
    `<div class="ref-strip" data-role="ref-strip">` +
    urls
      .map((u, i) => {
        const rm = removable
          ? `<button type="button" class="ref-remove" data-action="remove-reference" data-index="${i}" title="移除">×</button>`
          : '';
        return `<div class="ref-item">${rm}<img src="${escapeAttr(u)}" alt="" /></div>`;
      })
      .join('') +
    `</div>`
  );
}

/**
 * 自定义策略下拉选择器。用 div 代替原生 `<select>`，
 * 以便完全控制下拉列表在亮/暗色模式下的外观。
 */
function strategySelectHtml(currentStrategy: StrategyId | undefined): string {
  const entries = Object.entries(STRATEGY_LABELS) as [StrategyId, string][];
  const effectiveStrategy = currentStrategy ?? DEFAULT_STRATEGY_ID;
  const currentLabel = STRATEGY_LABELS[effectiveStrategy] ?? '';
  const items = entries
    .map(([id, label]) => {
      const active = id === effectiveStrategy ? ' active' : '';
      return `<li class="sd-item${active}" data-strategy="${escapeAttr(id)}">${escapeText(label)}</li>`;
    })
    .join('');
  return `
    <div class="strategy-dropdown" data-role="strategy-dropdown" title="切换策略后需点击重新生成生效">
      <button class="sd-trigger" type="button">
        <span class="sd-label">${escapeText(currentLabel)}</span>
        <svg class="sd-arrow" width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <ul class="sd-menu">${items}</ul>
    </div>`;
}

/**
 * 「随机风格强度」下拉：结构与 {@link strategySelectHtml} 一致，便于复用 `.strategy-dropdown` / `.sd-*` 样式。
 */
function rewriteRandomnessSelectHtml(rr: OneClickRewriteRandomness, disabled: boolean): string {
  const keys = ['subtle', 'moderate', 'bold'] as const satisfies readonly OneClickRewriteRandomness[];
  const currentLabel = REWRITE_RANDOMNESS_LABELS[rr];
  const items = keys
    .map((id) => {
      const active = id === rr ? ' active' : '';
      return `<li class="sd-item${active}" data-randomness="${escapeAttr(id)}">${escapeText(
        REWRITE_RANDOMNESS_LABELS[id]
      )}</li>`;
    })
    .join('');
  const wrapDisabled = disabled ? ' is-disabled' : '';
  return `
    <div class="strategy-dropdown rewrite-randomness-dropdown${wrapDisabled}" data-role="rewrite-randomness-dropdown" aria-label="随机风格强度" title="随机风格强度">
      <button class="sd-trigger" type="button" ${disabled ? 'disabled' : ''}>
        <span class="sd-label">${escapeText(currentLabel)}</span>
        <svg class="sd-arrow" width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <ul class="sd-menu">${items}</ul>
    </div>`;
}

function refineBlockHtml(
  state: PanelState,
  options: { runDisabled?: boolean; runIdleLabel?: string } = {}
): string {
  const refining = panelHasActiveRefine(state);
  const prim = primaryRefineJobForUi(state);
  const refineInstruction = state.refineInstruction ?? '';
  const refineHasPartial = !!prim?.partial;
  const refinePct = Math.round(
    refineStageProgress(prim?.stage, refineHasPartial) * 100
  );
  const refineElapsed =
    prim?.startedAt != null ? formatElapsed(Date.now() - prim.startedAt) : '0.0s';
  const refineProgressBlock = refining
    ? `
        <div class="refine-progress" data-role="refine-progress">
          <div class="bar progress">
            <span data-role="refine-bar-fill" style="width:${refinePct}%"></span>
          </div>
          <div class="hint hint-row">
            <span data-role="refine-stage-hint">${escapeText(
              refineStageHint(prim?.stage, refineHasPartial)
            )}</span>
            <span class="elapsed" data-role="refine-elapsed">${escapeText(refineElapsed)}</span>
          </div>
        </div>
      `
    : '';
  const refineSlotHidden = state.refineOpen ? '' : ' hidden';
  const runDisabled = refining || !!options.runDisabled;
  const runIdleLabel = options.runIdleLabel || '让 AI 调整';

  return `
        <div class="refine-slot${refineSlotHidden}" data-role="refine-slot">
          <div class="refine-box ${refining ? 'loading' : ''}">
            <div class="refine-head">
              <span>${ICON_SPARK}<span>告诉我怎么调整这条提示词</span></span>
              <button class="icon-btn" data-action="toggle-refine" title="收起">${ICON_CLOSE}</button>
            </div>
            <textarea
              class="refine-input"
              data-role="refine-input"
              spellcheck="false"
              placeholder="例如：扩写提示词、优化提示词、提取材质、提取风格、改得更电影感、翻译成英文…（下方预设点击即运行）"
              ${refining ? 'disabled' : ''}
            >${escapeText(refineInstruction)}</textarea>
            ${
              state.refineError
                ? `<div class="refine-error">${escapeText(state.refineError)}</div>`
                : ''
            }
            ${
              refining
                ? ''
                : `<div class="refine-suggest">
              ${REFINE_PRESETS.map(
                (p) =>
                  `<button type="button" class="chip" data-action="refine-suggest" data-text="${escapeAttr(
                    p.instruction
                  )}" title="${p.instruction.length > 24 ? escapeAttr('点击直接运行') : ''}">${escapeText(
                    p.label
                  )}</button>`
              ).join('')}
            </div>`
            }
            ${refineProgressBlock}
            <div class="refine-actions">
              <button class="btn ghost" data-action="toggle-refine" ${
                refining ? 'disabled' : ''
              }>取消</button>
              <button class="btn primary" data-action="run-refine" ${runDisabled ? 'disabled' : ''}>
                ${
                  refining
                    ? `<span class="spinner"></span><span>调整中…</span>`
                    : `${ICON_SPARK}<span>${escapeText(runIdleLabel)}</span>`
                }
              </button>
            </div>
          </div>
        </div>
      `;
}

function metaRowHtml(
  state: PanelState,
  options: {
    versionCount: number;
    dirty: boolean;
    disableHistory?: boolean;
    disableLibrary?: boolean;
  }
): string {
  const historyDisabled = options.disableHistory || options.versionCount === 0;
  const libraryDisabled = !!options.disableLibrary;
  return `
        <div class="meta-row">
          <div class="meta-left">
            <button
              class="link-btn ${state.versionsOpen ? 'active' : ''}"
              data-action="toggle-versions"
              ${historyDisabled ? 'disabled' : ''}
            >${ICON_HISTORY}<span>历史版本 · ${options.versionCount}</span></button>
            ${strategySelectHtml(state.strategy)}
            <button
              class="link-btn ${state.refineOpen ? 'active' : ''}"
              data-action="toggle-refine"
            >${ICON_SPARK}<span>AI 调整</span></button>
            <button
              class="link-btn"
              data-action="open-in-library"
              title="跳转到提示词库，进行更完整的编辑、备注、版本管理"
              ${libraryDisabled ? 'disabled' : ''}
            >${ICON_LIBRARY}<span>提示词库</span></button>
          </div>
          <span class="dirty-hint ${!panelHasActiveRefine(state) && options.dirty ? 'show' : ''}">已修改，未保存</span>
        </div>
      `;
}

function actionsHtml(
  dirty: boolean,
  options: {
    loading?: boolean;
    canCopy?: boolean;
    rewriteRandomness?: OneClickRewriteRandomness;
    rewriteControlsDisabled?: boolean;
  } = {}
): string {
  const loading = !!options.loading;
  const canCopy = options.canCopy ?? !loading;
  const rr = normalizeOneClickRewriteRandomness(options.rewriteRandomness);
  const rewriteDisabled = loading || !!options.rewriteControlsDisabled;

  const rewriteSpinBtn = `<button class="btn ghost rewrite-spin-btn ${rewriteDisabled ? 'disabled' : ''}" data-action="rewrite-spin" ${
    rewriteDisabled ? 'disabled' : ''
  }><span>随机风格</span></button>`;

  const rewriteDropdown = rewriteRandomnessSelectHtml(rr, rewriteDisabled);

  const rewriteControlHtml = loading
    ? rewriteSpinBtn
    : `<div class="rewrite-control-group">${rewriteDropdown}${rewriteSpinBtn}</div>`;

  return `
        <div class="actions">
          <button type="button" class="btn ghost" data-action="retry">${ICON_REFRESH}<span>重新生成</span></button>
          ${rewriteControlHtml}
          <button class="btn ${!loading && dirty ? 'primary' : 'ghost disabled'}" data-action="save" ${
    !loading && dirty ? '' : 'disabled'
  }>${ICON_SAVE}<span>保存为新版本</span></button>
          <button class="btn primary ${canCopy ? '' : 'disabled'}" data-action="copy" data-role="copy-button" ${
    canCopy ? '' : 'disabled'
  }>${ICON_COPY}<span>复制</span></button>
        </div>
      `;
}

/**
 * 历史版本侧栏与 `panel-row` 的 `.versions-open` class（success 与 loading 共用）。
 */
/** success 态主编辑器展示用：区分 AI 调整流式 vs 预览某条历史版本。 */
export function successEditorDisplayedText(state: PanelState): string {
  const draft = state.draft ?? state.prompt ?? '';
  const sel = state.selectedVersionId;

  if (parseExtractJobSentinel(sel ?? undefined) && panelExtractJobs(state).length > 0) {
    return extractStreamDisplayedBody({ ...state, selectedVersionId: sel });
  }
  if (
    (parseRefineJobSentinel(sel ?? undefined) || sel === REFINE_STREAM_VERSION_ID) &&
    panelHasActiveRefine(state)
  ) {
    return refineStreamDisplayedBody({ ...state, selectedVersionId: sel });
  }

  if (!panelHasActiveRefine(state)) {
    return draft;
  }

  if (
    sel &&
    sel !== REFINE_STREAM_VERSION_ID &&
    !sel.startsWith(`${REFINE_STREAM_VERSION_ID}:`)
  ) {
    const v = state.versions?.find((x) => x.id === sel);
    if (v) return v.prompt;
  }
  return refineStreamDisplayedBody(state);
}

/** loading（重新生成/反推流式）态主编辑器：区分流式 vs 预览历史版本。 */
export function loadingEditorDisplayedText(state: PanelState): string {
  if (state.status === 'loading') {
    const sel = state.selectedVersionId;
    if (
      sel &&
      sel !== EXTRACT_STREAM_VERSION_ID &&
      !sel.startsWith(`${EXTRACT_STREAM_VERSION_ID}:`)
    ) {
      const v = state.versions?.find((x) => x.id === sel);
      if (v) return v.prompt;
    }
    return extractStreamDisplayedBody(state);
  }
  if (panelExtractJobs(state).length > 0) {
    return extractStreamDisplayedBody(state);
  }
  return state.partial ?? '';
}

function extractPendingVersionRowHtml(streamRequestId: string, state: PanelState): string {
  const sentinel = extractStreamSentinelForJob(streamRequestId);
  const selected = state.selectedVersionId === sentinel;
  return `
    <li
      class="version-item refine-pending${selected ? ' selected' : ''}"
      data-action="select-version"
      data-version-id="${escapeAttr(sentinel)}"
      role="button"
      tabindex="0"
      title="点击查看本次重新生成中的提示词"
    >
      <div class="version-head">
        <span class="version-ord middle">生成中</span>
        <span class="version-tag extracted">反推</span>
        <span class="version-time">进行中</span>
      </div>
      <div class="version-preview">正在重新生成提示词，可切换到其它行预览历史版本…</div>
    </li>
  `;
}

function refinePendingVersionRowHtml(job: PanelRefineJob, state: PanelState): string {
  const sentinel = refineStreamSentinelForJob(job.jobId);
  const selected = state.selectedVersionId === sentinel;
  const tagLabel = job.kind === 'rewrite' ? '随机风格' : 'AI 调整';
  const preview =
    job.kind === 'rewrite'
      ? '正在生成随机风格变体，可切换到其它行预览历史正文…'
      : '正在根据你的要求生成新版本，可切换到其它行预览历史正文…';
  return `
    <li
      class="version-item refine-pending${selected ? ' selected' : ''}"
      data-action="select-version"
      data-version-id="${escapeAttr(sentinel)}"
      role="button"
      tabindex="0"
      title="点击查看生成中的提示词"
    >
      <div class="version-head">
        <span class="version-ord middle">生成中</span>
        <span class="version-tag refined">${escapeText(tagLabel)}</span>
        <span class="version-time">进行中</span>
      </div>
      <div class="version-preview">${escapeText(preview)}</div>
    </li>
  `;
}

/** 供 panelHtml 与 patchVersionList 共用，避免侧栏 DOM 与整页模板分叉。 */
export function buildVersionsListInnerHtml(state: PanelState): string {
  const versions = state.versions || [];
  const editorContent = state.draft ?? state.prompt ?? '';
  const extractSlots =
    state.status === 'success' || (state.status === 'loading' && versions.length > 0)
      ? panelExtractJobs(state)
          .map((j) => extractPendingVersionRowHtml(j.streamRequestId, state))
          .join('')
      : '';
  const refineSlots = panelRefineJobs(state)
    .map((j) => refinePendingVersionRowHtml(j, state))
    .join('');
  const leading = refineSlots + extractSlots;
  return (
    leading +
    versionsListHtml(versions, editorContent, state.selectedVersionId, {
      provider: state.provider,
      model: state.model,
      strategy: state.strategy,
    })
  );
}

function versionsChromeForRow(
  state: PanelState,
  versions: PromptVersion[],
  _editorContent: string
): { sidebar: string; openClassSuffix: string } {
  const baseLen = versions.length;
  const extractSlots =
    state.status === 'success' || (state.status === 'loading' && baseLen > 0)
      ? panelExtractJobs(state).length
      : 0;
  const showSidebar =
    baseLen > 0 || panelHasActiveRefine(state) || extractSlots > 0;
  if (!showSidebar) {
    return { sidebar: '', openClassSuffix: '' };
  }
  const displayCount = baseLen + panelRefineJobs(state).length + extractSlots;
  const openClassSuffix = state.versionsOpen ? ' versions-open' : '';
  const sidebar = `
        <aside class="versions-side" data-role="versions-side">
          <div class="versions-head">
            <span>历史版本 · ${displayCount}</span>
            <button class="icon-btn" data-action="toggle-versions" title="收起">${ICON_CLOSE}</button>
          </div>
          <ul class="versions-list">
            ${buildVersionsListInnerHtml(state)}
          </ul>
        </aside>
      `;
  return { sidebar, openClassSuffix };
}

/** 插在 panel-surface 最前：`aria-live` 状态播报（仅在 status 切换时写入文案）。 */
export const PANEL_ANNOUNCE_HTML =
  '<div data-role="panel-announce" aria-live="polite" aria-atomic="true" class="panel-sr-announce"></div>';

export function panelHtml(state: PanelState): string {
  if (state.status === 'loading') {
    const versions = state.versions || [];
    const versionCount = versions.length;
    const extractSidebarCount =
      versionCount > 0 ? panelExtractJobs(state).length : 0;
    const versionsDisplayCount =
      versionCount + extractSidebarCount + panelRefineJobs(state).length;
    const anyExtractPartial = panelExtractJobs(state).some((j) =>
      !!(j.partial ?? '').trim()
    );
    const hasPartial =
      anyExtractPartial ||
      !!(state.partial ?? '').trim() ||
      !!(state.extractBaselinePrompt?.trim());
    const pct = Math.round(stageProgress(state.stage, hasPartial) * 100);
    const elapsed =
      state.startedAt != null ? formatElapsed(Date.now() - state.startedAt) : '0.0s';
    const stratLabel = strategyLabel(state.strategy);
    const modelLabel = state.model
      ? `${state.provider ? state.provider + ' · ' : ''}${state.model}`
      : '';
    const canCopyLoading = hasPartial || !!(state.extractBaselinePrompt?.trim());
    const { sidebar: versionsSidebar, openClassSuffix: versionsOpenClass } = versionsChromeForRow(
      state,
      versions,
      ''
    );
    const loadingEditorBody = loadingEditorDisplayedText(state);
    return `
      <div class="header">
        <div class="title">
          <span class="dot loading"></span>
          <span data-role="stage-label">${escapeText(stageLabel(state.stage))}</span>
          <span class="badge model-badge ${modelLabel ? '' : 'hidden'}" data-role="model-badge" title="${
            modelLabel ? escapeAttr(`本次使用：${modelLabel}`) : ''
          }">${modelLabel ? escapeText(modelLabel) : ''}</span>
          <span class="badge strategy-badge ${stratLabel ? '' : 'hidden'}" data-role="strategy-badge">${
            stratLabel ? `策略：${escapeText(stratLabel)}` : ''
          }</span>
        </div>
        <button class="icon-btn" data-action="close" title="关闭">${ICON_CLOSE}</button>
      </div>
      <div class="panel-row${versionsOpenClass}">
        ${versionsSidebar}
        <div class="body">
          <div class="thumb ref-thumb-wrap">${referenceStripHtml(state, false)}</div>
          <div class="loader-wrap">
            <div class="bar progress">
              <span data-role="bar-fill" style="width:${pct}%"></span>
            </div>
            <div class="hint hint-row">
              <span data-role="stage-hint">${escapeText(stageHint(state.stage, hasPartial))}</span>
              <span class="elapsed" data-role="elapsed">${escapeText(elapsed)}</span>
            </div>
          </div>
          <div class="prompt-editor-wrap">
            <textarea
              class="prompt-text streaming"
              data-role="editor"
              readonly
              spellcheck="false"
              placeholder="正在接收模型回复…"
            >${escapeText(loadingEditorBody)}</textarea>
            <span class="editor-char-count" data-role="editor-char-count" aria-live="polite">${[...loadingEditorBody].length} 字</span>
          </div>
          ${metaRowHtml(state, {
            versionCount: versionsDisplayCount,
            dirty: false,
            disableHistory: versionCount === 0,
            disableLibrary: true,
          })}
          ${refineBlockHtml(state, {
            runDisabled: true,
            runIdleLabel: '生成后可调整',
          })}
          ${actionsHtml(false, { loading: true, canCopy: canCopyLoading })}
        </div>
      </div>
    `;
  }
  if (state.status === 'error') {
    return `
      <div class="header">
        <div class="title">
          <span class="dot error"></span>
          <span>提取失败</span>
        </div>
        <button class="icon-btn" data-action="close" title="关闭">${ICON_CLOSE}</button>
      </div>
      <div class="body">
        <div class="thumb ref-thumb-wrap">${referenceStripHtml(state, true)}</div>
        <div class="error-msg">${escapeText(state.error || '未知错误')}</div>
        <div class="actions">
          <button class="btn ghost" data-action="open-options">打开设置</button>
          <button class="btn primary" data-action="retry">重试</button>
        </div>
      </div>
    `;
  }
  if (state.status === 'compose') {
    const urls = panelReferenceUrls(state);
    const canRun = urls.length > 0;
    const atCap = urls.length >= MAX_REFERENCE_IMAGES;
    return `
      <div class="header">
        <div class="title">
          <span class="dot success"></span>
          <span>收集参考图</span>
        </div>
        <button class="icon-btn" data-action="close" title="关闭">${ICON_CLOSE}</button>
      </div>
      <div class="body compose-body">
        ${referenceStripHtml(state, true)}
        <div class="compose-toolbar">
          <input type="text" class="ref-url-input" data-role="ref-url-input" placeholder="粘贴图片 URL 后点击添加" ${
            atCap ? 'disabled' : ''
          } />
          <button type="button" class="btn ghost sm" data-action="add-ref-url" ${
            atCap ? 'disabled' : ''
          }>添加</button>
          <button type="button" class="btn ghost sm" data-action="pick-ref-file" ${
            atCap ? 'disabled' : ''
          }>本地图片</button>
          <input type="file" class="ref-file-input-hidden" data-role="ref-file-input" accept="image/*" />
        </div>
        <p class="compose-hint">图片 / 视频上右键一级「添加到参考」可继续收集；点「生成提示词」完整反推，或「提取材质 / 提取风格」收窄维度。当前 ${urls.length} / ${MAX_REFERENCE_IMAGES} 张。</p>
        <div class="compose-meta">${strategySelectHtml(state.strategy)}</div>
        <div class="actions compose-actions">
          <button type="button" class="btn ghost sm" data-action="run-extract-material" ${
            canRun ? '' : 'disabled'
          }>提取材质</button>
          <button type="button" class="btn ghost sm" data-action="run-extract-style" ${
            canRun ? '' : 'disabled'
          }>提取风格</button>
          <button type="button" class="btn primary" data-action="run-extract" ${
            canRun ? '' : 'disabled'
          }>生成提示词</button>
        </div>
      </div>
    `;
  }

  const versions = state.versions || [];
  const versionCount = versions.length;
  const refining = panelHasActiveRefine(state);
  const streamingExtract = panelExtractJobs(state).length > 0;
  const extractStreamingUi =
    streamingExtract &&
    parseExtractJobSentinel(state.selectedVersionId ?? undefined) != null;
  const editorLocked = refining || extractStreamingUi;
  const versionsDisplayCount =
    versionCount + panelRefineJobs(state).length + panelExtractJobs(state).length;
  const draft = state.draft ?? state.prompt ?? '';
  const dirty = refining ? false : draft !== (state.prompt ?? '');

  // 历史版本侧栏：始终渲染在 DOM 里（只要有版本数据），用 .panel-row.versions-open
  // 这个 class 控制滑入/滑出。这样 toggle 的时候不需要 renderPanel，避免主面板尺寸
  // 还原、编辑器失焦、动画重放等问题。
  //
  // 没版本时（versionCount === 0）直接不渲染，等首次保存后 syncVersions 会触发完整
  // 重渲再把节点塞进来。
  // 列表里"哪一条被高亮"以 editor 当前内容（draft，回落到 prompt）为准，
  // 这样在 dirty 状态下高亮也是用户**正在看的那条**，而不是被保存的主版本。
  const editorContent = state.draft ?? state.prompt ?? '';
  const { sidebar: versionsSidebar, openClassSuffix: versionsOpenClass } = versionsChromeForRow(
    state,
    versions,
    editorContent
  );

  // refine-box 始终渲染在 DOM 里（用 .refine-slot.hidden 控制显隐），
  // 这样 toggle-refine 时只需要切 class，不必整面板重渲 → 不会 reset 几何、
  // 不会让编辑器失焦、不会重放 panelIn 动画。
  //
  // 注意：refining 状态下的内部结构变化（progress block 显隐、suggest chips
  // 隐藏、按钮换 spinner 等）仍然走 renderPanel，因为那是用户主动确认操作
  // 后的"语义变化"，重渲一次是符合预期的。
  const refineBlock = refineBlockHtml(state);
  const successEditorBody = successEditorDisplayedText(state);

  return `
    <div class="header">
      <div class="title">
        <span class="dot success"></span>
        <span>提示词已生成</span>
        <span class="badge">${escapeText(state.provider || '')}${
    state.model ? ' · ' + escapeText(state.model) : ''
  }</span>
      </div>
      <button class="icon-btn" data-action="close" title="关闭">${ICON_CLOSE}</button>
    </div>
    <div class="panel-row${versionsOpenClass}">
      ${versionsSidebar}
      <div class="body">
        <div class="thumb ref-thumb-wrap">${referenceStripHtml(state, true)}</div>
        <div class="prompt-editor-wrap">
          <textarea
            class="prompt-text${editorLocked ? ' streaming' : ''}"
            data-role="editor"
            spellcheck="false"
            placeholder="${
              refining
                ? '正在接收 AI 调整后的提示词…'
                : extractStreamingUi
                  ? '正在接收模型回复…'
                  : '可在此修改提示词…'
            }"
            ${editorLocked ? 'readonly' : ''}
          >${escapeText(successEditorBody)}</textarea>
          <span class="editor-char-count" data-role="editor-char-count" aria-live="polite">${[...successEditorBody].length} 字</span>
        </div>
        ${metaRowHtml(state, {
          versionCount: versionsDisplayCount,
          dirty,
          disableHistory: versionCount === 0 && !refining && !streamingExtract,
        })}
        ${refineBlock}
        ${actionsHtml(dirty, {
          rewriteRandomness: state.rewriteRandomness,
          rewriteControlsDisabled: refining || editorContent.trim().length === 0,
        })}
      </div>
    </div>
  `;
}

/** 渲染历史版本 `<ul>` 内全部 `<li>`，供 panelHtml / syncVersions 局部 patch 复用。 */
export function versionsListHtml(
  versions: PromptVersion[],
  editorContent: string,
  selectedVersionId?: string,
  fallbackMeta?: { provider?: string; model?: string; strategy?: StrategyId }
): string {
  return versions
    .map((v, i) => versionItemHtml(v, i, versions.length, editorContent, selectedVersionId, fallbackMeta))
    .join('');
}

export function versionItemHtml(
  v: PromptVersion,
  index: number,
  total: number,
  editorContent: string,
  selectedVersionId?: string,
  fallbackMeta?: { provider?: string; model?: string; strategy?: StrategyId }
): string {
  const isCurrent = index === 0;
  const time = formatTime(v.createdAt);
  const tag = sourceLabel(v.source);
  const ord = getVersionOrdinalLabel(v.versionNo, isCurrent);
  const preview = v.prompt.replace(/\s+/g, ' ').slice(0, 120);
  const provider = v.meta?.provider ?? fallbackMeta?.provider;
  const model = v.meta?.model ?? fallbackMeta?.model;
  const strategy = v.meta?.strategy ?? fallbackMeta?.strategy;
  // selected：优先按「用户点选 id」；否则按正文与编辑器一致（兼容未设 id 的旧状态）。
  // 选中只负责预览到编辑器；真正恢复历史仍必须点击"恢复此版本"。
  const selected =
    selectedVersionId != null && selectedVersionId !== ''
      ? v.id === selectedVersionId
      : v.prompt === editorContent;
  // 整行作为点击靶子（select-version），让用户像浏览文件那样一行一行切换
  // 看不同的历史版本。行内的 copy / restore 按钮在 events.ts 里 stop
  // propagation，不会被这个父级 action 抢走。
  return `
    <li
      class="version-item${isCurrent ? ' current' : ''}${selected ? ' selected' : ''}"
      data-action="select-version"
      data-version-id="${escapeAttr(v.id)}"
      role="button"
      tabindex="0"
      title="点击切换到此版本"
    >
      <div class="version-head">
        <span class="version-ord ${ord.kind}">${escapeText(ord.label)}</span>
        <span class="version-tag ${v.source}">${tag}</span>
        ${
          strategy
            ? `<span class="version-strategy">${escapeText(STRATEGY_LABELS[strategy] ?? strategy)}</span>`
            : ''
        }
        ${
          provider && model
            ? `<span class="version-meta">${escapeText(provider)} · ${escapeText(model)}</span>`
            : ''
        }
        <span class="version-time">${escapeText(time)}</span>
      </div>
      <div class="version-preview">${escapeText(preview)}${
    v.prompt.length > 120 ? '…' : ''
  }</div>
      <div class="version-actions">
        <button class="link-btn" data-action="copy-version" data-version-id="${escapeAttr(
          v.id
        )}">${ICON_COPY}<span>复制</span></button>
        ${
          isCurrent
            ? ''
            : `<button class="link-btn primary restore-btn" data-action="restore-version" data-version-id="${escapeAttr(
                v.id
              )}">${ICON_RESTORE}<span>恢复此版本</span></button>`
        }
        ${
          total > 1
            ? `<button class="link-btn danger delete-btn" data-action="delete-version" data-version-id="${escapeAttr(
                v.id
              )}" title="${
                isCurrent ? '删除当前版本（下一条版本将顶替为当前）' : '删除此版本'
              }">${ICON_TRASH}</button>`
            : ''
        }
      </div>
    </li>
  `;
}

export function sourceLabel(s: PromptVersion['source']): string {
  // 注意：这里返回"来源"而非"版本序号"。"初始 / 当前 / 版本N"由 getVersionOrdinalLabel
  // 统一计算并以独立的 .version-ord chip 渲染，不要在这里和它打架。
  if (s === 'extracted') return '反推';
  if (s === 'edited') return '手动编辑';
  if (s === 'refined') return 'AI 调整';
  return '恢复';
}
