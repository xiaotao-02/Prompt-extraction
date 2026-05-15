/**
 * 全量备份 / 恢复。把 settings + history + folders 序列化为一份 JSON 文件，
 * 反过来也能从 JSON 把整个扩展的数据还原回 IndexedDB + chrome.storage。
 *
 * 备份格式版本：
 * - v1：仅 settings + history
 * - v2：在 v1 基础上新增 folders（提示词库的项目 / 文件夹）
 * - v3：在 v2 基础上新增 strategyPresets（用户命名的自定义策略预设）
 *
 * 恢复：`merge` 时若备份缺 folders / strategyPresets 则不改动本地对应数据；
 * `replace` 时缺失章节视为空数组并清空本地。
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
import { normalizePromptVersions } from './versionState';
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
  /** 提示词库项目 / 文件夹列表，v2 起新增。 */
  folders?: LibraryFolder[];
  /** 用户自定义策略预设，v3 起新增。 */
  strategyPresets?: UserStrategyPreset[];
}

function coerceBackupVersion(o: Record<string, unknown>): 1 | 2 | 3 {
  const v = o.version;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (n === 1 || n === 2 || n === 3) return n;
  if (Array.isArray(o.strategyPresets)) return 3;
  if (Array.isArray(o.folders)) return 2;
  return 1;
}

/**
 * 校验并将任意解析后的 JSON 规范为 {@link BackupPayload}。
 * `version` 缺失或非法时按载荷字段推断（strategyPresets → v3，folders → v2，否则 v1）。
 */
export function parseBackupPayload(raw: unknown): BackupPayload {
  if (!raw || typeof raw !== 'object') {
    throw new Error('备份内容不是有效的 JSON 对象');
  }
  const o = raw as Record<string, unknown>;
  if (!o.settings || typeof o.settings !== 'object' || Array.isArray(o.settings)) {
    throw new Error('备份缺少有效的 settings 字段');
  }
  if (!Array.isArray(o.history)) {
    throw new Error('备份缺少有效的 history 数组');
  }
  const version = coerceBackupVersion(o);
  const exportedAt =
    typeof o.exportedAt === 'string' && o.exportedAt.trim().length > 0
      ? o.exportedAt
      : new Date().toISOString();
  return {
    version,
    exportedAt,
    ...(typeof o.appVersion === 'string' ? { appVersion: o.appVersion } : {}),
    settings: o.settings as AppSettings,
    history: o.history as HistoryItem[],
    ...(Array.isArray(o.folders) ? { folders: o.folders as LibraryFolder[] } : {}),
    ...(Array.isArray(o.strategyPresets)
      ? { strategyPresets: o.strategyPresets as UserStrategyPreset[] }
      : {}),
  };
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
 * @param payload 备份内容（可先经 JSON.parse；会与 {@link parseBackupPayload} 等价校验）
 * @param mode    'replace' 直接覆盖；'merge' 与现有数据合并（按 id 去重，保留较新的 updatedAt）
 */
export async function restoreBackup(
  payload: unknown,
  mode: 'replace' | 'merge' = 'merge'
): Promise<{ settingsRestored: boolean; historyAdded: number; historyTotal: number }> {
  const data = parseBackupPayload(payload);
  let settingsRestored = false;
  if (data.settings) {
    await saveSettings(data.settings);
    settingsRestored = true;
  }

  if (mode === 'replace') {
    await replaceFolders(Array.isArray(data.folders) ? data.folders : []);
  } else if (Array.isArray(data.folders)) {
    await mergeFolders(data.folders);
  }

  if (mode === 'replace') {
    await setUserStrategyPresets(Array.isArray(data.strategyPresets) ? data.strategyPresets : []);
  } else if (Array.isArray(data.strategyPresets)) {
    const merged = mergeUserStrategyPresets(
      await getUserStrategyPresets(),
      data.strategyPresets
    );
    await setUserStrategyPresets(merged);
  }

  let added = 0;
  if (Array.isArray(data.history)) {
    await ensureLibraryReady();
    if (mode === 'replace') {
      const next = data.history.slice(0, HISTORY_LIMIT).map((item) => migrateItem(item));
      await writeHistory(next);
      added = next.length;
    } else {
      for (const incoming of data.history) {
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
              migrateItem({
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
