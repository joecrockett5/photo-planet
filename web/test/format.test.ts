import { describe, expect, it } from 'vitest';
import type { MediaItem } from '../src/api';
import { byUploadNewest, formatUploadDay, uploadDayKey } from '../src/format';

const item = (uploadedAt: string, name = 'x') => ({ uploadedAt, name }) as MediaItem;

describe('upload days (feed)', () => {
  it('uses the local calendar day of the upload', () => {
    const d = new Date(2026, 10, 5, 23, 30); // 5 Nov 2026, 23:30 local
    expect(uploadDayKey(item(d.toISOString()))).toBe('2026-11-05');
    expect(uploadDayKey(item('not a date'))).toBe('');
  });

  it('says Today and Yesterday, then dates', () => {
    const now = new Date(2026, 10, 6, 9, 0);
    expect(formatUploadDay('2026-11-06', now)).toBe('Today');
    expect(formatUploadDay('2026-11-05', now)).toBe('Yesterday');
    expect(formatUploadDay('2026-11-04', now)).toBe('4 Nov 2026');
    expect(formatUploadDay('', now)).toBe('Some time ago');
  });

  it('works across month and year boundaries', () => {
    expect(formatUploadDay('2025-12-31', new Date(2026, 0, 1, 8))).toBe('Yesterday');
  });

  it('sorts newest upload first', () => {
    const list = [item('2026-11-01T10:00:00Z', 'a'), item('2026-11-05T10:00:00Z', 'b'), item('2026-11-03T10:00:00Z', 'c')];
    expect(list.sort(byUploadNewest).map((i) => i.name)).toEqual(['b', 'c', 'a']);
  });
});
