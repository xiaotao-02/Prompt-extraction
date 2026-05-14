import type { PromptVersion } from '@/lib/types';
import { getVersionOrdinalLabel } from '@/lib/versionLabel';
import type { PanelState } from './state';
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

function formatTime(t: number): string {
  const d = new Date(t);
  const now = Date.now();
  const diff = now - t;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(
    2,
    '0'
  )}`;
}

export const SUGGESTIONS = [
  '翻译成英文',
  '改得更电影感',
  '加上 8k, masterpiece, best quality',
  '删掉色调描述',
  '改成 SD tag 格式',
];

export function panelHtml(state: PanelState): string {
  const safeImg = escapeAttr(state.imageUrl);
  if (state.status === 'loading') {
    const hasPartial = !!state.partial;
    const pct = Math.round(stageProgress(state.stage, hasPartial) * 100);
    const elapsed =
      state.startedAt != null ? formatElapsed(Date.now() - state.startedAt) : '0.0s';
    const previewHtml = hasPartial
      ? `<textarea class="prompt-text streaming" readonly spellcheck="false">${escapeText(
          state.partial || ''
        )}</textarea>`
      : '';
    const stratLabel = strategyLabel(state.strategy);
    // 模型 badge：用 provider · model 拼一个短标签，比如 "openai · gpt-4o"。
    // settings 在 PENDING 之后才异步到达，所以首次渲染时 model 可能为空 ——
    // 此时给 .hidden 占位、不撑大 header；applyLoadingPatch 会在 model 拿到
    // 后把文本填上、移除 hidden。
    const modelLabel = state.model
      ? `${state.provider ? state.provider + ' · ' : ''}${state.model}`
      : '';
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
      <div class="body">
        <div class="thumb"><img src="${safeImg}" alt="" /></div>
        <div class="loader-wrap">
          <div class="bar progress">
            <span data-role="bar-fill" style="width:${pct}%"></span>
          </div>
          <div class="hint hint-row">
            <span data-role="stage-hint">${escapeText(stageHint(state.stage, hasPartial))}</span>
            <span class="elapsed" data-role="elapsed">${escapeText(elapsed)}</span>
          </div>
        </div>
        <div class="stream-preview ${hasPartial ? '' : 'hidden'}" data-role="stream-preview">
          ${previewHtml}
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
        <div class="thumb"><img src="${safeImg}" alt="" /></div>
        <div class="error-msg">${escapeText(state.error || '未知错误')}</div>
        <div class="actions">
          <button class="btn ghost" data-action="open-options">打开设置</button>
          <button class="btn primary" data-action="retry">重试</button>
        </div>
      </div>
    `;
  }

  const versions = state.versions || [];
  const versionCount = versions.length;
  const draft = state.draft ?? state.prompt ?? '';
  const dirty = draft !== (state.prompt ?? '');
  const refining = !!state.refineLoading;
  const refineInstruction = state.refineInstruction ?? '';

  // 历史版本侧栏：始终渲染在 DOM 里（只要有版本数据），用 .panel-row.versions-open
  // 这个 class 控制滑入/滑出。这样 toggle 的时候不需要 renderPanel，避免主面板尺寸
  // 还原、编辑器失焦、动画重放等问题。
  //
  // 没版本时（versionCount === 0）直接不渲染，等首次保存后 syncVersions 会触发完整
  // 重渲再把节点塞进来。
  // 列表里"哪一条被高亮"以 editor 当前内容（draft，回落到 prompt）为准，
  // 这样在 dirty 状态下高亮也是用户**正在看的那条**，而不是被保存的主版本。
  const editorContent = state.draft ?? state.prompt ?? '';
  const versionsSidebar =
    versionCount > 0
      ? `
        <aside class="versions-side" data-role="versions-side">
          <div class="versions-head">
            <span>历史版本 · ${versionCount}</span>
            <button class="icon-btn" data-action="toggle-versions" title="收起">${ICON_CLOSE}</button>
          </div>
          <ul class="versions-list">
            ${versionsListHtml(versions, editorContent, state.selectedVersionId)}
          </ul>
        </aside>
      `
      : '';

  // refine 进度块：仅在 refineLoading 时插入到 actions 上方，让用户清楚地看到
  // "现在到哪一步 / 已经用了多久"。和 extract 的 loading 视觉保持一致
  // （同一根 .bar.progress + .hint-row 结构），data-role 都换成了 refine- 前缀。
  //
  // 流式回复**不再渲染独立的副 textarea** —— 模型吐出的 partial 直接写进上方
  // 主编辑器 textarea（loading.ts:applyRefinePatch 负责）。这样用户视线不需要
  // 在"主输入框 / 副预览框"两个位置之间来回切换，体验更像 ChatGPT 那种「就地刷新」。
  const refineHasPartial = !!state.refinePartial;
  const refinePct = Math.round(
    refineStageProgress(state.refineStage, refineHasPartial) * 100
  );
  const refineElapsed =
    state.refineStartedAt != null
      ? formatElapsed(Date.now() - state.refineStartedAt)
      : '0.0s';
  const refineProgressBlock = refining
    ? `
        <div class="refine-progress" data-role="refine-progress">
          <div class="bar progress">
            <span data-role="refine-bar-fill" style="width:${refinePct}%"></span>
          </div>
          <div class="hint hint-row">
            <span data-role="refine-stage-hint">${escapeText(
              refineStageHint(state.refineStage, refineHasPartial)
            )}</span>
            <span class="elapsed" data-role="refine-elapsed">${escapeText(refineElapsed)}</span>
          </div>
        </div>
      `
    : '';

  // refine-box 始终渲染在 DOM 里（用 .refine-slot.hidden 控制显隐），
  // 这样 toggle-refine 时只需要切 class，不必整面板重渲 → 不会 reset 几何、
  // 不会让编辑器失焦、不会重放 panelIn 动画。
  //
  // 注意：refining 状态下的内部结构变化（progress block 显隐、suggest chips
  // 隐藏、按钮换 spinner 等）仍然走 renderPanel，因为那是用户主动确认操作
  // 后的"语义变化"，重渲一次是符合预期的。
  const refineSlotHidden = state.refineOpen ? '' : ' hidden';
  const refineBlock = `
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
              placeholder="例如：改得更电影感、翻译成英文、删掉色调、加上 8k 高清等参数…"
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
              ${SUGGESTIONS.map(
                (s) =>
                  `<button class="chip" data-action="refine-suggest" data-text="${escapeAttr(
                    s
                  )}">${escapeText(s)}</button>`
              ).join('')}
            </div>`
            }
            ${refineProgressBlock}
            <div class="refine-actions">
              <button class="btn ghost" data-action="toggle-refine" ${
                refining ? 'disabled' : ''
              }>取消</button>
              <button class="btn primary" data-action="run-refine" ${refining ? 'disabled' : ''}>
                ${
                  refining
                    ? `<span class="spinner"></span><span>调整中…</span>`
                    : `${ICON_SPARK}<span>让 AI 调整</span>`
                }
              </button>
            </div>
          </div>
        </div>
      `;

  // panel-row 的初始 class：版本侧栏的可见状态完全由 .versions-open 决定，
  // 当用户没版本数据可看时（versionCount===0）也不要给开关 class，
  // 避免出现"按钮看着是激活的，但 sidebar 空着滑出来"。
  const versionsOpenClass =
    state.versionsOpen && versionCount > 0 ? ' versions-open' : '';

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
        <div class="thumb"><img src="${safeImg}" alt="" /></div>
        <textarea
          class="prompt-text${refining ? ' streaming' : ''}"
          data-role="editor"
          spellcheck="false"
          placeholder="${refining ? '正在接收 AI 调整后的提示词…' : '可在此修改提示词…'}"
          ${refining ? 'readonly' : ''}
        >${escapeText(refining && refineHasPartial ? state.refinePartial || '' : draft)}</textarea>
        <div class="meta-row">
          <div class="meta-left">
            <button
              class="link-btn ${state.versionsOpen ? 'active' : ''}"
              data-action="toggle-versions"
              ${versionCount === 0 ? 'disabled' : ''}
            >${ICON_HISTORY}<span>历史版本 · ${versionCount}</span></button>
            <button
              class="link-btn ${state.refineOpen ? 'active' : ''}"
              data-action="toggle-refine"
            >${ICON_SPARK}<span>AI 调整</span></button>
            <button
              class="link-btn"
              data-action="open-in-library"
              title="跳转到提示词库，进行更完整的编辑、备注、版本管理"
            >${ICON_LIBRARY}<span>在提示词库中编辑</span></button>
          </div>
          <span class="dirty-hint ${!refining && dirty ? 'show' : ''}">已修改，未保存</span>
        </div>
        ${refineBlock}
        <div class="actions">
          <button class="btn ghost" data-action="retry">${ICON_REFRESH}<span>重新生成</span></button>
          <button class="btn ghost ${dirty ? '' : 'disabled'}" data-action="reset" ${
    dirty ? '' : 'disabled'
  }>撤销修改</button>
          <button class="btn ${dirty ? 'primary' : 'ghost disabled'}" data-action="save" ${
    dirty ? '' : 'disabled'
  }>${ICON_SAVE}<span>保存为新版本</span></button>
          <button class="btn primary" data-action="copy">${ICON_COPY}<span>复制</span></button>
        </div>
      </div>
    </div>
  `;
}

/** 渲染历史版本 `<ul>` 内全部 `<li>`，供 panelHtml / syncVersions 局部 patch 复用。 */
export function versionsListHtml(
  versions: PromptVersion[],
  editorContent: string,
  selectedVersionId?: string
): string {
  return versions
    .map((v, i) => versionItemHtml(v, i, versions.length, editorContent, selectedVersionId))
    .join('');
}

export function versionItemHtml(
  v: PromptVersion,
  index: number,
  total: number,
  editorContent: string,
  selectedVersionId?: string
): string {
  const isCurrent = index === 0;
  const time = formatTime(v.createdAt);
  const tag = sourceLabel(v.source);
  const ord = getVersionOrdinalLabel(total, index);
  const preview = v.prompt.replace(/\s+/g, ' ').slice(0, 120);
  // selected：优先按「用户点选 id」；否则按正文与编辑器一致（兼容未设 id 的旧状态）。
  // 视觉高亮 + CSS 同时隐藏行内的"恢复此版本"按钮（再恢复一次没意义）。
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
        <span class="version-time">${escapeText(time)}</span>
      </div>
      <div class="version-preview">${escapeText(preview)}${
    v.prompt.length > 120 ? '…' : ''
  }</div>
      <div class="version-actions">
        <button class="link-btn" data-action="copy-version" data-version-id="${escapeAttr(
          v.id
        )}">${ICON_COPY}<span>复制</span></button>
        <button class="link-btn primary restore-btn" data-action="restore-version" data-version-id="${escapeAttr(
          v.id
        )}">${ICON_RESTORE}<span>恢复此版本</span></button>
        ${
          isCurrent
            ? ''
            : `<button class="link-btn danger delete-btn" data-action="delete-version" data-version-id="${escapeAttr(
                v.id
              )}" title="删除此版本">${ICON_TRASH}</button>`
        }
      </div>
    </li>
  `;
}

export function sourceLabel(s: PromptVersion['source']): string {
  // 注意：这里返回"来源"而非"时间序号"。"初始 / 当前 / 版本N"由 getVersionOrdinalLabel
  // 统一计算并以独立的 .version-ord chip 渲染，不要在这里和它打架。
  if (s === 'extracted') return '反推';
  if (s === 'edited') return '手动编辑';
  if (s === 'refined') return 'AI 调整';
  return '恢复';
}
