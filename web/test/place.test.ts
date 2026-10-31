import { describe, expect, it } from 'vitest';
import { placeName } from '../src/ui/place';

const at = (city: string | null, country: string | null) => ({ place: { city, country } });

describe('placeName', () => {
  it('names one town with its country, or just the town on the map', () => {
    const items = [at('Osaka', 'Japan'), at('Osaka', 'Japan')];
    expect(placeName(items)).toBe('Osaka, Japan');
    expect(placeName(items, 'short')).toBe('Osaka');
  });

  it('lists two towns, most photographed first', () => {
    const items = [at('Osaka', 'Japan'), at('Tokyo', 'Japan'), at('Tokyo', 'Japan')];
    expect(placeName(items)).toBe('Tokyo & Osaka, Japan');
    expect(placeName(items, 'short')).toBe('Tokyo & Osaka');
  });

  it('lists three towns in full, and summarises more', () => {
    expect(placeName(['Tokyo', 'Tokyo', 'Osaka', 'Kyoto'].map((c) => at(c, 'Japan')))).toBe('Tokyo, Kyoto & Osaka, Japan');
    const items = ['Tokyo', 'Tokyo', 'Osaka', 'Kyoto', 'Nara'].map((c) => at(c, 'Japan'));
    expect(placeName(items)).toBe('Tokyo, Kyoto & 2 more, Japan');
  });

  it('falls back to countries', () => {
    expect(placeName([at(null, 'Algeria')])).toBe('Algeria');
    expect(placeName([at('Lisbon', 'Portugal'), at('Vigo', 'Spain')])).toBe('Portugal & Spain');
    expect(placeName([at('A', 'Portugal'), at('B', 'Spain'), at('C', 'France')])).toBe('3 countries');
  });

  it('is empty when nothing is known', () => {
    expect(placeName([{ place: null }, at(null, null)])).toBe('');
  });
});
