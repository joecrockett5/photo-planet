import { describe, expect, it } from 'vitest';
import { readReduceMotion } from '../src/motion';

describe('reduce motion setting', () => {
  it('is on unless someone switched it off', () => {
    expect(readReduceMotion(null)).toBe(true); // first visit
    expect(readReduceMotion('on')).toBe(true);
    expect(readReduceMotion('off')).toBe(false);
    expect(readReduceMotion('garbage')).toBe(true);
  });
});
