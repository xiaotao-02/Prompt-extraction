import type {
  AppSettings,
  HistoryItem,
  ProviderId,
  PromptVersion,
  PromptVersionSource,
  UpdateCheckResult,
  UpdateSettings,
} from './types';
import { PROVIDERS } from './providers';
import { DEFAULT_UPDATE_SETTINGS } from './updater';

const SETTINGS_KEY = 'app_settings_v1';
const HISTORY_KEY = 'history_v1';
/**
 * 「从端点拉取的模型列表」缓存。
 *
 * 单独放到 chrome.storage.local 而不是塞进 SETTINGS_KEY 一起 sync，
 * 否则以下场景会**静默丢失 API Key**：
 * 中转站经常一次返回几百个模型 → providers.<id>.discoveredModels 拼一起轻松 >8KB
 * → chrome.storage.sync.set 抛 QUOTA_BYTES_PER_ITEM → 整个 settings 写入失败 → 用户
 * 看见「保存成功」但重启后回滚。把这部分缓存挪到 local 后，sync 里的 settings 始终在
 * 数百字节级别，永不会撑爆。
 */
const DISCOVERED_KEY = 'discovered_models_v1';
// 后台管理页支持的最大记录数。提升到 300 是因为「提示词库」鼓励用户长期保留与整理结果。
// 由于 chrome.storage.local 配额为 5MB 且我们已经把缩略图直接复用原图 URL，几乎不会触顶。
const HISTORY_LIMIT = 300;

interface DiscoveredCache {
  models: string[];
  at: number;
}
type DiscoveredMap = Partial<Record<ProviderId, DiscoveredCache>>;

export const STYLE_PROMPTS: Record<string, string> = {
  'natural-zh':
    '请用自然流畅的中文段落详细描述这张图片的画面内容、风格、构图、光线、色调、氛围以及主体细节，输出可作为 AI 绘图工具的高质量提示词。只输出提示词正文，不要任何前缀、解释或 Markdown。',
  'natural-en':
    'Describe this image in detailed, fluent English suitable as a high-quality prompt for AI image generators. Cover subject, style, composition, lighting, color palette, mood, and key details. Output ONLY the prompt body — no prefix, no explanation, no markdown.',
  'sd-tags':
    'Generate a Stable Diffusion / Danbooru-style English tag prompt for this image. Use comma-separated short tags ordered by importance. Include subject, character features, clothing, pose, environment, lighting, art style, quality boosters. Output ONLY the tag list, single line, no explanation.',
  midjourney:
    'Generate a Midjourney v6 style English prompt for this image. Use a vivid descriptive sentence with comma-separated style modifiers, then end with appropriate parameters like --ar 16:9 --style raw if relevant. Output ONLY the prompt, no explanation, no markdown.',
};

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

const backupListeners = new Set<() => void>();
export function onLocalDataChange(listener: () => void): () => void {
  backupListeners.add(listener);
  return () => backupListeners.delete(listener);
}
function notifyBackupSubscribers(): void {
  for (const l of backupListeners) {
    try {
      l();
    } catch (err) {
      console.debug('[PromptExtracto] backup listener failed', err);
    }
  }
}

export async function getUpdateSettings(): Promise<UpdateSettings> {
  const s = await getSettings();
  return s.updates;
}

export async function patchUpdateSettings(
  patch: Partial<UpdateSettings>
): Promise<UpdateSettings> {
  const s = await getSettings();
  const next: UpdateSettings = { ...s.updates, ...patch };
  await saveSettings({ ...s, updates: next });
  return next;
}

export async function saveUpdateResult(result: UpdateCheckResult): Promise<UpdateSettings> {
  return patchUpdateSettings({
    lastResult: result,
    lastCheckedAt: result.checkedAt,
  });
}

function migrateItem(raw: HistoryItem): HistoryItem {
  if (raw.versions && raw.versions.length > 0) return raw;
  const seedVersion: PromptVersion = {
    id: raw.id + ':v0',
    prompt: raw.prompt,
    createdAt: raw.createdAt || Date.now(),
    source: 'extracted',
  };
  return {
    ...raw,
    updatedAt: raw.updatedAt ?? raw.createdAt,
    versions: [seedVersion],
  };
}

/**
 * History 内存缓存。
 *
 * 为什么需要：`HISTORY_LIMIT = 300` + 每条带 ~32KB 缩略图 dataUrl，整段 history JSON
 * 累积起来可达 5–10MB。原本 `addHistory` 流程是「`storage.local.get` 反序列化整段 →
 * unshift → `storage.local.set` 序列化整段」，每次右键抽图都要为此付出 100–300ms
 * 同步 IPC + JSON 开销。**因为 service worker 是单线程**，这会让"刚抽完上一张、紧
 * 接着抽下一张"明显卡一拍；并且开销随历史条数线性增长，正好对应用户感觉到的
 * 「越用越慢」。
 *
 * 缓存策略：
 * - 首次读时从 storage 反序列化一份并存到 `historyCache`
 * - 之后的所有 read/write 都直接走缓存（write 会同步把数组替换并异步写回 storage）
 * - 其它 context（options / popup）修改了 history 时，通过 `storage.onChanged` 监听
 *   及时使缓存失效 / 同步
 *
 * service worker 30s 闲置销毁后第一次冷启会重读一次，这是预期且可接受的成本。
 */
let historyCache: HistoryItem[] | null = null;

/**
 * 把外部 `storage.onChanged` 事件传过来的新值同步进缓存。
 *
 * 注意：因为 `storage.local.set` 会把内层对象做结构化克隆后回传，
 * 不能用引用相等保证 newValue === 我们刚写进去的那份；这里始终重建一份。
 */
function syncHistoryCacheFromExternal(rawNew: unknown): void {
  if (!Array.isArray(rawNew)) {
    historyCache = null;
    return;
  }
  try {
    historyCache = (rawNew as HistoryItem[]).map(migrateItem);
  } catch {
    historyCache = null;
  }
}

// service worker / options / popup 都能跑到这一行：监听 storage 跨 context 变化，
// 保证不同 context 里的 historyCache 不会发生分歧。
try {
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'local') return;
    if (HISTORY_KEY in changes) {
      syncHistoryCacheFromExternal(changes[HISTORY_KEY].newValue);
    }
  });
} catch {
  /* 测试环境 / 无 chrome.storage 时静默 */
}

export async function getHistory(): Promise<HistoryItem[]> {
  if (!historyCache) {
    const data = await chrome.storage.local.get(HISTORY_KEY);
    const raw = (data[HISTORY_KEY] as HistoryItem[]) || [];
    historyCache = raw.map(migrateItem);
  }
  // 返回浅拷贝：原代码契约里 mutator（addHistory / patchHistoryItem 等）会直接
  // mutate 自己拿到的 list 再 writeHistory；调用方 (PromptLibrary 等) 拿到的引用
  // 不应被这些 mutate 偷偷修改。slice() 在 300 条以内是微秒级，不构成开销。
  return historyCache.slice();
}

async function writeHistory(list: HistoryItem[]): Promise<void> {
  // 先更新内存缓存，确保紧随其后的 getHistory 不需要等 storage 落盘就能拿到最新值
  historyCache = list;
  await chrome.storage.local.set({ [HISTORY_KEY]: list });
  notifyBackupSubscribers();
}

export async function addHistory(item: HistoryItem): Promise<void> {
  const list = await getHistory();
  list.unshift(migrateItem(item));
  if (list.length > HISTORY_LIMIT) list.length = HISTORY_LIMIT;
  await writeHistory(list);
}

export async function clearHistory(): Promise<void> {
  historyCache = [];
  await chrome.storage.local.remove(HISTORY_KEY);
  notifyBackupSubscribers();
}

export async function removeHistory(id: string): Promise<void> {
  const list = await getHistory();
  const next = list.filter((i) => i.id !== id);
  await writeHistory(next);
}

/** 批量删除若干条历史项；用于「提示词库」的多选删除。 */
export async function removeHistoryItems(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const set = new Set(ids);
  const list = await getHistory();
  const next = list.filter((i) => !set.has(i.id));
  await writeHistory(next);
}

/**
 * 局部更新一条 HistoryItem（例如 `pinned`、`note`、`thumbnail` 等只读元数据）。
 * 注意：不允许通过此方法改写 `versions` / `prompt`，那两者应走 appendPromptVersion / restorePromptVersion。
 */
export async function patchHistoryItem(
  id: string,
  patch: Partial<Pick<HistoryItem, 'pinned' | 'note' | 'thumbnail' | 'pageTitle'>>
): Promise<HistoryItem | null> {
  const list = await getHistory();
  const idx = list.findIndex((i) => i.id === id);
  if (idx < 0) return null;
  const updated: HistoryItem = { ...list[idx], ...patch };
  list[idx] = updated;
  await writeHistory(list);
  return updated;
}

/**
 * 删除某条记录中的某个历史版本。
 *
 * - 不允许删除「当前版本」（即 `versions[0]`），UI 应禁用该按钮；
 *   如果误传了当前版本 id，本方法会原样返回。
 * - 不允许删到 0 条版本：至少保留 1 条。
 */
export async function removePromptVersion(
  itemId: string,
  versionId: string
): Promise<HistoryItem | null> {
  const list = await getHistory();
  const idx = list.findIndex((i) => i.id === itemId);
  if (idx < 0) return null;
  const item = list[idx];
  if (!item.versions || item.versions.length <= 1) return item;
  if (item.versions[0]?.id === versionId) return item;
  const next = item.versions.filter((v) => v.id !== versionId);
  if (next.length === item.versions.length) return item;
  const updated: HistoryItem = { ...item, versions: next };
  list[idx] = updated;
  await writeHistory(list);
  return updated;
}

function newVersionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `v_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 在 id 对应的历史项上追加一条新版本，并把当前 prompt 切到新版本。
 * 若新内容与当前内容完全一致，则不创建新版本，直接返回原项。
 */
export async function appendPromptVersion(
  id: string,
  prompt: string,
  source: PromptVersionSource = 'edited',
  note?: string
): Promise<HistoryItem | null> {
  const list = await getHistory();
  const idx = list.findIndex((i) => i.id === id);
  if (idx < 0) return null;
  const item = list[idx];
  const trimmed = prompt.replace(/\s+$/g, '');
  if (trimmed === item.prompt.replace(/\s+$/g, '')) return item;
  const version: PromptVersion = {
    id: newVersionId(),
    prompt: trimmed,
    createdAt: Date.now(),
    source,
    note,
  };
  const updated: HistoryItem = {
    ...item,
    prompt: trimmed,
    updatedAt: version.createdAt,
    versions: [version, ...(item.versions || [])],
  };
  list[idx] = updated;
  await writeHistory(list);
  return updated;
}

/**
 * 把某个历史项恢复到指定版本：把那条版本的 prompt 拷出来作为最新一条版本（source = 'restored'）。
 */
export async function restorePromptVersion(
  id: string,
  versionId: string
): Promise<HistoryItem | null> {
  const list = await getHistory();
  const idx = list.findIndex((i) => i.id === id);
  if (idx < 0) return null;
  const item = list[idx];
  const target = item.versions.find((v) => v.id === versionId);
  if (!target) return null;
  if (target.prompt === item.prompt) return item;
  const version: PromptVersion = {
    id: newVersionId(),
    prompt: target.prompt,
    createdAt: Date.now(),
    source: 'restored',
    note: `restored from ${new Date(target.createdAt).toLocaleString()}`,
  };
  const updated: HistoryItem = {
    ...item,
    prompt: target.prompt,
    updatedAt: version.createdAt,
    versions: [version, ...item.versions],
  };
  list[idx] = updated;
  await writeHistory(list);
  return updated;
}

export async function getHistoryItem(id: string): Promise<HistoryItem | null> {
  const list = await getHistory();
  return list.find((i) => i.id === id) || null;
}

// ===================== 全量备份 / 恢复 =====================

/** 备份文件结构。version 字段用于后续兼容旧版本备份。 */
export interface BackupPayload {
  /** 备份文件格式版本，递增；当前 1。 */
  version: 1;
  /** 备份生成时间 ISO 字符串，便于人眼判断新旧。 */
  exportedAt: string;
  /** 生成备份的扩展版本，便于排查。 */
  appVersion?: string;
  settings: AppSettings;
  history: HistoryItem[];
}

export async function buildBackup(appVersion?: string): Promise<BackupPayload> {
  const [settings, history] = await Promise.all([getSettings(), getHistory()]);
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    appVersion,
    settings,
    history,
  };
}

/**
 * 从备份载荷恢复。
 *
 * @param payload 备份内容
 * @param mode    'replace' 直接覆盖；'merge' 与现有数据合并（按 id 去重，保留较新的 updatedAt）
 */
export async function restoreBackup(
  payload: BackupPayload,
  mode: 'replace' | 'merge' = 'merge'
): Promise<{ settingsRestored: boolean; historyAdded: number; historyTotal: number }> {
  if (!payload || payload.version !== 1) {
    throw new Error('不支持的备份格式');
  }
  // settings 直接整条覆盖（用户主动恢复，意图明确）
  let settingsRestored = false;
  if (payload.settings) {
    await saveSettings(payload.settings);
    settingsRestored = true;
  }

  let added = 0;
  if (Array.isArray(payload.history)) {
    if (mode === 'replace') {
      const next = payload.history.slice(0, HISTORY_LIMIT).map(migrateItem);
      await writeHistory(next);
      added = next.length;
    } else {
      const current = await getHistory();
      const byId = new Map(current.map((i) => [i.id, i] as const));
      for (const incoming of payload.history) {
        const item = migrateItem(incoming);
        const exist = byId.get(item.id);
        if (!exist) {
          byId.set(item.id, item);
          added++;
        } else {
          // 同 id：保留 updatedAt 更新的版本，但合并 versions 列表（按 id 去重）
          const newer =
            (item.updatedAt || item.createdAt || 0) >= (exist.updatedAt || exist.createdAt || 0)
              ? item
              : exist;
          const older = newer === item ? exist : item;
          const seen = new Set(newer.versions.map((v) => v.id));
          const mergedVersions = [...newer.versions];
          for (const v of older.versions) {
            if (!seen.has(v.id)) mergedVersions.push(v);
          }
          byId.set(item.id, { ...newer, versions: mergedVersions });
        }
      }
      const merged = Array.from(byId.values()).sort(
        (a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)
      );
      if (merged.length > HISTORY_LIMIT) merged.length = HISTORY_LIMIT;
      await writeHistory(merged);
    }
  }
  const total = (await getHistory()).length;
  return { settingsRestored, historyAdded: added, historyTotal: total };
}
