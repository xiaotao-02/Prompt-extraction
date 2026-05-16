import type { AppSettings, ProviderId } from '../types';
import { DEFAULT_ONE_CLICK_REWRITE_RANDOMNESS } from '../oneClickRewrite';
import { PROVIDERS } from '../providers';
import { DEFAULT_STRATEGY_ID } from '../strategies';
import { DEFAULT_UPDATE_SETTINGS } from '../updater';
import { notifyBackupSubscribers } from './events';
import { DISCOVERED_KEY, SETTINGS_KEY } from './keys';

export { DISCOVERED_KEY, SETTINGS_KEY, USER_STRATEGY_PRESETS_KEY } from './keys';

interface DiscoveredCache {
  models: string[];
  at: number;
}
type DiscoveredMap = Partial<Record<ProviderId, DiscoveredCache>>;

// 注意：STYLE_PROMPTS 这个 module-scope 常量已经被「策略档位」体系取代。
// 新代码请通过 `getStrategy(settings.promptStrategy).stylePrompts[outputStyle]`
// 拿到当前生效档位下的指令文本。详见 src/lib/strategies.ts。

function defaultSettings(): AppSettings {
  const providers = Object.fromEntries(
    Object.values(PROVIDERS).map((p) => [
      p.id,
      {
        id: p.id,
        apiKey: '',
        baseUrl: p.defaultBaseUrl,
        model: p.defaultModel,
      },
    ])
  ) as AppSettings['providers'];

  return {
    activeProvider: 'openai',
    providers,
    outputStyle: 'natural-zh',
    customPromptTemplate: '',
    saveHistory: true,
    updates: { ...DEFAULT_UPDATE_SETTINGS },
    promptStrategy: DEFAULT_STRATEGY_ID,
    oneClickRewriteRandomness: DEFAULT_ONE_CLICK_REWRITE_RANDOMNESS,
    panelAutofocus: true,
    popupToolbarPromptAction: 'library',
    customComponents: {
      stylePromptSet: 'v0.3.0',
      sampling: 'v0.3.0',
      customJoin: 'v0.3.0',
    },
  };
}

/**
 * 在写入 chrome.storage.sync 前剥离体积大、易爆配额的字段（如 discoveredModels）。
 * 这些字段会单独走 chrome.storage.local。
 */
function stripBulky(settings: AppSettings): AppSettings {
  const providers = Object.fromEntries(
    (Object.entries(settings.providers) as Array<[ProviderId, AppSettings['providers'][ProviderId]]>).map(
      ([id, cfg]) => [
        id,
        {
          id: cfg.id,
          apiKey: cfg.apiKey,
          baseUrl: cfg.baseUrl,
          model: cfg.model,
        },
      ]
    )
  ) as AppSettings['providers'];
  return { ...settings, providers };
}

async function readDiscoveredMap(): Promise<DiscoveredMap> {
  try {
    const data = await chrome.storage.local.get(DISCOVERED_KEY);
    const raw = (data[DISCOVERED_KEY] as DiscoveredMap) || {};
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

async function writeDiscoveredMap(map: DiscoveredMap): Promise<void> {
  await chrome.storage.local.set({ [DISCOVERED_KEY]: map });
}

export async function getSettings(): Promise<AppSettings> {
  const [syncData, discovered] = await Promise.all([
    chrome.storage.sync.get(SETTINGS_KEY),
    readDiscoveredMap(),
  ]);
  const stored = syncData[SETTINGS_KEY] as Partial<AppSettings> | undefined;
  const base = defaultSettings();
  // 合并，避免新增 provider 时旧配置缺字段
  const mergedProviders = { ...base.providers };
  if (stored?.providers) {
    for (const id of Object.keys(stored.providers) as ProviderId[]) {
      mergedProviders[id] = { ...base.providers[id], ...stored.providers[id] };
    }
  }
  // 把 local 里的 discoveredModels 合回每个 provider 配置
  for (const id of Object.keys(mergedProviders) as ProviderId[]) {
    const cached = discovered[id];
    if (cached && Array.isArray(cached.models)) {
      mergedProviders[id] = {
        ...mergedProviders[id],
        discoveredModels: cached.models,
        discoveredAt: cached.at,
      };
    } else {
      // 兼容老版本：当年 discoveredModels 是和 settings 一起 sync 的
      // 这里只读不删，保证回滚兼容；下次 saveSettings 会自动迁移到 local。
    }
  }
  // 老版本曾在 updates 里存过 enabled/feedUrl/intervalHours 等字段，
  // 这里只挑出新结构关心的两个字段，其余自动丢弃。
  const storedUpdates = (stored?.updates || {}) as Partial<typeof base.updates>;
  const mergedUpdates = {
    lastCheckedAt: storedUpdates.lastCheckedAt ?? base.updates.lastCheckedAt,
    lastResult: storedUpdates.lastResult ?? base.updates.lastResult,
  };
  return {
    ...base,
    ...(stored || {}),
    providers: mergedProviders,
    updates: mergedUpdates,
  };
}

/**
 * 保存全部设置。
 *
 * - chrome.storage.sync 只写**轻量**字段（API Key / baseUrl / model / 风格 / 更新设置 …）
 * - chrome.storage.local 单独维护 discoveredModels 缓存
 *
 * 如果 sync 写入仍然失败（例如总配额 100KB 用完，或网络异常），会自动回退到 local，
 * 避免「点了保存看起来成功，重启后回滚」的隐患。
 */
export async function saveSettings(settings: AppSettings): Promise<void> {
  const slim = stripBulky(settings);
  // 1) 写 discoveredModels 到 local（体积无忧）
  const map: DiscoveredMap = {};
  for (const id of Object.keys(settings.providers) as ProviderId[]) {
    const cfg = settings.providers[id];
    if (cfg.discoveredModels && cfg.discoveredModels.length > 0) {
      map[id] = { models: cfg.discoveredModels, at: cfg.discoveredAt || Date.now() };
    }
  }
  await writeDiscoveredMap(map);

  // 2) 写轻量 settings 到 sync
  let syncOk = false;
  try {
    await chrome.storage.sync.set({ [SETTINGS_KEY]: slim });
    syncOk = true;
  } catch (err) {
    // 极端情况：sync 总配额耗尽，转写 local 保底，保证用户的 API Key 永远不丢
    console.warn('[PromptExtracto] sync set failed, falling back to local', err);
    await chrome.storage.local.set({ [SETTINGS_KEY]: slim });
  }

  // sync 写成功后，清掉之前可能 fallback 残留在 local 的旧值，避免下次 getSettings
  // 读取分歧。这里**不再** sync.get 二次确认（写成功的 set 已经够说明问题），省一次
  // 跨进程往返；清 local 失败也无关紧要（local 没有旧值就什么也不会发生）。
  if (syncOk) {
    chrome.storage.local.remove(SETTINGS_KEY).catch(() => undefined);
  }

  void notifyBackupSubscribers();
}
