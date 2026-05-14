import type { HistoryItem, PromptVersion } from '../types';

function versionTime(version: PromptVersion): number {
  return Number.isFinite(version.createdAt) ? version.createdAt : 0;
}

export function promptVersionNo(version: PromptVersion): number {
  return Number.isFinite(version.versionNo) && version.versionNo! >= 0
    ? Math.trunc(version.versionNo!)
    : 0;
}

function hasUsableVersionNo(version: PromptVersion): boolean {
  return Number.isFinite(version.versionNo) && version.versionNo! >= 0;
}

function withVersionNumbers(versions: PromptVersion[]): PromptVersion[] {
  const seen = new Set<number>();
  let hasMissing = false;
  let hasDuplicate = false;
  versions.forEach((version) => {
    if (!hasUsableVersionNo(version)) {
      hasMissing = true;
      return;
    }
    const no = promptVersionNo(version);
    if (seen.has(no)) {
      hasDuplicate = true;
      return;
    }
    seen.add(no);
  });

  if (!hasMissing && !hasDuplicate) {
    return versions.map((version) => ({
      ...version,
      versionNo: promptVersionNo(version),
    }));
  }

  if (hasMissing && !hasDuplicate) {
    const used = new Set(seen);
    let nextNo = 0;
    const assigned = new Map<number, number>();
    versions
      .map((version, index) => ({ version, index }))
      .filter(({ version }) => !hasUsableVersionNo(version))
      .sort((a, b) => {
        const byTime = versionTime(a.version) - versionTime(b.version);
        if (byTime !== 0) return byTime;
        return a.index - b.index;
      })
      .forEach(({ index }) => {
        while (used.has(nextNo)) nextNo += 1;
        assigned.set(index, nextNo);
        used.add(nextNo);
      });

    return versions.map((version, index) => ({
      ...version,
      versionNo: hasUsableVersionNo(version)
        ? promptVersionNo(version)
        : assigned.get(index) ?? 0,
    }));
  }

  return versions
    .map((version, index) => ({ version, index }))
    .sort((a, b) => {
      const aHasNo = hasUsableVersionNo(a.version);
      const bHasNo = hasUsableVersionNo(b.version);
      if (aHasNo && bHasNo) {
        const byNo = promptVersionNo(a.version) - promptVersionNo(b.version);
        if (byNo !== 0) return byNo;
      }
      const byTime = versionTime(a.version) - versionTime(b.version);
      if (byTime !== 0) return byTime;
      return a.index - b.index;
    })
    .map(({ version }, versionNo) => ({
      ...version,
      versionNo,
    }));
}

/**
 * 版本链的规范形态：按 id 去重，并按 versionNo 倒序排列。
 * 存储层约定 `versions[0]` 就是当前版本；createdAt 只作为同号冲突兜底和展示字段。
 */
export function normalizePromptVersions(versions: PromptVersion[] | undefined): PromptVersion[] {
  if (!Array.isArray(versions) || versions.length === 0) return [];

  const seenIds = new Set<string>();
  const uniqueById: PromptVersion[] = [];
  for (const version of versions) {
    if (!version) continue;
    if (version.id && seenIds.has(version.id)) continue;
    if (version.id) seenIds.add(version.id);
    uniqueById.push(version);
  }

  const numbered = withVersionNumbers(uniqueById);
  const normalized: PromptVersion[] = [];

  for (const version of numbered.sort((a, b) => {
    const byVersionNo = promptVersionNo(b) - promptVersionNo(a);
    if (byVersionNo !== 0) return byVersionNo;
    return versionTime(b) - versionTime(a);
  })) {
    normalized.push(version);
  }

  return normalized;
}

export function getNextPromptVersionNo(versions: PromptVersion[] | undefined): number {
  const normalized = normalizePromptVersions(versions);
  const max = normalized.reduce((acc, version) => Math.max(acc, promptVersionNo(version)), -1);
  return max + 1;
}

export function metaFromHistoryItem(item: HistoryItem): PromptVersion['meta'] {
  return {
    provider: item.provider,
    model: item.model,
    style: item.style,
    ...(item.strategy ? { strategy: item.strategy } : {}),
  };
}

export function metaForVersion(
  version: PromptVersion,
  fallback: HistoryItem
): PromptVersion['meta'] {
  return version.meta ?? metaFromHistoryItem(fallback);
}

/**
 * 用当前版本回写 HistoryItem 顶层镜像字段，保证列表卡片、复制按钮和版本侧栏一致。
 */
export function mirrorCurrentVersion(item: HistoryItem): HistoryItem {
  const versions = normalizePromptVersions(item.versions);
  const current = versions[0];
  if (!current) return { ...item, versions };

  return {
    ...item,
    prompt: current.prompt,
    updatedAt: Math.max(current.createdAt || 0, item.updatedAt || 0, item.createdAt || 0),
    ...(current.meta
      ? {
          provider: current.meta.provider,
          model: current.meta.model,
          style: current.meta.style,
          ...(current.meta.strategy ? { strategy: current.meta.strategy } : {}),
        }
      : {}),
    versions,
  };
}
