/**
 * 根据"按时间倒序排列的 versions 数组"中某一项的位置，
 * 计算出展示给用户的"时间序号标签"。
 *
 * 约定：
 * - `versions[0]` 是最新（=当前编辑器/记录使用的那一条）
 * - `versions[total - 1]` 是最早创建的那一条
 *
 * 标签规则（与用户原话一致："初始 / 版本1 / 版本2 / 当前"）：
 * - 只有 1 条版本时：始终显示"当前"（避免一条记录上同时挂"初始"和"当前"）
 * - 最新一条（i === 0）：显示"当前"
 * - 最早一条（升序 ord === 0）：显示"初始"
 * - 中间的：显示 `版本N`，N 从 1 开始顺序递增（最早的非初始版本是"版本1"）
 *
 * 这个标签是按"创建时间顺序"的，与 `PromptVersionSource`（extracted/edited/refined/restored）正交：
 * 序号标签回答"这是第几个版本"，来源标签回答"这版是怎么来的"。
 */
export type VersionOrdinalKind = 'current' | 'initial' | 'middle';

export interface VersionOrdinalLabel {
  label: string;
  kind: VersionOrdinalKind;
}

export function getVersionOrdinalLabel(
  total: number,
  indexFromNewest: number
): VersionOrdinalLabel {
  if (total <= 1 || indexFromNewest === 0) {
    return { label: '当前', kind: 'current' };
  }
  const ord = total - 1 - indexFromNewest;
  if (ord === 0) {
    return { label: '初始', kind: 'initial' };
  }
  return { label: `版本${ord}`, kind: 'middle' };
}
