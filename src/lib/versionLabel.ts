/**
 * 根据持久化 versionNo 计算展示给用户的版本序号标签。
 *
 * 约定：
 * - 当前版本由调用方显式传入，通常是 `versions[0]`
 * - `versionNo === 0` 是初始版本
 *
 * 标签规则（与用户原话一致："初始 / 版本1 / 版本2 / 当前"）：
 * - 当前版本：显示"当前"
 * - `versionNo === 0`：显示"初始"
 * - 其他版本：显示 `版本N`
 *
 * 这个标签与 `PromptVersionSource`（extracted/edited/refined/restored）正交：
 * 序号标签回答"这是第几个版本"，来源标签回答"这版是怎么来的"。
 */
export type VersionOrdinalKind = 'current' | 'initial' | 'middle';

export interface VersionOrdinalLabel {
  label: string;
  kind: VersionOrdinalKind;
}

export function getVersionOrdinalLabel(
  versionNo: number | undefined,
  isCurrent: boolean
): VersionOrdinalLabel {
  if (isCurrent) {
    return { label: '当前', kind: 'current' };
  }
  const ord = Number.isFinite(versionNo) && versionNo! >= 0 ? Math.trunc(versionNo!) : 0;
  if (ord === 0) {
    return { label: '初始', kind: 'initial' };
  }
  return { label: `版本${ord}`, kind: 'middle' };
}
