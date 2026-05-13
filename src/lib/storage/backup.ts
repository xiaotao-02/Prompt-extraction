/**
 * 全量备份 / 恢复。把 settings + history 序列化为一份 JSON 文件，
 * 反过来也能从 JSON 把整个扩展的数据还原回 chrome.storage。
 */
import type { AppSettings, HistoryItem } from '../types';
import { getSettings, saveSettings } from './settings';
import { getHistory, writeHistory, migrateItem, HISTORY_LIMIT } from './history';

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
