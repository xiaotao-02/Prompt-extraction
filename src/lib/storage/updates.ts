/**
 * 更新设置（自动检查更新）小帮助。
 * 这些函数只是 settings.updates 字段的便捷读/写。
 */
import type { UpdateCheckResult, UpdateSettings } from '../types';
import { getSettings, saveSettings } from './settings';

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
