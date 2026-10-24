// Money / number formatting helpers. All formatting flows through shared/fmt.ts so server and client agree.
import { money, moneyK, int, pct, kfloor } from '@shared/fmt';

export { money, moneyK, int, pct, kfloor };

export function Money({ cents, exact = false, prefix = '' }: { cents: number; exact?: boolean; prefix?: string }) {
  return <span className="num">{prefix}{money(cents, { cents: exact })}</span>;
}
export function MoneyK({ cents }: { cents: number }) {
  return <span className="num">{moneyK(cents)}</span>;
}
export function Num({ n }: { n: number }) {
  return <span className="num">{int(n)}</span>;
}
/** Buyer-side count: anything between 1 and 19 renders as "<20". */
export function KNum({ n }: { n: number }) {
  return <span className="num">{kfloor(n)}</span>;
}
export function Pct({ x }: { x: number }) {
  return <span className="num">{pct(x)}</span>;
}
export function signed(n: number, suffix = ''): string {
  return `${n > 0 ? '+' : ''}${n}${suffix}`;
}
