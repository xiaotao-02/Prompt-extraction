/**
 * 内容脚本与安全 runtime 交互的共用入口。
 * （避免多处复制 isContextValid / safeSendMessage，防止未来行为分叉。）
 */
import type { HistoryItem, PromptVersion, PromptVersionSource, RuntimeMessage } from '@/lib/types';

export type HistoryMutationResponse =
  | { ok: true; item: HistoryItem | null }
  | { ok: false; error?: string };

export function isExtensionContextValid(): boolean {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

function historyItemViaBackground(message: RuntimeMessage): Promise<HistoryItem | null> {
  return new Promise((resolve) => {
    if (!isExtensionContextValid()) {
      resolve(null);
      return;
    }
    try {
      chrome.runtime.sendMessage(message, (res: HistoryMutationResponse | undefined) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        if (res && typeof res === 'object' && res.ok === true) {
          resolve(res.item ?? null);
          return;
        }
        resolve(null);
      });
    } catch {
      resolve(null);
    }
  });
}

/** 面板侧读库：页面 IndexedDB 非扩展库，必须经 background。 */
export function getHistoryItemFromExtension(id: string): Promise<HistoryItem | null> {
  return historyItemViaBackground({ type: 'GET_HISTORY_ITEM', payload: { id } });
}

export function appendPromptVersionFromExtension(
  id: string,
  prompt: string,
  source: PromptVersionSource = 'edited',
  note?: string,
  meta?: PromptVersion['meta']
): Promise<HistoryItem | null> {
  return historyItemViaBackground({
    type: 'APPEND_PROMPT_VERSION',
    payload: { id, prompt, source, note, meta },
  });
}

export function restorePromptVersionFromExtension(
  id: string,
  versionId: string
): Promise<HistoryItem | null> {
  return historyItemViaBackground({
    type: 'RESTORE_PROMPT_VERSION',
    payload: { id, versionId },
  });
}

export function removePromptVersionFromExtension(
  id: string,
  versionId: string
): Promise<HistoryItem | null> {
  return historyItemViaBackground({
    type: 'REMOVE_PROMPT_VERSION',
    payload: { id, versionId },
  });
}

/**
 * 安全发送消息。上下文失效时静默忽略，避免 Uncaught Error。
 */
export function safeSendMessage(
  message: unknown,
  callback?: (response: unknown) => void
): void {
  if (!isExtensionContextValid()) return;
  try {
    if (callback) {
      chrome.runtime.sendMessage(message, callback);
    } else {
      chrome.runtime.sendMessage(message);
    }
  } catch {
    /* context invalidated */
  }
}
