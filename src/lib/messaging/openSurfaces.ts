import type { RuntimeMessage } from '@/lib/types';

export type OpenInPanelResponse = { ok: boolean; error?: string; tabId?: number };

/** 与 background `OPEN_OPTIONS` 处理逻辑一致的可选参数。 */
export type OpenOptionsPayload = {
  tab?: 'settings' | 'library';
  focusId?: string;
  dock?: 'refine' | 'versions';
};

export function openOptionsMessage(
  payload?: OpenOptionsPayload
): Extract<RuntimeMessage, { type: 'OPEN_OPTIONS' }> {
  if (!payload || Object.keys(payload).length === 0) {
    return { type: 'OPEN_OPTIONS' };
  }
  return { type: 'OPEN_OPTIONS', payload };
}

export function openInPanelMessage(
  historyId: string,
  dock?: 'refine' | 'versions'
): Extract<RuntimeMessage, { type: 'OPEN_IN_PANEL' }> {
  return {
    type: 'OPEN_IN_PANEL',
    payload: dock ? { historyId, dock } : { historyId },
  };
}

/** Popup / options 等扩展页面向 background 打开选项页。 */
export function sendOpenOptions(
  payload?: OpenOptionsPayload,
  onDone?: (lastErrorMessage: string | null) => void
): void {
  const msg = openOptionsMessage(payload);
  try {
    chrome.runtime.sendMessage(msg, () => {
      onDone?.(chrome.runtime.lastError?.message ?? null);
    });
  } catch {
    onDone?.('扩展上下文无效');
  }
}

/**
 * 请求 background 在历史来源页注入并打开浮动面板。
 * `onResponse` 在收到回复或出错时调用（含 `chrome.runtime.lastError` 文本）。
 */
export function sendOpenInPanel(
  historyId: string,
  options: {
    dock?: 'refine' | 'versions';
    onResponse?: (
      resp: OpenInPanelResponse | undefined,
      lastErrorMessage: string | null
    ) => void;
  } = {}
): void {
  const { dock, onResponse } = options;
  const msg = openInPanelMessage(historyId, dock);
  try {
    chrome.runtime.sendMessage(msg, (raw) => {
      const lastErr = chrome.runtime.lastError?.message ?? null;
      onResponse?.(raw as OpenInPanelResponse | undefined, lastErr);
    });
  } catch {
    onResponse?.(undefined, '扩展上下文无效');
  }
}
