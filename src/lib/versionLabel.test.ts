import { describe, it, expect } from 'vitest';
import { getVersionOrdinalLabel } from '@/lib/versionLabel';

describe('getVersionOrdinalLabel', () => {
  it('marks current version', () => {
    expect(getVersionOrdinalLabel(0, true)).toEqual({ label: '当前', kind: 'current' });
    expect(getVersionOrdinalLabel(99, true)).toEqual({ label: '当前', kind: 'current' });
  });

  it('versionNo 0 when not current is 初始', () => {
    expect(getVersionOrdinalLabel(0, false)).toEqual({ label: '初始', kind: 'initial' });
  });

  it('positive versionNo when not current is 版本N', () => {
    expect(getVersionOrdinalLabel(2, false)).toEqual({ label: '版本2', kind: 'middle' });
  });
});
