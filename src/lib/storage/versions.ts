/**
 * 历史记录里"版本（PromptVersion）"层级的写操作。
 * 这些操作改的是单条 HistoryItem 里的 versions 数组与 prompt 字段。
 */
import type { HistoryItem, PromptVersion, PromptVersionSource } from '../types';
import {
  finalizeHistoryMutation,
  ensureLibraryReady,
  newVersionId,
} from './history';
import {
  getHistoryRecord,
  putHistoryRecord,
  toPublicHistory,
  toStoredRecord,
} from './historyDb';
import {
  getNextPromptVersionNo,
  mirrorCurrentVersion,
  normalizePromptVersions,
} from './versionState';

/**
 * 在 id 对应的历史项上追加一条新版本，并把当前 prompt 切到新版本。
 * 若新内容与当前内容完全一致，则不创建新版本，直接返回原项。
 */
export async function appendPromptVersion(
  id: string,
  prompt: string,
  source: PromptVersionSource = 'edited',
  note?: string,
  meta?: PromptVersion['meta']
): Promise<HistoryItem | null> {
  await ensureLibraryReady();
  const row = await getHistoryRecord(id);
  if (!row) return null;
  const item = mirrorCurrentVersion(toPublicHistory(row));
  const trimmed = prompt.replace(/\s+$/g, '');
  if (trimmed === item.prompt.replace(/\s+$/g, '')) return item;
  const version: PromptVersion = {
    id: newVersionId(),
    prompt: trimmed,
    versionNo: getNextPromptVersionNo(item.versions),
    createdAt: Date.now(),
    source,
    note,
    meta,
  };
  const updated: HistoryItem = mirrorCurrentVersion({
    ...item,
    prompt: trimmed,
    updatedAt: version.createdAt,
    ...(meta
      ? {
          provider: meta.provider,
          model: meta.model,
          style: meta.style,
          ...(meta.strategy ? { strategy: meta.strategy } : {}),
        }
      : {}),
    versions: normalizePromptVersions([version, ...(item.versions || [])]),
  });
  await putHistoryRecord(toStoredRecord(updated));
  await finalizeHistoryMutation();
  return updated;
}

export async function restorePromptVersion(
  id: string,
  versionId: string
): Promise<HistoryItem | null> {
  await ensureLibraryReady();
  const row = await getHistoryRecord(id);
  if (!row) return null;
  const item = mirrorCurrentVersion(toPublicHistory(row));
  const target = item.versions.find((v) => v.id === versionId);
  if (!target) return null;
  if (item.versions[0]?.id === versionId) return item;
  const restoredAt = Date.now();
  const nextVersionNo = getNextPromptVersionNo(item.versions);
  const updated: HistoryItem = mirrorCurrentVersion({
    ...item,
    prompt: target.prompt,
    updatedAt: restoredAt,
    versions: normalizePromptVersions(
      item.versions.map((version) =>
        version.id === versionId
          ? {
              ...version,
              versionNo: nextVersionNo,
            }
          : version
      )
    ),
  });
  await putHistoryRecord(toStoredRecord(updated));
  await finalizeHistoryMutation();
  return updated;
}

/**
 * 删除某条记录中的某个历史版本。
 * - 允许删除"当前版本"（即 `versions[0]`）：删除后由下一条版本（原 `versions[1]`）
 *   接替为新的当前版本，并把它的 `prompt` / `createdAt` / `meta` 同步镜像到
 *   `HistoryItem` 顶层的 `prompt` / `updatedAt` / `provider` / `model` / `style`，
 *   保证列表卡片、复制按钮等地方看到的内容始终与"当前版本"一致。
 * - 不允许删到 0 条版本：至少保留 1 条。
 */
export async function removePromptVersion(
  itemId: string,
  versionId: string
): Promise<HistoryItem | null> {
  await ensureLibraryReady();
  const row = await getHistoryRecord(itemId);
  if (!row) return null;
  const item = toPublicHistory(row);
  if (!item.versions || item.versions.length <= 1) return item;
  const next = item.versions.filter((v) => v.id !== versionId);
  if (next.length === item.versions.length) return item;
  const wasCurrent = item.versions[0]?.id === versionId;
  const updated: HistoryItem = wasCurrent
    ? mirrorCurrentVersion({ ...item, versions: next })
    : { ...item, versions: normalizePromptVersions(next) };
  await putHistoryRecord(toStoredRecord(updated));
  await finalizeHistoryMutation();
  return updated;
}
