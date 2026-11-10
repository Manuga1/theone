import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { appleDate, parseAppleHealthXml } from '../../server/services/appleHealth';

const xml = readFileSync(new URL('../fixtures/apple-health-sample.xml', import.meta.url), 'utf8');

describe('Apple Health export parser', () => {
  it('converts Apple timestamps to UTC ISO', () => {
    expect(appleDate('2026-10-20 07:14:33 -0700')).toBe('2026-10-20T14:14:33Z');
    expect(appleDate('2026-10-20 07:14:33 +0100')).toBe('2026-10-20T06:14:33Z');
    expect(appleDate('nope')).toBeNull();
  });
  it('maps Record types to leaves: HR per record, steps/kcal per day, BP paired, sleep per night, lb → kg, mmol/L → mg/dL', () => {
    const r = parseAppleHealthXml(xml);
    expect(r.records).toBe(22);
    expect(r.unmapped).toBe(3); // active energy, walking distance, InBed
    const by = (slug: string) => r.parsed.filter((p) => p.slug === slug);
    expect(by('physiology.cardiovascular.heart_rate').map((p) => p.value)).toEqual([61, 88, 59]);
    expect(by('physiology.cardiovascular.hrv').map((p) => p.value)).toEqual([41.2, 38.7]);
    expect(by('physiology.mobility.steps').map((p) => [p.observedAt, p.value])).toEqual([['2026-10-20T23:00:00Z', 2016], ['2026-10-21T23:00:00Z', 3039]]); // daily sums bucket on the UTC date (18:00 -0700 is the next UTC day)
    expect(by('physiology.metabolic.weight')[0]).toMatchObject({ value: 91.3, unit: 'kg' });
    expect(by('physiology.cardiovascular.blood_pressure').map((p) => p.json)).toEqual([{ systolic: 124, diastolic: 79 }, { systolic: 127, diastolic: 81 }]);
    expect(by('physiology.metabolic.glucose')[0]).toMatchObject({ value: 112, unit: 'mg/dL' });
    expect(by('behavior.nutrition.food_log')[0]).toMatchObject({ value: 1070, unit: 'kcal' });
    expect(by('physiology.sleep.sleep_duration')[0]).toMatchObject({ value: 7.5, unit: 'h', observedAt: '2026-10-20T13:40:00Z' });
    expect(r.parsed.every((p) => p.sourceName)).toBe(true);
  });
});
