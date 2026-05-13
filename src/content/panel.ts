/**
 * 在页面右下角注入一个 Shadow DOM 浮动面板，显示提示词结果。
 * 用 Shadow DOM 隔离样式，避免被宿主页面 CSS 污染。
 */

import {
  appendPromptVersion,
  getHistoryItem,
  restorePromptVersion,
} from '@/lib/storage';
import type { PromptVersion, RefineResponse } from '@/lib/types';

interface PanelState {
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
}

const HOST_ID = '__image_prompt_extractor_host__';

let host: HTMLDivElement | null = null;
let shadow: ShadowRoot | null = null;
let panel: HTMLDivElement | null = null;
let currentState: PanelState | null = null;

function ensureHost(): { host: HTMLDivElement; shadow: ShadowRoot } {
  if (host && shadow) return { host, shadow };
  host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = `
    position: fixed; inset: 0;
    z-index: 2147483647; width: 0; height: 0;
    color-scheme: light dark;
  `;
  shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = STYLE;
  shadow.appendChild(style);
  document.documentElement.appendChild(host);
  return { host, shadow };
}

export function renderPanel(state: PanelState): void {
  const { shadow } = ensureHost();
  currentState = state;
  if (panel) panel.remove();
  panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML = panelHtml(state);
  shadow.appendChild(panel);
  bindEvents(panel);
}

export function updatePanel(requestId: string, patch: Partial<PanelState>): void {
  if (!currentState || currentState.requestId !== requestId) return;
  currentState = { ...currentState, ...patch } as PanelState;
  // 当我们把 status 切到 success 时，触发一次版本同步
  if (patch.status === 'success') {
    void syncVersions(requestId);
  }
  renderPanel(currentState);
}

export function closePanel(): void {
  if (panel) {
    panel.remove();
    panel = null;
  }
  currentState = null;
}

async function syncVersions(requestId: string): Promise<void> {
  try {
    const item = await getHistoryItem(requestId);
    if (!item) return;
    if (!currentState || currentState.requestId !== requestId) return;
    currentState = {
      ...currentState,
      versions: item.versions,
      // 如果用户没在编辑，draft 跟着 prompt 走
      draft: currentState.draft ?? item.prompt,
      prompt: item.prompt,
    };
    renderPanel(currentState);
  } catch (err) {
    console.warn('[PromptExtracto] syncVersions failed', err);
  }
}

function panelHtml(state: PanelState): string {
  const safeImg = escapeAttr(state.imageUrl);
  if (state.status === 'loading') {
    return `
      <div class="header">
        <div class="title">
          <span class="dot loading"></span>
          <span>正在反推图片提示词…</span>
        </div>
        <button class="icon-btn" data-action="close" title="关闭">${ICON_CLOSE}</button>
      </div>
      <div class="body">
        <div class="thumb"><img src="${safeImg}" alt="" /></div>
        <div class="loader-wrap">
          <div class="bar"><span></span></div>
          <div class="hint">调用大模型中，第一次可能略慢…</div>
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

const SUGGESTIONS = [
  '翻译成英文',
  '改得更电影感',
  '加上 8k, masterpiece, best quality',
  '删掉色调描述',
  '改成 SD tag 格式',
];

function versionItemHtml(v: PromptVersion, isCurrent: boolean, currentPrompt: string): string {
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

function sourceLabel(s: PromptVersion['source']): string {
  if (s === 'extracted') return '初始';
  if (s === 'edited') return '手动编辑';
  if (s === 'refined') return 'AI 调整';
  return '恢复';
}

function bindEvents(root: HTMLElement): void {
  const editor = root.querySelector<HTMLTextAreaElement>('[data-role="editor"]');
  if (editor) {
    editor.addEventListener('input', () => {
      if (!currentState) return;
      currentState = { ...currentState, draft: editor.value };
      // 仅刷新关键控件（避免每次按键都重渲染整片，从而丢失光标）
      updateDirtyChrome();
    });
  }

  const refineInput = root.querySelector<HTMLTextAreaElement>('[data-role="refine-input"]');
  if (refineInput) {
    // 不每次按键 re-render，只是同步到状态以便重渲染时回填
    refineInput.addEventListener('input', () => {
      if (!currentState) return;
      currentState = { ...currentState, refineInstruction: refineInput.value };
    });
    // 自动聚焦
    setTimeout(() => refineInput.focus(), 0);
    // Ctrl/Cmd + Enter 触发
    refineInput.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        const btn = root.querySelector<HTMLButtonElement>('[data-action="run-refine"]');
        btn?.click();
      }
    });
  }

  root.querySelectorAll<HTMLElement>('[data-action]').forEach((el) => {
    el.addEventListener('click', () => {
      const action = el.dataset.action;
      const state = currentState;
      if (!state) return;
      if (action === 'close') return closePanel();
      if (action === 'copy') {
        const text = state.draft ?? state.prompt ?? '';
        navigator.clipboard
          .writeText(text)
          .then(() => flashCopied(el))
          .catch(() => fallbackCopy(text, el));
        return;
      }
      if (action === 'retry') {
        chrome.runtime.sendMessage({ type: 'PING' });
        renderPanel({
          ...state,
          status: 'loading',
          prompt: undefined,
          error: undefined,
          draft: undefined,
          versions: undefined,
          versionsOpen: false,
        });
        chrome.runtime.sendMessage({
          type: 'EXTRACT_PROMPT',
          payload: {
            imageUrl: state.imageUrl,
            pageUrl: location.href,
            pageTitle: document.title,
            requestId: state.requestId,
          },
        });
        return;
      }
      if (action === 'open-options') {
        chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
        return;
      }
      if (action === 'toggle-versions') {
        currentState = { ...state, versionsOpen: !state.versionsOpen };
        renderPanel(currentState);
        return;
      }
      if (action === 'reset') {
        currentState = { ...state, draft: state.prompt };
        renderPanel(currentState);
        return;
      }
      if (action === 'save') {
        const draft = state.draft ?? state.prompt ?? '';
        if (draft === state.prompt) return;
        void appendPromptVersion(state.requestId, draft, 'edited').then((updated) => {
          if (!updated || !currentState || currentState.requestId !== state.requestId) return;
          currentState = {
            ...currentState,
            prompt: updated.prompt,
            draft: updated.prompt,
            versions: updated.versions,
            versionsOpen: true,
          };
          renderPanel(currentState);
          flashCopied(el, '已保存 ✔');
        });
        return;
      }
      if (action === 'copy-version') {
        const vid = el.dataset.versionId;
        const v = state.versions?.find((x) => x.id === vid);
        if (!v) return;
        navigator.clipboard
          .writeText(v.prompt)
          .then(() => flashCopied(el, '已复制 ✔'))
          .catch(() => fallbackCopy(v.prompt, el));
        return;
      }
      if (action === 'load-version') {
        const vid = el.dataset.versionId;
        const v = state.versions?.find((x) => x.id === vid);
        if (!v || !currentState) return;
        currentState = { ...currentState, draft: v.prompt };
        renderPanel(currentState);
        return;
      }
      if (action === 'restore-version') {
        const vid = el.dataset.versionId;
        if (!vid) return;
        void restorePromptVersion(state.requestId, vid).then((updated) => {
          if (!updated || !currentState || currentState.requestId !== state.requestId) return;
          currentState = {
            ...currentState,
            prompt: updated.prompt,
            draft: updated.prompt,
            versions: updated.versions,
            versionsOpen: true,
          };
          renderPanel(currentState);
          flashCopied(el, '已恢复 ✔');
        });
        return;
      }
      if (action === 'toggle-refine') {
        currentState = {
          ...state,
          refineOpen: !state.refineOpen,
          refineError: undefined,
          // 关闭时清空输入；打开时保留之前的
          refineInstruction: state.refineOpen ? '' : state.refineInstruction || '',
        };
        renderPanel(currentState);
        return;
      }
      if (action === 'refine-suggest') {
        const text = el.dataset.text || '';
        if (!currentState) return;
        // 把建议追加到输入框（如果已有内容则用顿号连接）
        const prev = (currentState.refineInstruction || '').trim();
        const next = prev ? `${prev}；${text}` : text;
        currentState = { ...currentState, refineInstruction: next };
        renderPanel(currentState);
        return;
      }
      if (action === 'run-refine') {
        const instruction = (currentState?.refineInstruction || '').trim();
        if (!instruction) {
          currentState = { ...state, refineError: '请先输入修改要求' };
          renderPanel(currentState);
          return;
        }
        currentState = {
          ...state,
          refineLoading: true,
          refineError: undefined,
          refineInstruction: instruction,
        };
        renderPanel(currentState);
        const baseline = state.draft ?? state.prompt ?? '';
        chrome.runtime.sendMessage(
          {
            type: 'REFINE_PROMPT',
            payload: {
              historyId: state.requestId,
              instruction,
              current: baseline,
            },
          },
          (resp: RefineResponse | undefined) => {
            if (!currentState || currentState.requestId !== state.requestId) return;
            if (chrome.runtime.lastError || !resp) {
              currentState = {
                ...currentState,
                refineLoading: false,
                refineError:
                  chrome.runtime.lastError?.message || '后台未响应，请稍后再试',
              };
              renderPanel(currentState);
              return;
            }
            if (!resp.ok) {
              currentState = {
                ...currentState,
                refineLoading: false,
                refineError: resp.error,
              };
              renderPanel(currentState);
              return;
            }
            currentState = {
              ...currentState,
              refineLoading: false,
              refineError: undefined,
              refineInstruction: '',
              refineOpen: false,
              prompt: resp.prompt,
              draft: resp.prompt,
              versionsOpen: true,
            };
            // 拉一次最新版本列表
            void syncVersions(state.requestId);
            renderPanel(currentState);
          }
        );
        return;
      }
    });
  });
}

/**
 * 仅刷新和"是否脏"相关的 UI 部分，避免在每次按键时整片重渲染导致 textarea 失焦。
 */
function updateDirtyChrome(): void {
  if (!panel || !currentState) return;
  const dirty = (currentState.draft ?? '') !== (currentState.prompt ?? '');
  const hint = panel.querySelector<HTMLElement>('.dirty-hint');
  if (hint) hint.classList.toggle('show', dirty);
  const setDisabled = (sel: string, disabled: boolean) => {
    const btn = panel!.querySelector<HTMLButtonElement>(sel);
    if (!btn) return;
    btn.disabled = disabled;
    btn.classList.toggle('disabled', disabled);
    if (sel.includes('save')) {
      btn.classList.toggle('primary', !disabled);
      btn.classList.toggle('ghost', disabled);
    }
  };
  setDisabled('[data-action="reset"]', !dirty);
  setDisabled('[data-action="save"]', !dirty);
}

function flashCopied(btn: HTMLElement, text = '已复制 ✔'): void {
  const span = btn.querySelector('span');
  const original = span?.textContent || '';
  if (span) span.textContent = text;
  btn.classList.add('copied');
  setTimeout(() => {
    if (span) span.textContent = original;
    btn.classList.remove('copied');
  }, 1500);
}

function fallbackCopy(text: string, btn: HTMLElement): void {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    flashCopied(btn);
  } finally {
    ta.remove();
  }
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

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
}

const ICON_CLOSE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const ICON_COPY = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const ICON_REFRESH = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`;
const ICON_SAVE = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`;
const ICON_HISTORY = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 4 3 10 9 10"/><polyline points="12 7 12 12 15 14"/></svg>`;
const ICON_RESTORE = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>`;
const ICON_EDIT = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>`;
const ICON_SPARK = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>`;

const STYLE = `
:host, * { box-sizing: border-box; }
.panel {
  position: fixed; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: min(720px, calc(100vw - 48px));
  max-height: calc(100vh - 48px);
  display: flex; flex-direction: column;
  background: rgba(255,255,255,0.96);
  backdrop-filter: blur(20px) saturate(140%);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
  color: #111;
  border: 1px solid rgba(0,0,0,0.08);
  border-radius: 16px;
  box-shadow: 0 32px 80px -16px rgba(0,0,0,0.35), 0 8px 24px rgba(0,0,0,0.12);
  font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  overflow: hidden;
  animation: panelIn .25s cubic-bezier(.2,.9,.3,1.2);
}
@media (prefers-color-scheme: dark) {
  .panel {
    background: rgba(24,24,27,0.94);
    color: #f4f4f5;
    border-color: rgba(255,255,255,0.08);
  }
}
@keyframes panelIn {
  from { transform: translate(-50%, calc(-50% + 12px)); opacity: 0; }
  to { transform: translate(-50%, -50%); opacity: 1; }
}
.header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(0,0,0,0.06);
  flex: none;
}
@media (prefers-color-scheme: dark) {
  .header { border-bottom-color: rgba(255,255,255,0.06); }
}
.title { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; }
.badge {
  font-weight: 400; font-size: 11px; padding: 2px 6px;
  border-radius: 6px;
  background: rgba(0,0,0,0.05);
  color: rgba(0,0,0,0.6);
}
@media (prefers-color-scheme: dark) {
  .badge { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.7); }
}
.dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.dot.loading { background: #f59e0b; animation: pulse 1.2s infinite; }
.dot.success { background: #10b981; }
.dot.error { background: #ef4444; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }

.icon-btn {
  background: transparent; border: none; cursor: pointer; padding: 4px;
  border-radius: 6px; color: inherit; opacity: 0.6;
  display: inline-flex; align-items: center; justify-content: center;
}
.icon-btn:hover { opacity: 1; background: rgba(0,0,0,0.05); }
@media (prefers-color-scheme: dark) {
  .icon-btn:hover { background: rgba(255,255,255,0.08); }
}

.body {
  padding: 16px; display: flex; flex-direction: column; gap: 12px;
  overflow-y: auto;
}
.thumb {
  width: 100%; height: 220px; border-radius: 12px; overflow: hidden;
  background: rgba(0,0,0,0.04); display: flex; align-items: center; justify-content: center;
  flex: none;
}
.thumb img { width: 100%; height: 100%; object-fit: contain; }

.prompt-text {
  width: 100%; min-height: 180px; max-height: 360px; resize: vertical;
  padding: 12px 14px; border-radius: 10px;
  border: 1px solid rgba(0,0,0,0.1);
  background: rgba(0,0,0,0.02);
  color: inherit; font-size: 13px; line-height: 1.6;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
  outline: none;
  transition: border-color .15s, box-shadow .15s;
}
.prompt-text:focus {
  border-color: rgba(99,102,241,0.55);
  box-shadow: 0 0 0 3px rgba(99,102,241,0.18);
}
@media (prefers-color-scheme: dark) {
  .prompt-text { background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.1); }
}

.error-msg {
  padding: 10px 12px; border-radius: 10px;
  background: rgba(239,68,68,0.08); color: #b91c1c;
  font-size: 12px; line-height: 1.5; word-break: break-word;
}
@media (prefers-color-scheme: dark) { .error-msg { color: #fca5a5; } }

.meta-row {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 11px;
  gap: 6px;
}
.meta-left { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.dirty-hint {
  opacity: 0; transition: opacity .15s;
  color: #b45309; font-weight: 500;
}
.dirty-hint.show { opacity: 1; }
@media (prefers-color-scheme: dark) {
  .dirty-hint { color: #fbbf24; }
}

.refine-box {
  border: 1px solid rgba(99,102,241,0.25);
  background: linear-gradient(180deg, rgba(99,102,241,0.06), rgba(139,92,246,0.04));
  border-radius: 12px;
  padding: 10px;
  display: flex; flex-direction: column; gap: 8px;
  position: relative;
  transition: opacity .15s;
}
.refine-box.loading { opacity: 0.85; }
@media (prefers-color-scheme: dark) {
  .refine-box {
    border-color: rgba(139,92,246,0.35);
    background: linear-gradient(180deg, rgba(139,92,246,0.10), rgba(99,102,241,0.06));
  }
}
.refine-head {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 12px; font-weight: 600;
  color: #4f46e5;
}
.refine-head > span:first-child {
  display: inline-flex; align-items: center; gap: 6px;
}
@media (prefers-color-scheme: dark) {
  .refine-head { color: #c4b5fd; }
}
.refine-input {
  width: 100%; min-height: 80px; max-height: 220px; resize: vertical;
  padding: 8px 10px; border-radius: 8px;
  border: 1px solid rgba(99,102,241,0.25);
  background: rgba(255,255,255,0.7);
  color: inherit; font-size: 12px; line-height: 1.5;
  font-family: inherit;
  outline: none;
  transition: border-color .15s, box-shadow .15s;
}
.refine-input:focus {
  border-color: rgba(99,102,241,0.7);
  box-shadow: 0 0 0 3px rgba(99,102,241,0.18);
}
.refine-input:disabled {
  opacity: 0.6; cursor: not-allowed;
}
@media (prefers-color-scheme: dark) {
  .refine-input {
    background: rgba(0,0,0,0.25);
    border-color: rgba(139,92,246,0.35);
  }
}
.refine-error {
  padding: 6px 10px; border-radius: 6px;
  background: rgba(239,68,68,0.12); color: #b91c1c;
  font-size: 11px; line-height: 1.45;
}
@media (prefers-color-scheme: dark) {
  .refine-error { color: #fca5a5; background: rgba(239,68,68,0.18); }
}
.refine-suggest {
  display: flex; flex-wrap: wrap; gap: 4px;
}
.chip {
  border: 1px solid rgba(99,102,241,0.25);
  background: rgba(255,255,255,0.65);
  color: #4f46e5;
  font-size: 11px; padding: 2px 8px; border-radius: 999px;
  cursor: pointer; font-family: inherit;
  transition: background .12s, opacity .12s;
}
.chip:hover { background: rgba(99,102,241,0.10); }
.chip:disabled { opacity: 0.5; cursor: not-allowed; }
@media (prefers-color-scheme: dark) {
  .chip {
    background: rgba(139,92,246,0.10);
    border-color: rgba(139,92,246,0.35);
    color: #c4b5fd;
  }
  .chip:hover { background: rgba(139,92,246,0.20); }
}
.refine-actions {
  display: flex; justify-content: flex-end; gap: 6px;
}
.spinner {
  display: inline-block; width: 12px; height: 12px;
  border: 2px solid rgba(255,255,255,0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin .9s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.link-btn {
  background: transparent; border: none; cursor: pointer;
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 8px; border-radius: 6px;
  color: inherit; opacity: 0.7;
  font-size: 11px;
  font-family: inherit;
}
.link-btn:hover { opacity: 1; background: rgba(0,0,0,0.05); }
.link-btn.active { opacity: 1; background: rgba(99,102,241,0.12); color: #4f46e5; }
.link-btn.primary { color: #4f46e5; opacity: 0.9; }
.link-btn.primary:hover { background: rgba(99,102,241,0.12); opacity: 1; }
.link-btn[disabled] { cursor: not-allowed; opacity: 0.35; }
.link-btn[disabled]:hover { background: transparent; }
@media (prefers-color-scheme: dark) {
  .link-btn:hover { background: rgba(255,255,255,0.06); }
  .link-btn.active { background: rgba(139,92,246,0.18); color: #c4b5fd; }
  .link-btn.primary { color: #a5b4fc; }
  .link-btn.primary:hover { background: rgba(139,92,246,0.18); }
}

.versions {
  border: 1px solid rgba(0,0,0,0.08);
  border-radius: 10px;
  background: rgba(0,0,0,0.02);
  max-height: 320px;
  overflow-y: auto;
}
@media (prefers-color-scheme: dark) {
  .versions { border-color: rgba(255,255,255,0.08); background: rgba(255,255,255,0.03); }
}
.versions-head {
  padding: 8px 10px; font-size: 11px; font-weight: 600; opacity: 0.65;
  border-bottom: 1px solid rgba(0,0,0,0.05);
}
@media (prefers-color-scheme: dark) {
  .versions-head { border-bottom-color: rgba(255,255,255,0.06); }
}
.versions-list {
  list-style: none; margin: 0; padding: 0;
}
.version-item {
  padding: 8px 10px;
  border-bottom: 1px solid rgba(0,0,0,0.04);
}
.version-item:last-child { border-bottom: none; }
.version-item.current { background: rgba(16,185,129,0.06); }
@media (prefers-color-scheme: dark) {
  .version-item { border-bottom-color: rgba(255,255,255,0.04); }
  .version-item.current { background: rgba(16,185,129,0.10); }
}
.version-head {
  display: flex; align-items: center; gap: 6px; font-size: 11px; margin-bottom: 4px;
}
.version-tag {
  padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 500;
  background: rgba(99,102,241,0.12); color: #4f46e5;
}
.version-tag.extracted { background: rgba(16,185,129,0.12); color: #047857; }
.version-tag.edited { background: rgba(245,158,11,0.14); color: #b45309; }
.version-tag.restored { background: rgba(99,102,241,0.12); color: #4f46e5; }
.version-tag.refined { background: rgba(168,85,247,0.14); color: #7e22ce; }
@media (prefers-color-scheme: dark) {
  .version-tag.extracted { background: rgba(16,185,129,0.18); color: #6ee7b7; }
  .version-tag.edited { background: rgba(245,158,11,0.20); color: #fbbf24; }
  .version-tag.restored { background: rgba(139,92,246,0.20); color: #c4b5fd; }
  .version-tag.refined { background: rgba(168,85,247,0.25); color: #d8b4fe; }
}
.version-time { opacity: 0.65; }
.version-badge {
  margin-left: auto; padding: 1px 6px; border-radius: 4px;
  font-size: 10px; background: rgba(16,185,129,0.18); color: #047857;
}
@media (prefers-color-scheme: dark) {
  .version-badge { background: rgba(16,185,129,0.25); color: #6ee7b7; }
}
.version-preview {
  font-size: 12px; line-height: 1.5; opacity: 0.85;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden; word-break: break-word;
}
.version-actions {
  display: flex; gap: 4px; margin-top: 4px;
  flex-wrap: wrap;
}

.actions { display: flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap; }
.btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 12px; border-radius: 8px;
  font-size: 12px; font-weight: 500;
  cursor: pointer; border: 1px solid transparent;
  transition: transform .08s, background .12s, opacity .12s;
  font-family: inherit;
  color: inherit;
}
.btn:active { transform: scale(0.97); }
.btn.primary {
  background: linear-gradient(135deg,#6366f1,#8b5cf6);
  color: #fff;
}
.btn.primary:hover { filter: brightness(1.05); }
.btn.ghost {
  background: transparent;
  color: inherit;
  border-color: rgba(0,0,0,0.1);
}
.btn.ghost:hover { background: rgba(0,0,0,0.05); }
.btn.disabled, .btn[disabled] {
  opacity: 0.45; cursor: not-allowed;
}
.btn.disabled:hover, .btn[disabled]:hover { filter: none; background: transparent; }
@media (prefers-color-scheme: dark) {
  .btn.ghost { border-color: rgba(255,255,255,0.12); }
  .btn.ghost:hover { background: rgba(255,255,255,0.06); }
}
.btn.copied { background: #10b981 !important; color:#fff !important; border-color: transparent !important; }

.loader-wrap { padding: 8px 0; }
.bar {
  position: relative; width: 100%; height: 4px; border-radius: 4px;
  overflow: hidden; background: rgba(0,0,0,0.06);
}
.bar span {
  position: absolute; left: -40%; top: 0; width: 40%; height: 100%;
  background: linear-gradient(90deg,#6366f1,#8b5cf6);
  animation: slide 1.4s infinite;
}
@keyframes slide {
  0% { left: -40%; }
  100% { left: 100%; }
}
.hint { margin-top: 8px; font-size: 11px; opacity: 0.6; }
`;
