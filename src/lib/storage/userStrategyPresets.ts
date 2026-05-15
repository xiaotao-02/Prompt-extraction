/**
 * 用户在「自定义组合」下保存的命名策略预设（chrome.storage.local）。
 */
import type { AppSettings, UserStrategyPreset } from '../types';
import type { StrategyComponents } from '../strategies-meta';
import { notifyBackupSubscribers } from './events';
import { USER_STRATEGY_PRESETS_KEY } from './keys';

export const MAX_USER_STRATEGY_PRESETS = 30;
export const MAX_PRESET_NAME_LEN = 64;

export const DEFAULT_CUSTOM_COMPONENTS: StrategyComponents = {
  stylePromptSet: 'v0.3.0',
  sampling: 'v0.3.0',
  customJoin: 'v0.3.0',
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function normalizePreset(raw: unknown): UserStrategyPreset | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === 'string' ? raw.id : '';
  const name =
    typeof raw.name === 'string' ? raw.name.trim().slice(0, MAX_PRESET_NAME_LEN) : '';
  const cc = raw.customComponents;
  if (!id || !name || !isRecord(cc)) return null;
  const stylePromptSet = cc.stylePromptSet;
  const sampling = cc.sampling;
  const customJoin = cc.customJoin;
  if (
    typeof stylePromptSet !== 'string' ||
    typeof sampling !== 'string' ||
    typeof customJoin !== 'string'
  ) {
    return null;
  }
  const createdAt = typeof raw.createdAt === 'number' ? raw.createdAt : Date.now();
  const updatedAt = typeof raw.updatedAt === 'number' ? raw.updatedAt : createdAt;
  const customPromptTemplate =
    typeof raw.customPromptTemplate === 'string' ? raw.customPromptTemplate : '';
  const out: UserStrategyPreset = {
    id,
    name,
    createdAt,
    updatedAt,
    customComponents: {
      stylePromptSet: stylePromptSet as StrategyComponents['stylePromptSet'],
      sampling: sampling as StrategyComponents['sampling'],
      customJoin: customJoin as StrategyComponents['customJoin'],
    },
    customPromptTemplate,
  };
  if (typeof raw.customInstruction === 'string' && raw.customInstruction) {
    out.customInstruction = raw.customInstruction;
  }
  if (typeof raw.customTemperature === 'number') out.customTemperature = raw.customTemperature;
  if (typeof raw.customMaxTokens === 'number') out.customMaxTokens = raw.customMaxTokens;
  return out;
}

export async function getUserStrategyPresets(): Promise<UserStrategyPreset[]> {
  try {
    const data = await chrome.storage.local.get(USER_STRATEGY_PRESETS_KEY);
    const raw = data[USER_STRATEGY_PRESETS_KEY];
    if (!Array.isArray(raw)) return [];
    const list = raw.map(normalizePreset).filter((x): x is UserStrategyPreset => x != null);
    return list.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

export async function setUserStrategyPresets(presets: UserStrategyPreset[]): Promise<void> {
  await chrome.storage.local.set({ [USER_STRATEGY_PRESETS_KEY]: presets });
  notifyBackupSubscribers();
}

export function mergeUserStrategyPresets(
  existing: UserStrategyPreset[],
  incoming: UserStrategyPreset[]
): UserStrategyPreset[] {
  const map = new Map<string, UserStrategyPreset>();
  for (const p of existing) map.set(p.id, p);
  for (const p of incoming) {
    const cur = map.get(p.id);
    const pTime = p.updatedAt ?? p.createdAt ?? 0;
    const cTime = cur ? (cur.updatedAt ?? cur.createdAt ?? 0) : 0;
    if (!cur || pTime >= cTime) map.set(p.id, p);
  }
  return [...map.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function buildUserStrategyPresetFromSettings(
  name: string,
  settings: AppSettings
): UserStrategyPreset {
  const trimmed = name.trim().slice(0, MAX_PRESET_NAME_LEN);
  const comp = settings.customComponents ?? DEFAULT_CUSTOM_COMPONENTS;
  return {
    id: crypto.randomUUID(),
    name: trimmed,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    customComponents: { ...comp },
    customInstruction: settings.customInstruction,
    customTemperature: settings.customTemperature,
    customMaxTokens: settings.customMaxTokens,
    customPromptTemplate: settings.customPromptTemplate ?? '',
  };
}

export function applyUserStrategyPresetToSettings(
  base: AppSettings,
  preset: UserStrategyPreset
): AppSettings {
  return {
    ...base,
    promptStrategy: 'custom',
    customComponents: { ...preset.customComponents },
    customInstruction: preset.customInstruction,
    customTemperature: preset.customTemperature,
    customMaxTokens: preset.customMaxTokens,
    customPromptTemplate: preset.customPromptTemplate ?? '',
  };
}

/** 策略版本网格中预设卡片的短说明（组件版本指纹） */
export function briefUserPresetFingerprint(preset: UserStrategyPreset): string {
  const c = preset.customComponents;
  return `指令集@${c.stylePromptSet} · 采样@${c.sampling} · 拼接@${c.customJoin}`;
}

/**
 * 当前 settings 是否与某一保存的预设快照完全一致（用于预设卡高亮）。
 */
export function isSettingsMatchingUserPreset(
  settings: AppSettings,
  preset: UserStrategyPreset
): boolean {
  if (settings.promptStrategy !== 'custom') return false;
  const sc = settings.customComponents ?? DEFAULT_CUSTOM_COMPONENTS;
  const pc = preset.customComponents;
  if (
    sc.stylePromptSet !== pc.stylePromptSet ||
    sc.sampling !== pc.sampling ||
    sc.customJoin !== pc.customJoin
  ) {
    return false;
  }
  const si = settings.customInstruction ?? '';
  const pi = preset.customInstruction ?? '';
  if (si !== pi) return false;
  if ((settings.customPromptTemplate ?? '') !== (preset.customPromptTemplate ?? '')) return false;
  if (settings.customTemperature !== preset.customTemperature) return false;
  if (settings.customMaxTokens !== preset.customMaxTokens) return false;
  return true;
}

export async function addUserStrategyPreset(
  preset: UserStrategyPreset
): Promise<{ ok: true } | { ok: false; reason: 'limit' }> {
  const list = await getUserStrategyPresets();
  if (list.length >= MAX_USER_STRATEGY_PRESETS) return { ok: false, reason: 'limit' };
  await setUserStrategyPresets([preset, ...list]);
  return { ok: true };
}

export async function removeUserStrategyPreset(id: string): Promise<void> {
  const list = await getUserStrategyPresets();
  await setUserStrategyPresets(list.filter((p) => p.id !== id));
}

export async function updateUserStrategyPresetName(id: string, name: string): Promise<void> {
  const trimmed = name.trim().slice(0, MAX_PRESET_NAME_LEN);
  if (!trimmed) return;
  const list = await getUserStrategyPresets();
  const next = list.map((p) =>
    p.id === id ? { ...p, name: trimmed, updatedAt: Date.now() } : p
  );
  await setUserStrategyPresets(next);
}
