import { describe, expect, it } from 'vitest';
import { normalizeName, Places } from '../src/geo/places.js';

const places = Places.load();

describe('reverse geocoding', () => {
  it.each([
    ['Tokyo Tower', 35.6586, 139.7454, 'Tokyo', 'Japan'],
    ['Shibuya crossing', 35.6595, 139.7005, 'Tokyo', 'Japan'],
    ['Osaka Castle', 34.6873, 135.5262, 'Osaka', 'Japan'],
    ['Kinkaku-ji, Kyoto', 35.0394, 135.7292, 'Kyoto', 'Japan'],
    ['Yokohama (its own city)', 35.4437, 139.638, 'Yokohama', 'Japan'],
    ['Eiffel Tower', 48.8584, 2.2945, 'Paris', 'France'],
    ['Belém Tower, Lisbon', 38.6916, -9.216, 'Lisbon', 'Portugal'],
    ['Big Ben', 51.5007, -0.1246, 'London', 'United Kingdom'],
    ['Times Square', 40.758, -73.9855, 'New York City', 'United States'],
    ['Sydney Opera House', -33.8568, 151.2153, 'Sydney', 'Australia'],
  ])('%s → %s, %s', (_, lat, lon, city, country) => {
    expect(places.lookup(lat, lon)).toEqual({ city, country });
  });

  it('names small towns and villages', () => {
    expect(places.lookup(40.6281, 14.4849)).toEqual({ city: 'Positano', country: 'Italy' });
    expect(places.lookup(51.0, -0.8)).toMatchObject({ country: 'United Kingdom', city: expect.any(String) });
    // Hallstatt (~800 people) is below the cut-off: the next village along is used
    expect(places.lookup(47.5622, 13.6493)).toMatchObject({ city: expect.stringMatching(/Goisern|Obertraun|Hallstatt/), country: 'Austria' });
  });

  it('prefers the city over a neighbouring suburb near its edge', () => {
    expect(places.lookup(38.6916, -9.216).city).toBe('Lisbon'); // Belém Tower, next to Algés
  });

  it('gives just the country far from any town', () => {
    expect(places.lookup(23.0, 10.0)).toEqual({ city: null, country: 'Algeria' }); // Sahara
    expect(places.lookup(-82, 0).city).toBeNull(); // Antarctica
  });

  it('gives nothing in mid-ocean', () => {
    expect(places.lookup(30, -40)).toEqual({ city: null, country: null });
  });

  it('works across the antimeridian', () => {
    expect(places.lookup(-18.1416, 178.4419)).toEqual({ city: 'Suva', country: 'Fiji' });
  });
});

describe('search by name', () => {
  const names = (q: string) => places.search(q).map((p) => `${p.name}, ${p.country}`);

  it('suggests the big towns first as you type', () => {
    expect(names('osa')[0]).toBe('Osaka, Japan');
    expect(names('tok')[0]).toBe('Tokyo, Japan');
    expect(names('lis')[0]).toBe('Lisbon, Portugal');
    expect(names('Paris')[0]).toBe('Paris, France');
  });

  it('matches words inside names and ignores accents and case', () => {
    expect(names('york')).toContain('New York City, United States');
    expect(names('krakow')[0]).toBe('Kraków, Poland');
    expect(names('SÃO PAULO'.replace('Ã', 'A'))[0]).toBe('São Paulo, Brazil');
  });

  it('narrows by country after a comma', () => {
    const results = names('paris, united st');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.endsWith('United States'))).toBe(true);
    expect(names('cambridge, us')[0]).toMatch(/United States$/);
  });

  it('returns coordinates, at most 8, without duplicates', () => {
    const results = places.search('san');
    expect(results.length).toBe(8);
    expect(new Set(results.map((r) => `${r.name}|${r.country}`)).size).toBe(8);
    const osaka = places.search('osaka')[0]!;
    expect(osaka.lat).toBeCloseTo(34.69, 1);
    expect(osaka.lon).toBeCloseTo(135.5, 1);
  });

  it('copes with empty and nonsense queries', () => {
    expect(places.search('   ')).toEqual([]);
    expect(places.search('zzzzqqqq')).toEqual([]);
    expect(normalizeName('  Saint-Étienne ')).toBe('saint etienne');
  });
});
