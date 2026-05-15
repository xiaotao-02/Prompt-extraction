/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- 开发预览用最小编译 stub，不靠类型精确映射 Chrome API */

import { SETTINGS_KEY } from '@/lib/storage/keys';
import { getCurrentVersion } from '@/lib/updater';

/** 与 `gallery.html` 中 message 监听保持一致，修改时需同步。 */
export const DEV_PREVIEW_NAV = 'DEV_PREVIEW_NAV' as const;

export type DevPreviewNavPayload =
  | { view: 'popup' }
  | { view: 'options'; optionsHash?: string }
  | { view: 'panel' };

/**
 * 嵌入聚合预览（gallery）时通知父页切换 Tab；独立打开单页预览时不做任何事。
 */
export function postDevPreviewNav(payload: DevPreviewNavPayload): void {
  if (globalThis.window === undefined) return;
  try {
    if (window.parent === window) return;
    if (window.parent.origin !== window.origin) return;
    window.parent.postMessage({ type: DEV_PREVIEW_NAV, ...payload }, window.location.origin);
  } catch {
    /* cross-origin */
  }
}

type StorageListener = (
  changes: { [key: string]: chrome.storage.StorageChange },
  area: chrome.storage.AreaName
) => void;

/**
 * localhost Tab 预览用：补齐最小 chrome.storage / chrome.runtime，
 * Popup / Options 可挂载；与真实 MV3 extension 上下文行为仍有差别。
 */
export function installChromePreviewShim(): void {
  const w = globalThis as unknown as Window & { chrome?: typeof chrome };
  if (typeof location?.protocol === 'string' && location.protocol === 'chrome-extension:') {
    return;
  }
  if (typeof w.chrome?.runtime?.id === 'string' && w.chrome.runtime.id === 'prompt-extracto-dev-preview') {
    return;
  }

  const storageListeners = new Set<StorageListener>();

  const notifyChange = (
    backing: Record<string, unknown>,
    keys: string[],
    oldSnap: Record<string, unknown>,
    area: chrome.storage.AreaName
  ) => {
    if (keys.length === 0) return;
    const changes: { [key: string]: chrome.storage.StorageChange } = {};
    for (const k of keys) {
      const oldValue = Object.prototype.hasOwnProperty.call(oldSnap, k) ? oldSnap[k] : undefined;
      const newValue = Object.prototype.hasOwnProperty.call(backing, k) ? backing[k] : undefined;
      changes[k] = { oldValue, newValue } as chrome.storage.StorageChange;
    }
    for (const fn of storageListeners) {
      fn(changes, area);
    }
  };

  const makeArea = (areaName: chrome.storage.AreaName) => {
    const backing: Record<string, unknown> = {};

    async function snapshotKeys(
      keys: string | string[] | Record<string, unknown> | null | undefined
    ): Promise<Record<string, unknown>> {
      if (keys == null) {
        return { ...backing };
      }
      const outOne: Record<string, unknown> = {};
      const keyList =
        typeof keys === 'string'
          ? [keys]
          : Array.isArray(keys)
            ? keys
            : Object.keys(keys as Record<string, unknown>);
      for (const k of keyList) {
        if (Object.prototype.hasOwnProperty.call(backing, k)) outOne[k] = backing[k];
      }
      return outOne;
    }

    const area = {
      get(
        keys: string | string[] | Record<string, unknown> | null | undefined,
        callback?: (items: Record<string, unknown>) => void
      ) {
        void snapshotKeys(keys).then((snap) => {
          callback?.(snap);
          return snap;
        });
        return snapshotKeys(keys);
      },
      set(items: Record<string, unknown>, callback?: () => void) {
        const oldSnap = { ...backing };
        const ks = Object.keys(items);
        for (const [k, v] of Object.entries(items)) {
          backing[k] = v;
        }
        notifyChange(backing, ks, oldSnap, areaName);
        callback?.();
        return Promise.resolve();
      },
      remove(keysInput: string | string[], callback?: () => void) {
        const list = typeof keysInput === 'string' ? [keysInput] : [...keysInput];
        const oldSnap = { ...backing };
        for (const k of list) {
          delete backing[k];
        }
        notifyChange(backing, list, oldSnap, areaName);
        callback?.();
        return Promise.resolve();
      },
    };

    return area as unknown as chrome.storage.StorageArea;
  };

  const origin = `${globalThis.location?.origin ?? 'http://localhost:5173'}`;

  async function routePreviewMessageAsync(message: unknown): Promise<unknown> {
    if (!message || typeof message !== 'object' || !('type' in message)) return {};
    const type = String((message as { type: unknown }).type);
    switch (type) {
      case 'CHECK_UPDATE':
        return {
          ok: true as const,
          result: {
            hasUpdate: false,
            current: getCurrentVersion(),
            latest: null,
            checkedAt: Date.now(),
          },
        };
      case 'REFINE_PROMPT': {
        const payload = (
          message as {
            payload?: { historyId?: string; instruction?: string; current?: string };
          }
        ).payload;
        const historyId = payload?.historyId ?? '';
        const instruction = String(payload?.instruction ?? '').trim();
        const current = String(payload?.current ?? '');
        if (!historyId) {
          return { ok: false as const, error: '预览：缺少 historyId' };
        }
        try {
          const [{ getHistoryItem }, { appendPromptVersion }] = await Promise.all([
            import('@/lib/storage'),
            import('@/lib/storage/versions'),
          ]);
          const item = await getHistoryItem(historyId);
          if (!item) {
            return { ok: false as const, error: '预览：找不到对应历史记录' };
          }
          const tag = instruction || '（无说明）';
          const newPrompt = `${current.trim()}\n\n【预览调整 · 非真实模型】${tag}`;
          const meta = {
            provider: item.provider,
            model: item.model,
            style: item.style,
            ...(item.strategy ? { strategy: item.strategy } : {}),
          };
          const updated = await appendPromptVersion(
            historyId,
            newPrompt,
            'refined',
            undefined,
            meta
          );
          if (!updated) {
            return { ok: false as const, error: '预览：写入新版本失败' };
          }
          const head = updated.versions[0];
          return {
            ok: true as const,
            prompt: updated.prompt,
            provider: updated.provider,
            model: updated.model,
            versionId: head?.id ?? '',
          };
        } catch {
          return { ok: false as const, error: '预览：Refine 模拟异常' };
        }
      }
      case 'OPEN_IN_PANEL': {
        // 预览环境仅切换视图；`dock` 由真实扩展的 content script 消费。
        postDevPreviewNav({ view: 'panel' });
        return { ok: true as const };
      }
      case 'OPEN_OPTIONS': {
        const pl = (
          message as {
            payload?: { tab?: string; focusId?: string; dock?: string };
          }
        ).payload;
        const tab = pl?.tab === 'settings' || pl?.tab === 'library' ? pl.tab : undefined;
        const focusId = typeof pl?.focusId === 'string' ? pl.focusId : undefined;
        const dock = pl?.dock === 'refine' || pl?.dock === 'versions' ? pl.dock : undefined;
        if (!tab && !focusId) {
          postDevPreviewNav({ view: 'options' });
        } else {
          const params = new URLSearchParams();
          if (tab) params.set('tab', tab);
          if (focusId) params.set('focus', focusId);
          if (dock) params.set('dock', dock);
          const qs = params.toString();
          postDevPreviewNav({ view: 'options', ...(qs ? { optionsHash: qs } : {}) });
        }
        return { ok: true as const };
      }
      /* 与 background 同形，供 extensionBridge → 本机 IndexedDB（与种子库一致）。 */
      case 'GET_HISTORY_ITEM': {
        const id = (message as { payload?: { id?: string } }).payload?.id;
        if (!id) {
          return { ok: false as const, error: '缺少 id' };
        }
        try {
          const { getHistoryItem } = await import('@/lib/storage');
          const item = await getHistoryItem(id);
          return { ok: true as const, item };
        } catch {
          return { ok: false as const, error: 'GET_HISTORY_ITEM 异常' };
        }
      }
      case 'APPEND_PROMPT_VERSION': {
        const p = (
          message as {
            payload?: {
              id?: string;
              prompt?: string;
              source?: Parameters<(typeof import('@/lib/storage'))['appendPromptVersion']>[2];
              note?: string;
              meta?: Parameters<(typeof import('@/lib/storage'))['appendPromptVersion']>[4];
            };
          }
        ).payload;
        if (!p?.id || typeof p.prompt !== 'string') {
          return { ok: false as const, error: '参数缺失' };
        }
        try {
          const { appendPromptVersion } = await import('@/lib/storage');
          const item = await appendPromptVersion(
            p.id,
            p.prompt,
            p.source ?? 'edited',
            p.note,
            p.meta
          );
          return { ok: true as const, item };
        } catch {
          return { ok: false as const, error: 'APPEND_PROMPT_VERSION 异常' };
        }
      }
      case 'RESTORE_PROMPT_VERSION': {
        const p = (message as { payload?: { id?: string; versionId?: string } }).payload;
        if (!p?.id || !p.versionId) {
          return { ok: false as const, error: '参数缺失' };
        }
        try {
          const { restorePromptVersion } = await import('@/lib/storage');
          const item = await restorePromptVersion(p.id, p.versionId);
          return { ok: true as const, item };
        } catch {
          return { ok: false as const, error: 'RESTORE_PROMPT_VERSION 异常' };
        }
      }
      case 'REMOVE_PROMPT_VERSION': {
        const p = (message as { payload?: { id?: string; versionId?: string } }).payload;
        if (!p?.id || !p.versionId) {
          return { ok: false as const, error: '参数缺失' };
        }
        try {
          const { removePromptVersion } = await import('@/lib/storage');
          const item = await removePromptVersion(p.id, p.versionId);
          return { ok: true as const, item };
        } catch {
          return { ok: false as const, error: 'REMOVE_PROMPT_VERSION 异常' };
        }
      }
      /* EXTRACT_PROMPT 未模拟：面板内「重新生成」会发消息但无后台流式进度，可能停在 loading。 */
      default:
        return {};
    }
  }

  function sendMessageImpl(...args: unknown[]) {
    let messageObj: unknown;
    let responseCallback: ((response: unknown) => void) | undefined;

    const a0 = args[0];
    const a1 = args[1];
    const a2 = args[2];

    if (typeof a0 === 'string' && typeof a1 === 'object' && a1 !== null && 'type' in a1) {
      messageObj = a1;
      const last = args[args.length - 1];
      responseCallback = typeof last === 'function' ? (last as (r: unknown) => void) : undefined;
    } else if (typeof a0 === 'object') {
      messageObj = a0;
      responseCallback =
        typeof a1 === 'function'
          ? (a1 as (r: unknown) => void)
          : typeof a2 === 'function'
            ? (a2 as (r: unknown) => void)
            : undefined;
    }

    const replyP = routePreviewMessageAsync(messageObj);
    void replyP.then((reply) => {
      if (responseCallback) {
        queueMicrotask(() => responseCallback!.call(null, reply));
      }
    });
    return replyP;
  }

  const shimRuntime = {
    id: 'prompt-extracto-dev-preview',

    getURL(path: string) {
      const trimmed = String(path || '').replace(/^\/+/, '');
      return `${origin}/${trimmed}`;
    },

    openOptionsPage(): void {
      postDevPreviewNav({ view: 'options' });
    },
    reload(): void {},

    sendMessage: sendMessageImpl as typeof chrome.runtime.sendMessage,

    connect(): chrome.runtime.Port {
      const noop = (): void => undefined;
      return {
        name: '__preview_stub__',
        disconnect: noop,
        onDisconnect: { addListener: noop, removeListener: noop } as unknown as chrome.runtime.Port['onDisconnect'],
        onMessage: { addListener: noop, removeListener: noop } as unknown as chrome.runtime.Port['onMessage'],
        postMessage(): void {},
      } as unknown as chrome.runtime.Port;
    },

    onMessage: {
      addListener(): void {},
      removeListener(): void {},
    },

    getManifest(): chrome.runtime.ManifestV3 {
      throw new Error('preview: getManifest unsupported');
    },
  };

  Object.defineProperty(shimRuntime, 'lastError', {
    enumerable: false,
    configurable: false,
    get(): chrome.runtime.LastError | undefined {
      return undefined;
    },
  });

  const previewStorage = {
    local: makeArea('local'),
    sync: makeArea('sync'),
    managed: makeArea('managed'),
    session: makeArea('session'),
    onChanged: {
      addListener(fn: StorageListener) {
        storageListeners.add(fn);
      },
      removeListener(fn: StorageListener) {
        storageListeners.delete(fn);
      },
    },
    onChangedExternal: {
      addListener() {},
      removeListener() {},
    },
  } as unknown as typeof chrome.storage;

  const previewI18n = {
    getMessage() {
      return '';
    },
    getUILanguage(): string {
      return navigator.language.split('-')[0] || 'en';
    },
    detectLanguage(_text: string, cb: (result: chrome.i18n.LanguageDetectionResult) => void) {
      cb({ isReliable: true, languages: [{ language: navigator.language, percentage: 100 }] });
    },
    getAcceptLanguages(cb: (languages: string[]) => void) {
      cb(navigator.languages.slice());
    },
  } as unknown as typeof chrome.i18n;

  w.chrome ||= {} as typeof chrome;
  w.chrome.storage = previewStorage;
  w.chrome.runtime = shimRuntime as unknown as typeof chrome.runtime;
  w.chrome.i18n = w.chrome.i18n ?? previewI18n;

  void w.chrome.storage.sync.get([SETTINGS_KEY], (existing) => {
    if (!(SETTINGS_KEY in existing)) {
      void w.chrome!.storage.sync.set({
        [SETTINGS_KEY]: {},
      }).catch(() => undefined);
    }
  });
}
