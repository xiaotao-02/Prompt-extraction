/**
 * 「提示词库」的项目 / 文件夹（{@link LibraryFolder}）数据层。
 *
 * 设计要点：
 * - 顶层节点（`parentId === null`）视为「项目」，其下可以无限嵌套子文件夹。
 *   UI 仅做视觉区分，数据结构上统一为 `LibraryFolder`，避免两套 CRUD。
 * - 与 history 一样使用「内存缓存 + storage.onChanged 跨 context 同步」的模式，
 *   保证 popup / options / background 三端读写一致；写入完成后通过
 *   `notifyBackupSubscribers` 通知 fsBackup 同步全量备份。
 * - 删除文件夹时**不孤儿化**任何子文件夹或记录：子文件夹自动上移到被删节点的
 *   `parentId`；HistoryItem 的 `folderId` 在 history 层重置为 `null`（未分类）。
 */
import type { HistoryItem, LibraryFolder } from '../types';
import { notifyBackupSubscribers } from './events';
import { getHistory, writeHistory } from './history';

const FOLDERS_KEY = 'library_folders_v1';

export let foldersCache: LibraryFolder[] | null = null;

function syncFoldersCacheFromExternal(rawNew: unknown): void {
  if (!Array.isArray(rawNew)) {
    foldersCache = null;
    return;
  }
  try {
    foldersCache = (rawNew as LibraryFolder[]).map(normalizeFolder);
  } catch {
    foldersCache = null;
  }
}

try {
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'local') return;
    if (FOLDERS_KEY in changes) {
      syncFoldersCacheFromExternal(changes[FOLDERS_KEY].newValue);
    }
  });
} catch {
  /* 测试环境 / 无 chrome.storage 时静默 */
}

function normalizeFolder(raw: LibraryFolder): LibraryFolder {
  return {
    id: raw.id,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : '未命名',
    parentId: raw.parentId ?? null,
    createdAt: raw.createdAt || Date.now(),
    updatedAt: raw.updatedAt,
    sortKey: typeof raw.sortKey === 'number' ? raw.sortKey : undefined,
    color: typeof raw.color === 'string' ? raw.color : undefined,
  };
}

export async function getFolders(): Promise<LibraryFolder[]> {
  if (!foldersCache) {
    const data = await chrome.storage.local.get(FOLDERS_KEY);
    const raw = (data[FOLDERS_KEY] as LibraryFolder[]) || [];
    foldersCache = raw.map(normalizeFolder);
  }
  return foldersCache.slice();
}

export async function writeFolders(list: LibraryFolder[]): Promise<void> {
  foldersCache = list;
  await chrome.storage.local.set({ [FOLDERS_KEY]: list });
  notifyBackupSubscribers();
}

function newFolderId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `f_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function nextSortKey(list: LibraryFolder[], parentId: string | null): number {
  let max = 0;
  for (const f of list) {
    if ((f.parentId ?? null) === parentId && (f.sortKey ?? 0) > max) {
      max = f.sortKey ?? 0;
    }
  }
  return max + 1;
}

export interface CreateFolderInput {
  name: string;
  parentId?: string | null;
  color?: string;
}

export async function createFolder(input: CreateFolderInput): Promise<LibraryFolder> {
  const list = await getFolders();
  const folder: LibraryFolder = {
    id: newFolderId(),
    name: input.name.trim() || '未命名',
    parentId: input.parentId ?? null,
    createdAt: Date.now(),
    sortKey: nextSortKey(list, input.parentId ?? null),
    color: input.color,
  };
  await writeFolders([...list, folder]);
  return folder;
}

export async function renameFolder(id: string, name: string): Promise<LibraryFolder | null> {
  const list = await getFolders();
  const idx = list.findIndex((f) => f.id === id);
  if (idx < 0) return null;
  const next: LibraryFolder = {
    ...list[idx],
    name: name.trim() || list[idx].name,
    updatedAt: Date.now(),
  };
  list[idx] = next;
  await writeFolders(list);
  return next;
}

export async function patchFolder(
  id: string,
  patch: Partial<Pick<LibraryFolder, 'color' | 'parentId' | 'sortKey'>>
): Promise<LibraryFolder | null> {
  const list = await getFolders();
  const idx = list.findIndex((f) => f.id === id);
  if (idx < 0) return null;
  // 防御：禁止把节点移到自己的子树下，避免成环
  if (patch.parentId !== undefined && patch.parentId !== null) {
    if (isDescendantOrSelf(list, patch.parentId, id)) {
      throw new Error('不能把文件夹移动到自己或自己的子文件夹下');
    }
  }
  const next: LibraryFolder = { ...list[idx], ...patch, updatedAt: Date.now() };
  list[idx] = next;
  await writeFolders(list);
  return next;
}

/**
 * 删除文件夹。**不孤儿化**：
 * - 子文件夹自动上移到被删节点的 `parentId`（顶层时即变成新项目）。
 * - 该文件夹下的 HistoryItem.folderId 重置为 null（变为「未分类」）。
 *
 * 如果调用方希望「连同子文件夹与记录一起删」，可设置 `cascade=true`，此时
 * 会递归收集所有后代文件夹一并删除，记录的 folderId 同样被清空（记录本身不删）。
 */
export async function removeFolder(
  id: string,
  options: { cascade?: boolean } = {}
): Promise<void> {
  const list = await getFolders();
  const target = list.find((f) => f.id === id);
  if (!target) return;

  const toRemove = new Set<string>([id]);
  if (options.cascade) {
    collectDescendants(list, id, toRemove);
  }

  const remaining: LibraryFolder[] = [];
  for (const f of list) {
    if (toRemove.has(f.id)) continue;
    if (!options.cascade && f.parentId === id) {
      remaining.push({ ...f, parentId: target.parentId, updatedAt: Date.now() });
    } else {
      remaining.push(f);
    }
  }
  await writeFolders(remaining);

  // 释放归属：该文件夹（cascade 时为整棵子树）下的 HistoryItem.folderId 全部清空
  await detachHistoryFromFolders(toRemove);
}

function collectDescendants(
  list: LibraryFolder[],
  rootId: string,
  acc: Set<string>
): void {
  for (const f of list) {
    if (f.parentId === rootId && !acc.has(f.id)) {
      acc.add(f.id);
      collectDescendants(list, f.id, acc);
    }
  }
}

function isDescendantOrSelf(
  list: LibraryFolder[],
  candidateId: string,
  rootId: string
): boolean {
  if (candidateId === rootId) return true;
  // 沿 parentId 链向上回溯，看是否会经过 rootId
  let cur: string | null | undefined = candidateId;
  const guard = new Set<string>();
  while (cur) {
    if (guard.has(cur)) return false;
    guard.add(cur);
    if (cur === rootId) return true;
    const node = list.find((f) => f.id === cur);
    cur = node?.parentId ?? null;
  }
  return false;
}

async function detachHistoryFromFolders(folderIds: Set<string>): Promise<void> {
  if (folderIds.size === 0) return;
  const history = await getHistory();
  let touched = false;
  const next: HistoryItem[] = history.map((item) => {
    if (item.folderId && folderIds.has(item.folderId)) {
      touched = true;
      return { ...item, folderId: null };
    }
    return item;
  });
  if (touched) await writeHistory(next);
}

/** 把若干条历史记录移动到目标文件夹（`null` = 未分类）。 */
export async function moveHistoryItemsToFolder(
  ids: string[],
  folderId: string | null
): Promise<number> {
  if (ids.length === 0) return 0;
  const set = new Set(ids);
  const list = await getHistory();
  let touched = 0;
  const next: HistoryItem[] = list.map((item) => {
    if (!set.has(item.id)) return item;
    const cur = item.folderId ?? null;
    const target = folderId ?? null;
    if (cur === target) return item;
    touched++;
    return { ...item, folderId: target };
  });
  if (touched > 0) await writeHistory(next);
  return touched;
}

/** 替换全部 folders（用于备份恢复 replace 模式）。 */
export async function replaceFolders(list: LibraryFolder[]): Promise<void> {
  await writeFolders(list.map(normalizeFolder));
}

/** 合并 folders（用于备份恢复 merge 模式，按 id 去重，已存在保留较新者）。 */
export async function mergeFolders(incoming: LibraryFolder[]): Promise<void> {
  if (!Array.isArray(incoming) || incoming.length === 0) return;
  const cur = await getFolders();
  const byId = new Map(cur.map((f) => [f.id, f] as const));
  for (const raw of incoming) {
    const f = normalizeFolder(raw);
    const exist = byId.get(f.id);
    if (!exist) {
      byId.set(f.id, f);
    } else {
      const newer = (f.updatedAt || f.createdAt || 0) >= (exist.updatedAt || exist.createdAt || 0) ? f : exist;
      byId.set(f.id, newer);
    }
  }
  await writeFolders(Array.from(byId.values()));
}
