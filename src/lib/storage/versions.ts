/**
 * 历史记录里"版本（PromptVersion）"层级的写操作。
 * 这些操作改的是单条 HistoryItem 里的 versions 数组与 prompt 字段。
 */
import type { HistoryItem, PromptVersion, PromptVersionSource } from '../types';
import { getHistory, writeHistory, newVersionId } from './history';

function moveUpdatedItemToFront(
  list: HistoryItem[],
  idx: number,
  updated: HistoryItem
): HistoryItem[] {
  const next = list.slice();
  next.splice(idx, 1);
  next.unshift(updated);
  return next;
}

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
    meta,
  };
  const updated: HistoryItem = {
    ...item,
    prompt: trimmed,
    updatedAt: version.createdAt,
    ...(meta
      ? { provider: meta.provider, model: meta.model, style: meta.style }
      : {}),
    versions: [version, ...(item.versions || [])],
  };
  await writeHistory(moveUpdatedItemToFront(list, idx, updated));
  return updated;
}

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
  await writeHistory(moveUpdatedItemToFront(list, idx, updated));
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
  const list = await getHistory();
  const idx = list.findIndex((i) => i.id === itemId);
  if (idx < 0) return null;
  const item = list[idx];
  if (!item.versions || item.versions.length <= 1) return item;
  const next = item.versions.filter((v) => v.id !== versionId);
  if (next.length === item.versions.length) return item;
  const wasCurrent = item.versions[0]?.id === versionId;
  const updated: HistoryItem = wasCurrent
    ? {
        ...item,
        prompt: next[0].prompt,
        updatedAt: next[0].createdAt,
        ...(next[0].meta
          ? {
              provider: next[0].meta.provider,
              model: next[0].meta.model,
              style: next[0].meta.style,
            }
          : {}),
        versions: next,
      }
    : { ...item, versions: next };
  list[idx] = updated;
  await writeHistory(list);
  return updated;
}
