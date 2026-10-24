// Fixed demo clock. Every date, relative label, license-term check and screenshot derives from these.
export const DEMO_TODAY = '2026-10-24';
export const DEMO_NOW = '2026-10-24T14:00:00Z';

export function today(): string {
  return DEMO_TODAY;
}
export function nowIso(): string {
  return DEMO_NOW;
}
export function nowMs(): number {
  return Date.parse(DEMO_NOW);
}
export function daysAgo(n: number): string {
  return addDays(DEMO_TODAY, -n);
}
export function addDays(isoDate: string, n: number): string {
  const d = new Date(isoDate.length > 10 ? isoDate : isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function addMonths(isoDate: string, n: number): string {
  const d = new Date(isoDate.length > 10 ? isoDate : isoDate + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b.length > 10 ? b : b + 'T00:00:00Z') - Date.parse(a.length > 10 ? a : a + 'T00:00:00Z')) / 86_400_000);
}
export function hoursAgo(n: number): string {
  return new Date(nowMs() - n * 3_600_000).toISOString();
}
/** "2 hours ago", "1 day ago", "3 days ago", "2 weeks ago", else a short date. Relative to DEMO_NOW. */
export function relative(iso: string): string {
  const diff = nowMs() - Date.parse(iso.length > 10 ? iso : iso + 'T00:00:00Z');
  const m = Math.round(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(diff / 3_600_000);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(diff / 86_400_000);
  if (d < 14) return `${d} day${d === 1 ? '' : 's'} ago`;
  if (d < 60) return `${Math.round(d / 7)} weeks ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
