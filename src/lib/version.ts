/**
 * 简易语义化版本对比（major.minor.patch[-prerelease]）。
 * - 解析失败时返回 0（视为相等），避免错误地触发更新提示。
 */
export type ParsedVersion = {
  major: number;
  minor: number;
  patch: number;
  pre: string;
};

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:[-+]([0-9A-Za-z.-]+))?$/;

export function parseVersion(input: string): ParsedVersion | null {
  if (!input) return null;
  const trimmed = String(input).trim().replace(/^v/i, '');
  const m = trimmed.match(VERSION_RE);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre: m[4] || '',
  };
}

export function compareVersion(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;
  // 有 prerelease 标记的版本视为低于稳定版（符合 SemVer）
  if (pa.pre && !pb.pre) return -1;
  if (!pa.pre && pb.pre) return 1;
  if (pa.pre && pb.pre) return pa.pre < pb.pre ? -1 : pa.pre > pb.pre ? 1 : 0;
  return 0;
}

export function isNewerVersion(latest: string, current: string): boolean {
  return compareVersion(latest, current) > 0;
}

export function formatVersion(v: string): string {
  const p = parseVersion(v);
  if (!p) return v;
  return `${p.major}.${p.minor}.${p.patch}${p.pre ? '-' + p.pre : ''}`;
}
