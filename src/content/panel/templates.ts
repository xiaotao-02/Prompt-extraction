import type { PromptVersion } from '@/lib/types';
import type { PanelState } from './state';
import {
  ICON_CLOSE,
  ICON_COPY,
  ICON_REFRESH,
  ICON_SAVE,
  ICON_HISTORY,
  ICON_RESTORE,
  ICON_EDIT,
  ICON_SPARK,
} from './icons';
import {
  stageLabel,
  stageHint,
  stageProgress,
  formatElapsed,
  strategyLabel,
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
    return `
      <div class="header">
        <div class="title">
          <span class="dot loading"></span>
          <span data-role="stage-label">${escapeText(stageLabel(state.stage))}</span>
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

  const versionsBlock =
    state.versionsOpen && versionCount > 0
      ? `
        <div class="versions">
          <div class="versions-head">
            <span>历史版本（共 ${versionCount} 条）</span>
          </div>
          <ul class="versions-list">
            ${versions
              .map((v, i) => versionItemHtml(v, i === 0, state.prompt || ''))
              .join('')}
          </ul>
        </div>
      `
      : '';

  const refineBlock = state.refineOpen
    ? `
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
          <div class="refine-suggest">
            ${SUGGESTIONS.map(
              (s) =>
                `<button class="chip" data-action="refine-suggest" data-text="${escapeAttr(
                  s
                )}" ${refining ? 'disabled' : ''}>${escapeText(s)}</button>`
            ).join('')}
          </div>
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
      `
    : '';

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
    <div class="body">
      <div class="thumb"><img src="${safeImg}" alt="" /></div>
      <textarea class="prompt-text" data-role="editor" spellcheck="false" placeholder="可在此修改提示词…">${escapeText(
        draft
      )}</textarea>
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
        </div>
        <span class="dirty-hint ${dirty ? 'show' : ''}">已修改，未保存</span>
      </div>
      ${refineBlock}
      ${versionsBlock}
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
  `;
}

export function versionItemHtml(v: PromptVersion, isCurrent: boolean, currentPrompt: string): string {
  const time = formatTime(v.createdAt);
  const tag = sourceLabel(v.source);
  const preview = v.prompt.replace(/\s+/g, ' ').slice(0, 120);
  const isSameAsCurrent = v.prompt === currentPrompt;
  return `
    <li class="version-item ${isCurrent ? 'current' : ''}">
      <div class="version-head">
        <span class="version-tag ${v.source}">${tag}</span>
        <span class="version-time">${escapeText(time)}</span>
        ${isCurrent ? '<span class="version-badge">当前</span>' : ''}
      </div>
      <div class="version-preview">${escapeText(preview)}${
    v.prompt.length > 120 ? '…' : ''
  }</div>
      <div class="version-actions">
        <button class="link-btn" data-action="copy-version" data-version-id="${escapeAttr(
          v.id
        )}">${ICON_COPY}<span>复制</span></button>
        <button class="link-btn" data-action="load-version" data-version-id="${escapeAttr(
          v.id
        )}">${ICON_EDIT}<span>载入到编辑器</span></button>
        ${
          isSameAsCurrent
            ? ''
            : `<button class="link-btn primary" data-action="restore-version" data-version-id="${escapeAttr(
                v.id
              )}">${ICON_RESTORE}<span>恢复此版本</span></button>`
        }
      </div>
    </li>
  `;
}

export function sourceLabel(s: PromptVersion['source']): string {
  if (s === 'extracted') return '初始';
  if (s === 'edited') return '手动编辑';
  if (s === 'refined') return 'AI 调整';
  return '恢复';
}
