import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatTime } from './time';

describe('formatTime', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows 刚刚 for under one minute', () => {
    const now = 1_700_000_000_000;
    vi.useFakeTimers({ now });
    expect(formatTime(now - 30_000)).toBe('刚刚');
  });

  it('shows minutes ago', () => {
    const now = 1_700_000_000_000;
    vi.useFakeTimers({ now });
    expect(formatTime(now - 5 * 60_000)).toBe('5 分钟前');
  });

  it('shows hours ago', () => {
    const now = 1_700_000_000_000;
    vi.useFakeTimers({ now });
    expect(formatTime(now - 3 * 3_600_000)).toBe('3 小时前');
  });

  it('falls back to calendar string for older timestamps', () => {
    vi.useFakeTimers({ now: new Date('2026-06-01T15:30:00').getTime() });
    const t = new Date('2026-05-01T10:05:00').getTime();
    expect(formatTime(t)).toBe('5/1 10:05');
  });
});
