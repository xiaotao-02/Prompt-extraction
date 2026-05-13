import { appendPromptVersion, getHistoryItem, restorePromptVersion } from '@/lib/storage';
import type { RefineResponse } from '@/lib/types';
import { currentState, setCurrentState, panel, panelActions } from './state';

function renderPanel(...args: Parameters<typeof panelActions.renderPanel>) {
  return panelActions.renderPanel(...args);
}
function closePanel() {
  return panelActions.closePanel();
}

function isContextValid(): boolean {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

function safeSendMessage(message: unknown, callback?: (response: any) => void): void {
  if (!isContextValid()) return;
  try {
    if (callback) {
      chrome.runtime.sendMessage(message, callback);
    } else {
      chrome.runtime.sendMessage(message);
    }
  } catch { /* context invalidated */ }
}

/**
 * 仅刷新和"是否脏"相关的 UI 部分，避免在每次按键时整片重渲染导致 textarea 失焦。
 */
export function updateDirtyChrome(): void {
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

export async function syncVersions(requestId: string): Promise<void> {
  try {
    const item = await getHistoryItem(requestId);
    if (!item) return;
    if (!currentState || currentState.requestId !== requestId) return;
    setCurrentState({
      ...currentState,
      versions: item.versions,
      // 如果用户没在编辑，draft 跟着 prompt 走
      draft: currentState.draft ?? item.prompt,
      prompt: item.prompt,
    });
    renderPanel(currentState);
  } catch (err) {
    console.warn('[PromptExtracto] syncVersions failed', err);
  }
}

export function bindEvents(root: HTMLElement): void {
  const editor = root.querySelector<HTMLTextAreaElement>('[data-role="editor"]');
  if (editor) {
    editor.addEventListener('input', () => {
      if (!currentState) return;
      setCurrentState({ ...currentState, draft: editor.value });
      // 仅刷新关键控件（避免每次按键都重渲染整片，从而丢失光标）
      updateDirtyChrome();
    });
  }

  const refineInput = root.querySelector<HTMLTextAreaElement>('[data-role="refine-input"]');
  if (refineInput) {
    // 不每次按键 re-render，只是同步到状态以便重渲染时回填
    refineInput.addEventListener('input', () => {
      if (!currentState) return;
      setCurrentState({ ...currentState, refineInstruction: refineInput.value });
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
        if (!isContextValid()) return;
        safeSendMessage({ type: 'PING' });
        renderPanel({
          ...state,
          status: 'loading',
          prompt: undefined,
          error: undefined,
          draft: undefined,
          versions: undefined,
          versionsOpen: false,
          stage: 'calling',
          partial: undefined,
          startedAt: Date.now(),
        });
        safeSendMessage({
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
        if (!isContextValid()) return;
        safeSendMessage({ type: 'OPEN_OPTIONS' });
        return;
      }
      if (action === 'toggle-versions') {
        setCurrentState({ ...state, versionsOpen: !state.versionsOpen });
        renderPanel(currentState!);
        return;
      }
      if (action === 'reset') {
        setCurrentState({ ...state, draft: state.prompt });
        renderPanel(currentState!);
        return;
      }
      if (action === 'save') {
        const draft = state.draft ?? state.prompt ?? '';
        if (draft === state.prompt) return;
        void appendPromptVersion(state.requestId, draft, 'edited').then((updated) => {
          if (!updated || !currentState || currentState.requestId !== state.requestId) return;
          setCurrentState({
            ...currentState,
            prompt: updated.prompt,
            draft: updated.prompt,
            versions: updated.versions,
            versionsOpen: true,
          });
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
        setCurrentState({ ...currentState, draft: v.prompt });
        renderPanel(currentState);
        return;
      }
      if (action === 'restore-version') {
        const vid = el.dataset.versionId;
        if (!vid) return;
        void restorePromptVersion(state.requestId, vid).then((updated) => {
          if (!updated || !currentState || currentState.requestId !== state.requestId) return;
          setCurrentState({
            ...currentState,
            prompt: updated.prompt,
            draft: updated.prompt,
            versions: updated.versions,
            versionsOpen: true,
          });
          renderPanel(currentState);
          flashCopied(el, '已恢复 ✔');
        });
        return;
      }
      if (action === 'toggle-refine') {
        setCurrentState({
          ...state,
          refineOpen: !state.refineOpen,
          refineError: undefined,
          // 关闭时清空输入；打开时保留之前的
          refineInstruction: state.refineOpen ? '' : state.refineInstruction || '',
        });
        renderPanel(currentState!);
        return;
      }
      if (action === 'refine-suggest') {
        const text = el.dataset.text || '';
        if (!currentState) return;
        // 把建议追加到输入框（如果已有内容则用顿号连接）
        const prev = (currentState.refineInstruction || '').trim();
        const next = prev ? `${prev}；${text}` : text;
        setCurrentState({ ...currentState, refineInstruction: next });
        renderPanel(currentState);
        return;
      }
      if (action === 'run-refine') {
        const instruction = (currentState?.refineInstruction || '').trim();
        if (!instruction) {
          setCurrentState({ ...state, refineError: '请先输入修改要求' });
          renderPanel(currentState!);
          return;
        }
        setCurrentState({
          ...state,
          refineLoading: true,
          refineError: undefined,
          refineInstruction: instruction,
        });
        renderPanel(currentState!);
        if (!isContextValid()) {
          setCurrentState({ ...currentState!, refineLoading: false, refineError: '扩展已更新，请刷新页面' });
          renderPanel(currentState!);
          return;
        }
        const baseline = state.draft ?? state.prompt ?? '';
        try {
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
                setCurrentState({
                  ...currentState,
                  refineLoading: false,
                  refineError:
                    chrome.runtime.lastError?.message || '后台未响应，请稍后再试',
                });
                renderPanel(currentState);
                return;
              }
              if (!resp.ok) {
                setCurrentState({
                  ...currentState,
                  refineLoading: false,
                  refineError: resp.error,
                });
                renderPanel(currentState);
                return;
              }
              setCurrentState({
                ...currentState,
                refineLoading: false,
                refineError: undefined,
                refineInstruction: '',
                refineOpen: false,
                prompt: resp.prompt,
                draft: resp.prompt,
                versionsOpen: true,
              });
              void syncVersions(state.requestId);
              renderPanel(currentState);
            }
          );
        } catch {
          setCurrentState({ ...currentState!, refineLoading: false, refineError: '扩展已更新，请刷新页面' });
          renderPanel(currentState!);
        }
        return;
      }
    });
  });
}

export function flashCopied(btn: HTMLElement, text = '已复制 ✔'): void {
  const span = btn.querySelector('span');
  const original = span?.textContent || '';
  if (span) span.textContent = text;
  btn.classList.add('copied');
  setTimeout(() => {
    if (span) span.textContent = original;
    btn.classList.remove('copied');
  }, 1500);
}

export function fallbackCopy(text: string, btn: HTMLElement): void {
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
