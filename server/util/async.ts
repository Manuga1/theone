/** Sequential async map: one query at a time, in order (transactions run on one connection; order stays deterministic). */
export async function mapSeq<T, U>(items: readonly T[], fn: (item: T, index: number) => Promise<U>): Promise<U[]> {
  const out: U[] = [];
  for (let i = 0; i < items.length; i++) out.push(await fn(items[i], i));
  return out;
}
