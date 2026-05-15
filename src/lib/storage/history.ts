import type { HistoryItem, PromptVersion } from '../types';
import { notifyBackupSubscribers } from './events';
import {
  bulkPutHistoryItems,
  bulkReplaceHistory,
  bumpLibraryRev,
  clearHistoryStore,
  deleteHistoryRecord,
  exportAllHistoryPublic,
  getByDedupeKey,
  getHistoryRecord,
  historyCount,
  HISTORY_STORE,
  LIBRARY_REV_KEY,
  listHistoryGlobalDescPage,
  listRecentHistory,
  naturalDedupeKey,
  openHistoryDb,
  putHistoryRecord,
  scanHistoryLibraryStats,
  toPublicHistory,
  toStoredRecord,
  trimOldestToMax,
} from './historyDb';
import {
  getNextPromptVersionNo,
  metaFromHistoryItem,
  mirrorCurrentVersion,
  normalizePromptVersions,
} from './versionState';

export const HISTORY_KEY = 'history_v1';

/**
 * 「同图记录已合并」一次性迁移标记（老 chrome.storage 路径曾使用）。
 */
const HISTORY_DEDUP_FLAG = 'history_dedup_by_image_v1';

/**
 * IndexedDB 迁移完成后不再读取 `history_v1`。
 */
const HISTORY_IDB_MIGRATED_KEY = 'history_idb_migrated_v1';

/** 单库最大条数（超出则删除最旧记录）。 */
export const HISTORY_LIMIT = 100_000;

export {
  LIBRARY_REV_KEY,
  listHistoryGlobalDescPage,
  listRecentHistory,
  scanHistoryLibraryStats,
  historyCount,
  exportAllHistoryPublic,
};

/**
 * 存储层规范形态：`extracted` / `refined` 版本缺少 meta 时用条目顶层字段回填，
 * 再镜像当前版本（与 {@link addHistory} 合并路径一致）。
 */
export function normalizeHistoryItemStorageShape(item: HistoryItem): HistoryItem {
  const fallbackMeta = metaFromHistoryItem(item);
  const versions = (item.versions || []).map((v) => {
    if (!v) return v;
    if ((v.source === 'extracted' || v.source === 'refined') && !v.meta) {
      return { ...v, meta: fallbackMeta };
    }
    return v;
  });
  return mirrorCurrentVersion({ ...item, versions });
}

export function migrateItem(raw: HistoryItem): HistoryItem {
  if (raw.versions && raw.versions.length > 0) {
    return normalizeHistoryItemStorageShape(raw);
  }
  const seedVersion: PromptVersion = {
    id: raw.id + ':v0',
    prompt: raw.prompt,
    versionNo: 0,
    createdAt: raw.createdAt || Date.now(),
    source: 'extracted',
  };
  return normalizeHistoryItemStorageShape({
    ...raw,
    updatedAt: raw.updatedAt ?? raw.createdAt,
    versions: [seedVersion],
  });
}

function isSameImage(a: HistoryItem, b: HistoryItem): boolean {
  const la = a.imageUrls?.length ? a.imageUrls : a.imageUrl ? [a.imageUrl] : [];
  const lb = b.imageUrls?.length ? b.imageUrls : b.imageUrl ? [b.imageUrl] : [];
  if (la.length > 1 || lb.length > 1) {
    if (la.length !== lb.length) return false;
    return la.every((x, i) => x === lb[i]);
  }
  const ua = a.imageUrl || '';
  const ub = b.imageUrl || '';
  if (ua && ub && ua.length > 8 && ua === ub) return true;
  const ta = a.thumbnail || '';
  const tb = b.thumbnail || '';
  if (ta && tb && ta.length > 64 && ta === tb) return true;
  return false;
}

function dedupHistoryByImage(list: HistoryItem[]): HistoryItem[] {
  if (list.length <= 1) return list;
  const groups: HistoryItem[][] = [];
  for (const item of list) {
    let hit: HistoryItem[] | null = null;
    for (const g of groups) {
      if (isSameImage(g[0], item)) {
        hit = g;
        break;
      }
    }
    if (hit) hit.push(item);
    else groups.push([item]);
  }
  if (groups.every((g) => g.length === 1)) return list;
  return groups.map((g) => {
    if (g.length === 1) return g[0];
    const sorted = [...g].sort(
      (a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)
    );
    const head = sorted[0];
    const allVersions: PromptVersion[] = [];
    const seen = new Set<string>();
    for (const it of sorted) {
      for (const v of it.versions || []) {
        if (seen.has(v.id)) continue;
        seen.add(v.id);
        allVersions.push(v);
      }
    }
    const normalizedVersions = normalizePromptVersions(allVersions);
    const top = normalizedVersions[0] || head.versions?.[0];
    return normalizeHistoryItemStorageShape({
      ...head,
      prompt: top?.prompt ?? head.prompt,
      updatedAt: top?.createdAt ?? head.updatedAt,
      versions: normalizedVersions,
      pinned: sorted.some((it) => it.pinned) || undefined,
      note: sorted.map((it) => it.note).find((n) => n && n.trim()) || head.note,
    });
  });
}

let libraryReady: Promise<void> | null = null;

export function ensureLibraryReady(): Promise<void> {
  if (!libraryReady) {
    libraryReady = migrateLegacyChromeStorageIfNeeded().catch((err) => {
      libraryReady = null;
      throw err;
    });
  }
  return libraryReady;
}

async function migrateLegacyChromeStorageIfNeeded(): Promise<void> {
  const state = await chrome.storage.local.get([
    HISTORY_KEY,
    HISTORY_DEDUP_FLAG,
    HISTORY_IDB_MIGRATED_KEY,
  ]);
  if (state[HISTORY_IDB_MIGRATED_KEY]) return;

  const raw = state[HISTORY_KEY] as HistoryItem[] | undefined;
  if (!raw || !Array.isArray(raw)) {
    await chrome.storage.local.set({ [HISTORY_IDB_MIGRATED_KEY]: Date.now() });
    return;
  }

  let list = raw.map(migrateItem);
  if (!state[HISTORY_DEDUP_FLAG]) {
    list = dedupHistoryByImage(list);
    await chrome.storage.local.set({ [HISTORY_DEDUP_FLAG]: Date.now() });
  }

  await bulkPutHistoryItems(list);
  await chrome.storage.local.remove(HISTORY_KEY);
  await chrome.storage.local.set({ [HISTORY_IDB_MIGRATED_KEY]: Date.now() });
  await finalizeHistoryMutation();
}

/** versions / folders 等模块在直接 put IDB 后调用，与 history.ts 内写入保持一致。 */
export async function finalizeHistoryMutation(): Promise<void> {
  notifyBackupSubscribers();
  await bumpLibraryRev();
}

try {
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'local') return;
    if (LIBRARY_REV_KEY in changes || HISTORY_KEY in changes) {
      /* PromptLibrary / Popup 监听 library_rev 刷新列表 */
    }
  });
} catch {
  /* 测试环境 */
}

/**
 * 全量读取（尽量避免在大库上调用；备份恢复合并见 backup.ts 专用路径）。
 */
export async function getHistory(): Promise<HistoryItem[]> {
  await ensureLibraryReady();
  return exportAllHistoryPublic();
}

export async function writeHistory(list: HistoryItem[]): Promise<void> {
  await ensureLibraryReady();
  await bulkReplaceHistory(list.map(migrateItem));
  await trimOldestToMax(HISTORY_LIMIT);
  await finalizeHistoryMutation();
}

export async function addHistory(item: HistoryItem): Promise<HistoryItem> {
  await ensureLibraryReady();
  const incoming = migrateItem(item);
  const dedupeNatural = naturalDedupeKey(incoming);

  if (dedupeNatural) {
    const existingRow = await getByDedupeKey(dedupeNatural);
    if (existingRow) {
      const existing = toPublicHistory(existingRow);
      const incomingHead = incoming.versions[0];
      const newVersion: PromptVersion = {
        id: newVersionId(),
        prompt: incoming.prompt,
        versionNo: getNextPromptVersionNo(existing.versions),
        createdAt: incomingHead?.createdAt || incoming.createdAt || Date.now(),
        source: 'extracted',
        meta: {
          provider: incoming.provider,
          model: incoming.model,
          style: incoming.style,
          ...(incoming.strategy ? { strategy: incoming.strategy } : {}),
        },
      };
      const oldVersions = (existing.versions || []).map<PromptVersion>((v) =>
        v.meta
          ? v
          : {
              ...v,
              meta: metaFromHistoryItem(existing),
            }
      );
      const merged: HistoryItem = normalizeHistoryItemStorageShape({
        ...existing,
        prompt: incoming.prompt,
        provider: incoming.provider,
        model: incoming.model,
        style: incoming.style,
        imageUrl: existing.imageUrl || incoming.imageUrl,
        thumbnail: existing.thumbnail || incoming.thumbnail,
        imageUrls: incoming.imageUrls ?? existing.imageUrls,
        pageUrl: existing.pageUrl || incoming.pageUrl,
        pageTitle: existing.pageTitle || incoming.pageTitle,
        updatedAt: newVersion.createdAt,
        versions: normalizePromptVersions([newVersion, ...oldVersions]),
      });
      await putHistoryRecord(toStoredRecord(merged));
      await trimOldestToMax(HISTORY_LIMIT);
      await finalizeHistoryMutation();
      return merged;
    }
  }

  if (incoming.versions[0] && !incoming.versions[0].meta) {
    incoming.versions[0] = {
      ...incoming.versions[0],
      meta: {
        provider: incoming.provider,
        model: incoming.model,
        style: incoming.style,
        ...(incoming.strategy ? { strategy: incoming.strategy } : {}),
      },
    };
  }
  const inserted = normalizeHistoryItemStorageShape(incoming);
  await putHistoryRecord(toStoredRecord(inserted));
  await trimOldestToMax(HISTORY_LIMIT);
  await finalizeHistoryMutation();
  return inserted;
}

export async function clearHistory(): Promise<void> {
  await ensureLibraryReady();
  await clearHistoryStore();
  try {
    await chrome.storage.local.remove(HISTORY_KEY);
  } catch {
    /* ignore */
  }
  await finalizeHistoryMutation();
}

export async function removeHistory(id: string): Promise<void> {
  await ensureLibraryReady();
  await deleteHistoryRecord(id);
  await finalizeHistoryMutation();
}

export async function removeHistoryItems(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await ensureLibraryReady();
  const db = await openHistoryDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE, 'readwrite');
    const s = tx.objectStore(HISTORY_STORE);
    for (const id of ids) s.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  await finalizeHistoryMutation();
}

export async function patchHistoryItem(
  id: string,
  patch: Partial<Pick<HistoryItem, 'pinned' | 'note' | 'thumbnail' | 'pageTitle' | 'folderId'>>
): Promise<HistoryItem | null> {
  await ensureLibraryReady();
  const row = await getHistoryRecord(id);
  if (!row) return null;
  const cur = toPublicHistory(row);
  const updated: HistoryItem = { ...cur, ...patch };
  await putHistoryRecord(toStoredRecord(updated));
  await finalizeHistoryMutation();
  return updated;
}

export async function getHistoryItem(id: string): Promise<HistoryItem | null> {
  await ensureLibraryReady();
  const row = await getHistoryRecord(id);
  return row ? toPublicHistory(row) : null;
}

export function newVersionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `v_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
