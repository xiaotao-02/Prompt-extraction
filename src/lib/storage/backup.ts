/**
 * 全量备份 / 恢复。把 settings + history + folders 序列化为一份 JSON 文件，
 * 反过来也能从 JSON 把整个扩展的数据还原回 IndexedDB + chrome.storage。
 *
 * 备份格式版本：
 * - v1：仅 settings + history
 * - v2：在 v1 基础上新增 folders（提示词库的项目 / 文件夹）
 * - v3：在 v2 基础上新增 strategyPresets（用户命名的自定义策略预设）
 *
 * 恢复时 v1 备份会被静默接受（folders 视为空数组），不会丢失老用户的数据。
 */
import type { AppSettings, HistoryItem, LibraryFolder, UserStrategyPreset } from '../types';
import { getSettings, saveSettings } from './settings';
import {
  ensureLibraryReady,
  finalizeHistoryMutation,
  HISTORY_LIMIT,
  migrateItem,
  writeHistory,
} from './history';
import {
  exportAllHistoryPublic,
  getHistoryRecord,
  historyCount,
  putHistoryRecord,
  toPublicHistory,
  toStoredRecord,
  trimOldestToMax,
} from './historyDb';
import { getFolders, mergeFolders, replaceFolders } from './folders';
import { mirrorCurrentVersion, normalizePromptVersions } from './versionState';
import {
  getUserStrategyPresets,
  mergeUserStrategyPresets,
  setUserStrategyPresets,
} from './userStrategyPresets';

export interface BackupPayload {
  /** 备份文件格式版本，递增；当前 3（v1/v2 仍兼容）。 */
  version: 1 | 2 | 3;
  /** 备份生成时间 ISO 字符串，便于人眼判断新旧。 */
  exportedAt: string;
  /** 生成备份的扩展版本，便于排查。 */
  appVersion?: string;
  settings: AppSettings;
  history: HistoryItem[];
  /** 提示词库项目 / 文件夹列表，v2 起新增；v1 备份恢复时按空数组处理。 */
  folders?: LibraryFolder[];
  /** 用户自定义策略预设，v3 起新增；v1/v2 恢复时保留本地已有预设。 */
  strategyPresets?: UserStrategyPreset[];
}

export async function buildBackup(appVersion?: string): Promise<BackupPayload> {
  await ensureLibraryReady();
  const [settings, history, folders, strategyPresets] = await Promise.all([
    getSettings(),
    exportAllHistoryPublic(),
    getFolders(),
    getUserStrategyPresets(),
  ]);
  return {
    version: 3,
    exportedAt: new Date().toISOString(),
    appVersion,
    settings,
    history,
    folders,
    strategyPresets,
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
  if (!payload || (payload.version !== 1 && payload.version !== 2 && payload.version !== 3)) {
    throw new Error('不支持的备份格式');
  }
  let settingsRestored = false;
  if (payload.settings) {
    await saveSettings(payload.settings);
    settingsRestored = true;
  }

  // folders 是 v2 才有的字段，v1 备份缺失时按空数组处理（不会清空已有 folders）
  if (Array.isArray(payload.folders)) {
    if (mode === 'replace') {
      await replaceFolders(payload.folders);
    } else {
      await mergeFolders(payload.folders);
    }
  }

  // strategyPresets：仅当备份里显式带了数组时才恢复（v1/v2 无此字段 → 不动本地预设）
  if (Array.isArray(payload.strategyPresets)) {
    if (mode === 'replace') {
      await setUserStrategyPresets(payload.strategyPresets);
    } else {
      const merged = mergeUserStrategyPresets(
        await getUserStrategyPresets(),
        payload.strategyPresets
      );
      await setUserStrategyPresets(merged);
    }
  }

  let added = 0;
  if (Array.isArray(payload.history)) {
    await ensureLibraryReady();
    if (mode === 'replace') {
      const next = payload.history
        .slice(0, HISTORY_LIMIT)
        .map((item) => mirrorCurrentVersion(migrateItem(item)));
      await writeHistory(next);
      added = next.length;
    } else {
      for (const incoming of payload.history) {
        const item = migrateItem(incoming);
        const row = await getHistoryRecord(item.id);
        const exist = row ? toPublicHistory(row) : null;
        if (!exist) {
          await putHistoryRecord(toStoredRecord(item));
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
          await putHistoryRecord(
            toStoredRecord(
              mirrorCurrentVersion({
                ...newer,
                versions: normalizePromptVersions(mergedVersions),
              })
            )
          );
        }
      }
      await trimOldestToMax(HISTORY_LIMIT);
      await finalizeHistoryMutation();
    }
  }
  const total = await historyCount();
  return { settingsRestored, historyAdded: added, historyTotal: total };
}
