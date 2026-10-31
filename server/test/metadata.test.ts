import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseIso6709 } from '../src/media/iso6709.js';
import { extractMetadata, metadataFromProbe, parseExifDate } from '../src/media/metadata.js';

const fixture = (name: string) => path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', name);

describe('photo metadata (fixtures)', () => {
  it.each([
    ['photo-lisbon.jpg', 38.7223, -9.1393, '2023-06-14T18:32:05+01:00'],
    ['photo-sydney.png', -33.8568, 151.2153, '2019-12-31T23:59:58'],
    ['photo-rio.webp', -22.9519, -43.2105, '2020-02-22T09:15:00'],
    ['photo-tokyo.heic', 35.6586, 139.7454, '2024-04-01T12:00:30+09:00'],
  ])('%s → %f, %f at %s', async (file, lat, lon, takenAt) => {
    const meta = await extractMetadata(fixture(file), 'photo');
    expect(meta.lat).toBeCloseTo(lat, 4);
    expect(meta.lon).toBeCloseTo(lon, 4);
    expect(meta.takenAt).toBe(takenAt);
  });

  it('leaves location empty when there is no GPS', async () => {
    const meta = await extractMetadata(fixture('photo-no-gps.jpg'), 'photo');
    expect(meta).toMatchObject({ lat: null, lon: null, takenAt: '2018-08-08T08:08:08' });
  });

  it('does not throw on garbage', async () => {
    const meta = await extractMetadata(fixture('make-fixtures.sh'), 'photo');
    expect(meta).toMatchObject({ lat: null, lon: null, takenAt: null });
  });
});

describe('video metadata (fixtures, needs ffprobe)', () => {
  it.each([
    ['video-new-york.mov', 40.6892, -74.0445, '2022-07-04T21:15:00-04:00'],
    ['video-paris.mp4', 48.8584, 2.2945, '2021-09-01T10:00:00Z'],
    ['video-cape-town-hevc.mp4', -33.9249, 18.4241, null],
  ])('%s → %f, %f at %s', async (file, lat, lon, takenAt) => {
    const meta = await extractMetadata(fixture(file), 'video');
    expect(meta.lat).toBeCloseTo(lat, 4);
    expect(meta.lon).toBeCloseTo(lon, 4);
    expect(meta.takenAt).toBe(takenAt);
    expect(meta).toMatchObject({ width: 32, height: 24 });
    expect(meta.duration).toBeCloseTo(2, 1);
  });

  it('leaves location empty when there is none', async () => {
    const meta = await extractMetadata(fixture('video-no-gps.webm'), 'video');
    expect(meta).toMatchObject({ lat: null, lon: null, takenAt: '2020-01-01T00:00:00Z' });
  });
});

describe('metadataFromProbe', () => {
  it('swaps dimensions for rotated (portrait) phone video', () => {
    const meta = metadataFromProbe({
      format: { duration: '3.5', tags: { 'com.apple.quicktime.location.ISO6709': '+51.5074-000.1278+011.000/' } },
      streams: [{ codec_type: 'video', width: 1920, height: 1080, side_data_list: [{ rotation: -90 }] }],
    });
    expect(meta).toMatchObject({ lat: 51.5074, lon: -0.1278, width: 1080, height: 1920, duration: 3.5 });
  });

  it('ignores zero dates and null island', () => {
    const meta = metadataFromProbe({
      format: { tags: { location: '+00.0000+000.0000/', creation_time: '1970-01-01T00:00:00.000000Z' } },
    });
    expect(meta).toMatchObject({ lat: null, lon: null, takenAt: null });
  });
});

describe('parseIso6709', () => {
  it.each([
    ['+51.5074-000.1278+011.000/', 51.5074, -0.1278],
    ['+48.8584+002.2945/', 48.8584, 2.2945],
    ['-33.9249+018.4241/', -33.9249, 18.4241],
    ['+4030.5-07400.0/', 40.508333, -74],
    ['+403000-0740030/', 40.5, -74.008333],
    ['-90+180/', -90, 180],
  ])('%s', (input, lat, lon) => {
    const p = parseIso6709(input)!;
    expect(p.lat).toBeCloseTo(lat, 5);
    expect(p.lon).toBeCloseTo(lon, 5);
  });

  it.each(['', 'nonsense', '+91.0+000.0/', '+10.0+181.0/', '+123456789+0/'])('rejects %j', (input) => {
    expect(parseIso6709(input)).toBeNull();
  });
});

describe('parseExifDate', () => {
  it('formats with and without offset', () => {
    expect(parseExifDate('2023:06:14 18:32:05', '+01:00')).toBe('2023-06-14T18:32:05+01:00');
    expect(parseExifDate('2023:06:14 18:32:05')).toBe('2023-06-14T18:32:05');
  });
  it('rejects empty dates', () => {
    expect(parseExifDate('0000:00:00 00:00:00')).toBeNull();
    expect(parseExifDate('    :  :     :  :  ')).toBeNull();
    expect(parseExifDate(undefined)).toBeNull();
  });
});
