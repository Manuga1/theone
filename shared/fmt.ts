export function money(cents: number, opts: { cents?: boolean } = {}): string {
  const dollars = cents / 100;
  if (opts.cents) return '$' + dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return '$' + Math.round(dollars).toLocaleString('en-US');
}
export function moneyK(cents: number): string {
  const d = cents / 100;
  if (d >= 1000) return '$' + Math.round(d / 1000).toLocaleString('en-US') + 'k';
  return '$' + Math.round(d).toLocaleString('en-US');
}
export function int(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}
export function pct(x: number): string {
  return `${Math.round(x)}%`;
}
/** Buyer-side small counts render as "<20" (k-anonymity floor). */
export function kfloor(n: number): string {
  if (n > 0 && n < 20) return '<20';
  return int(n);
}
export function dateShort(iso: string): string {
  return new Date(iso.length > 10 ? iso : iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
export function dateLong(iso: string): string {
  return new Date(iso.length > 10 ? iso : iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
