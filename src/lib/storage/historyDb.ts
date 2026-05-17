/** 开发预览 iframe：`?scene=empty` 时需在本模块其他代码之前初始化库名覆盖。 */
import '../../dev/preview/previewScene';

/**
 * 提示词库主存储：IndexedDB（单条读写 + 索引），替代 chrome.storage.local 整表 JSON。
 *
 * - globalSort / folderSort / dedupe 三个唯一索引支撑排序列表、文件夹视图与同图合并。
 * - 跨 context 同步依赖 chrome.storage.local 的 {@link LIBRARY_REV_KEY} 戳（见 history.ts）。
 */
import type { HistoryItem } from '../types';

export const HISTORY_DB_NAME = 'prompt-extracto-library';
export const HISTORY_DB_VERSION = 1;
export const HISTORY_STORE = 'history_items';

/** 与 chrome.storage.local 联动，提示其它上下文失效本地分页缓存。 */
export const LIBRARY_REV_KEY = 'library_rev';

const MAX_SORT_PAD = 9007199254740991;

/** 持久化行：在 HistoryItem 上附加内部索引字段（对外返回前剥离）。 */
export type HistoryStoredRecord = HistoryItem & {
  _peDedupe: string;
  _peGlobalSort: string;
  _peFolderSort: string;
};

export function djb2Hex(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

/** 与 history.ts 原 isSameImage 语义对齐的可索引键；空串表示无法据此去重合并。 */
export function naturalDedupeKey(
  item: Pick<HistoryItem, 'imageUrl' | 'thumbnail'> & { imageUrls?: string[] }
): string {
  const urls = item.imageUrls;
  if (urls && urls.length > 1) {
    const joined = urls.join('\x01');
    if (joined.length > 8) return `m:${djb2Hex(joined)}`;
    return '';
  }
  const ua = urls?.length === 1 ? urls[0] || '' : item.imageUrl || '';
  if (ua.length > 8) return `u:${djb2Hex(ua)}`;
  const ta = item.thumbnail || '';
  if (ta.length > 64) return `t:${djb2Hex(ta)}`;
  return '';
}

export function persistedDedupeKey(item: HistoryItem): string {
  const n = naturalDedupeKey(item);
  return n || `__nid:${item.id}`;
}

function folderKeyPart(folderId: string | null | undefined): string {
  if (folderId == null || folderId === '') return '__unsorted__';
  return folderId;
}

export function sortTime(item: HistoryItem): number {
  return item.updatedAt ?? item.createdAt ?? 0;
}

function padSort(t: number): string {
  const x = Math.min(Math.max(0, t), MAX_SORT_PAD);
  return x.toString().padStart(16, '0');
}

export function computeIndexKeys(item: HistoryItem): Pick<HistoryStoredRecord, '_peDedupe' | '_peGlobalSort' | '_peFolderSort'> {
  const st = sortTime(item);
  const id = item.id;
  return {
    _peDedupe: persistedDedupeKey(item),
    _peGlobalSort: `${padSort(st)}:${id}`,
    _peFolderSort: `${folderKeyPart(item.folderId)}\x01${padSort(st)}:${id}`,
  };
}

export function toPublicHistory(row: HistoryStoredRecord): HistoryItem {
  const { _peDedupe: _d, _peGlobalSort: _g, _peFolderSort: _f, ...pub } = row;
  void _d;
  void _g;
  void _f;
  return pub;
}

export function toStoredRecord(item: HistoryItem): HistoryStoredRecord {
  const keys = computeIndexKeys(item);
  return { ...item, ...keys };
}

function effectiveHistoryDbName(): string {
  try {
    const g = globalThis as unknown as { __PE_PREVIEW_HISTORY_DB__?: string };
    if (typeof g.__PE_PREVIEW_HISTORY_DB__ === 'string' && g.__PE_PREVIEW_HISTORY_DB__.length > 0) {
      return g.__PE_PREVIEW_HISTORY_DB__;
    }
  } catch {
    /* ignore */
  }
  return HISTORY_DB_NAME;
}

function openDbRaw(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(effectiveHistoryDbName(), HISTORY_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(HISTORY_STORE)) {
        const store = db.createObjectStore(HISTORY_STORE, { keyPath: 'id' });
        store.createIndex('dedupe', '_peDedupe', { unique: true });
        store.createIndex('globalSort', '_peGlobalSort', { unique: true });
        store.createIndex('folderSort', '_peFolderSort', { unique: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function openHistoryDb(): Promise<IDBDatabase> {
  if (!dbPromise) dbPromise = openDbRaw();
  return dbPromise;
}

/** 单元测试 / 特殊场景重置内存句柄 */
export function resetHistoryDbForTests(): void {
  dbPromise = null;
}

export async function bumpLibraryRev(): Promise<void> {
  try {
    await chrome.storage.local.set({ [LIBRARY_REV_KEY]: Date.now() });
  } catch {
    /* ignore */
  }
}

export async function historyCount(): Promise<number> {
  const db = await openHistoryDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE, 'readonly');
    const req = tx.objectStore(HISTORY_STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getHistoryRecord(id: string): Promise<HistoryStoredRecord | undefined> {
  const db = await openHistoryDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE, 'readonly');
    const req = tx.objectStore(HISTORY_STORE).get(id);
    req.onsuccess = () => resolve(req.result as HistoryStoredRecord | undefined);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getByDedupeKey(naturalKey: string): Promise<HistoryStoredRecord | undefined> {
  if (!naturalKey) return undefined;
  const db = await openHistoryDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE, 'readonly');
    const idx = tx.objectStore(HISTORY_STORE).index('dedupe');
    const req = idx.get(naturalKey);
    req.onsuccess = () => resolve(req.result as HistoryStoredRecord | undefined);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

export async function putHistoryRecord(record: HistoryStoredRecord): Promise<void> {
  const db = await openHistoryDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE, 'readwrite');
    tx.objectStore(HISTORY_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function deleteHistoryRecord(id: string): Promise<void> {
  const db = await openHistoryDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE, 'readwrite');
    tx.objectStore(HISTORY_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function clearHistoryStore(): Promise<void> {
  const db = await openHistoryDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE, 'readwrite');
    tx.objectStore(HISTORY_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function bulkPutHistoryItems(items: HistoryItem[]): Promise<void> {
  if (items.length === 0) return;
  const db = await openHistoryDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE, 'readwrite');
    const store = tx.objectStore(HISTORY_STORE);
    for (const it of items) {
      store.put(toStoredRecord(it));
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** 清空后写入（备份 replace / 测试）。 */
export async function bulkReplaceHistory(items: HistoryItem[]): Promise<void> {
  await clearHistoryStore();
  await bulkPutHistoryItems(items);
}

/**
 * 按「最近优先」分页（globalSort 索引降序）。
 * @param cursorKey 上一页最后一条的 `_peGlobalSort`（页内最旧一条）；下一页从比它更旧的记录继续。
 */
export async function listHistoryGlobalDescPage(
  limit: number,
  cursorKey?: string
): Promise<{ items: HistoryItem[]; nextCursor: string | undefined }> {
  const db = await openHistoryDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE, 'readonly');
    const idx = tx.objectStore(HISTORY_STORE).index('globalSort');
    const out: HistoryItem[] = [];
    let nextCur: string | undefined;
    const range = cursorKey ? IDBKeyRange.upperBound(cursorKey, true) : null;
    const req = range ? idx.openCursor(range, 'prev') : idx.openCursor(null, 'prev');
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur || out.length >= limit) {
        resolve({ items: out, nextCursor: nextCur });
        return;
      }
      const row = cur.value as HistoryStoredRecord;
      out.push(toPublicHistory(row));
      nextCur = row._peGlobalSort;
      cur.continue();
    };
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

/** Popup：最近 N 条（全量载入内存，N 较小）。 */
export async function listRecentHistory(limit: number): Promise<HistoryItem[]> {
  const { items } = await listHistoryGlobalDescPage(limit);
  return items;
}

/** 删除最旧的多余项直至 count <= maxItems（O(excess)）。 */
export async function trimOldestToMax(maxItems: number): Promise<number> {
  const cnt = await historyCount();
  if (cnt <= maxItems) return 0;
  let excess = cnt - maxItems;
  const db = await openHistoryDb();
  let deleted = 0;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE, 'readwrite');
    const idx = tx.objectStore(HISTORY_STORE).index('globalSort');
    const req = idx.openCursor(null, 'next');
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur || excess <= 0) {
        return;
      }
      cur.delete();
      deleted++;
      excess--;
      cur.continue();
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => resolve(deleted);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function forEachHistoryRecord(
  direction: IDBCursorDirection,
  fn: (row: HistoryStoredRecord) => void | Promise<void>
): Promise<void> {
  const db = await openHistoryDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE, 'readonly');
    const idx = tx.objectStore(HISTORY_STORE).index('globalSort');
    const req = idx.openCursor(null, direction);
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) {
        resolve();
        return;
      }
      const row = cur.value as HistoryStoredRecord;
      Promise.resolve(fn(row))
        .then(() => {
          cur.continue();
        })
        .catch(reject);
    };
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

export interface HistoryLibraryStats {
  total: number;
  unsorted: number;
  pinned: number;
  byFolderId: Map<string, number>;
  providers: string[];
  styles: string[];
}

export async function scanHistoryLibraryStats(): Promise<HistoryLibraryStats> {
  const byFolderId = new Map<string, number>();
  const prov = new Set<string>();
  const sty = new Set<string>();
  let total = 0;
  let unsorted = 0;
  let pinned = 0;

  await forEachHistoryRecord('prev', (row) => {
    const item = toPublicHistory(row);
    total++;
    if (!item.folderId) unsorted++;
    if (item.pinned) pinned++;
    const fid = item.folderId;
    if (fid) byFolderId.set(fid, (byFolderId.get(fid) || 0) + 1);
    prov.add(item.provider);
    sty.add(item.style);
  });

  return {
    total,
    unsorted,
    pinned,
    byFolderId,
    providers: Array.from(prov).sort(),
    styles: Array.from(sty).sort(),
  };
}

/** 全表扫描为 HistoryItem[]（仅备份 / 合并等运维路径使用）。 */
export async function exportAllHistoryPublic(): Promise<HistoryItem[]> {
  const acc: HistoryItem[] = [];
  await forEachHistoryRecord('prev', (row) => {
    acc.push(toPublicHistory(row));
  });
  return acc;
}
