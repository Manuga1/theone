// Every number on screen comes from a query: the mockup's headline figures must never be hard-coded in client/src
// (client/src/dev/ holds the design-gallery fixtures and is exempt). Tokens are matched as whole tokens, so "4,850"
// inside "14,850" or "2,140" inside "2,1405" do not count, while "$1,482" does.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..', '..');
const CLIENT_SRC = path.join(ROOT, 'client', 'src');
const EXEMPT = path.join(CLIENT_SRC, 'dev');

export const MOCKUP_LITERALS = [
  '128,420', '128420', '112,810', '48,921', '121,304', '8,422', '18,422', '8,912', '6,820', '3,408', '2,140', '2,842', '284217', '1,482',
  '4,850', '2,920', '2,560', '3,011', '2,841', '2,421', '2,378', '$1,180', '$318', '#1842',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (p === EXEMPT || p.startsWith(EXEMPT + path.sep)) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|css|html|md)$/.test(name)) out.push(p);
  }
  return out;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whole-token match: not glued to a letter/digit/underscore, a thousands separator or a decimal on either side. */
export function literalPattern(token: string): RegExp {
  const prefixed = /^[$#]/.test(token);
  return new RegExp(`(?<![\\w${prefixed ? '' : ',.'}])${escape(token)}(?![\\w]|[,.]\\d)`);
}

describe('no mockup literals in client/src (outside client/src/dev)', () => {
  it('whole-token matcher behaves', () => {
    expect(literalPattern('4,850').test('contacts 4,850 of')).toBe(true);
    expect(literalPattern('4,850').test('14,850')).toBe(false);
    expect(literalPattern('2,140').test('2,1405')).toBe(false);
    expect(literalPattern('1,482').test('$1,482')).toBe(true);
    expect(literalPattern('$318').test('≈ $318k')).toBe(false);
    expect(literalPattern('$318').test('cost $318 total')).toBe(true);
    expect(literalPattern('#1842').test('License #1842')).toBe(true);
    expect(literalPattern('128420').test('x1284201')).toBe(false);
  });
  it('no client source file contains a headline mockup number', () => {
    const files = walk(CLIENT_SRC);
    expect(files.length).toBeGreaterThan(10);
    const hits: string[] = [];
    for (const f of files) {
      const lines = readFileSync(f, 'utf8').split('\n');
      lines.forEach((line, i) => {
        for (const token of MOCKUP_LITERALS) if (literalPattern(token).test(line)) hits.push(`${path.relative(ROOT, f)}:${i + 1}: "${token}" in ${line.trim().slice(0, 120)}`);
      });
    }
    expect(hits, hits.join('\n')).toEqual([]);
  });
});
