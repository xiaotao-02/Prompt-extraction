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
const HISTORY_LIMIT = 100;

// 插件出厂自带的默认 API Key，按 provider 区分。
// 用户在「设置」里输入的 Key 始终优先于这里的默认值。
const BUILTIN_API_KEYS: Partial<Record<ProviderId, string>> = {
  shukelongda: 'sk-Rjr4K7i08ZYOhiSXY1QM4YnTUHuHXeMWcdYIJ0b3nf4TBb27',
};

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
        apiKey: BUILTIN_API_KEYS[p.id] ?? '',
        baseUrl: p.defaultBaseUrl,
        model: p.defaultModel,
      },
    ])
  ) as AppSettings['providers'];

  return {
    activeProvider: 'shukelongda',
    providers,
    outputStyle: 'natural-zh',
    customPromptTemplate: '',
    saveHistory: true,
    updates: { ...DEFAULT_UPDATE_SETTINGS },
  };
}

export async function getSettings(): Promise<AppSettings> {
  const data = await chrome.storage.sync.get(SETTINGS_KEY);
  const stored = data[SETTINGS_KEY] as Partial<AppSettings> | undefined;
  const base = defaultSettings();
  if (!stored) return base;
  // 合并，避免新增 provider 时旧配置缺字段
  const mergedProviders = { ...base.providers };
  if (stored.providers) {
    for (const id of Object.keys(stored.providers) as ProviderId[]) {
      mergedProviders[id] = { ...base.providers[id], ...stored.providers[id] };
    }
  }
  return {
    ...base,
    ...stored,
    providers: mergedProviders,
    updates: { ...base.updates, ...(stored.updates || {}) },
  };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
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

export async function getHistory(): Promise<HistoryItem[]> {
  const data = await chrome.storage.local.get(HISTORY_KEY);
  const raw = (data[HISTORY_KEY] as HistoryItem[]) || [];
  return raw.map(migrateItem);
}

export async function addHistory(item: HistoryItem): Promise<void> {
  const list = await getHistory();
  list.unshift(migrateItem(item));
  if (list.length > HISTORY_LIMIT) list.length = HISTORY_LIMIT;
  await chrome.storage.local.set({ [HISTORY_KEY]: list });
}

export async function clearHistory(): Promise<void> {
  await chrome.storage.local.remove(HISTORY_KEY);
}

export async function removeHistory(id: string): Promise<void> {
  const list = await getHistory();
  const next = list.filter((i) => i.id !== id);
  await chrome.storage.local.set({ [HISTORY_KEY]: next });
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
  await chrome.storage.local.set({ [HISTORY_KEY]: list });
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
  await chrome.storage.local.set({ [HISTORY_KEY]: list });
  return updated;
}

export async function getHistoryItem(id: string): Promise<HistoryItem | null> {
  const list = await getHistory();
  return list.find((i) => i.id === id) || null;
}
