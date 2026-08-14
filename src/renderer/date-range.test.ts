import { describe, expect, it } from 'vitest';
import { formatDuration, localDayRange } from './date-range';

describe('date utilities', () => {
  it('creates a one-day UTC range from a local date', () => {
    const range = localDayRange('2026-08-14');
    expect(new Date(range.toUtc).getTime() - new Date(range.fromUtc).getTime()).toBe(86_400_000);
  });

  it('formats human-readable durations', () => {
    expect(formatDuration(3720)).toBe('1 giờ 2 phút');
    expect(formatDuration(120)).toBe('2 phút');
  });
});
