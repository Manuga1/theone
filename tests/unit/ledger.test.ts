import { beforeAll, describe, expect, it } from 'vitest';
import { fromNet, readLedger, activeLicenseCount, licensedUses, licenseStatus } from '../../server/services/ledger';
import { seededDbs, alexId, type TestDbs } from '../helpers/db';

describe('ledger split', () => {
  it('fromNet: gross = round(net / 0.9), platform = gross − net', () => {
    expect(fromNet(4200)).toEqual({ gross: 4667, participant: 4200, platform: 467 });
    expect(fromNet(9000)).toEqual({ gross: 10000, participant: 9000, platform: 1000 });
    expect(fromNet(0)).toEqual({ gross: 0, participant: 0, platform: 0 });
    for (const n of [1, 17, 24367, 118_00, 2_842_17]) {
      const s = fromNet(n);
      expect(s.participant + s.platform).toBe(s.gross);
      expect(Number.isInteger(s.gross)).toBe(true);
    }
  });
  it('licenseStatus derives from term + revoked_at relative to DEMO_TODAY', () => {
    expect(licenseStatus({ term_end: '2027-01-01', revoked_at: null })).toBe('active');
    expect(licenseStatus({ term_end: '2026-10-15', revoked_at: null })).toBe('expired');
    expect(licenseStatus({ term_end: '2027-01-01', revoked_at: '2026-10-01' })).toBe('revoked');
  });
});

describe("Alex's ledger", () => {
  let t: TestDbs;
  let pid: number;
  beforeAll(() => { t = seededDbs(); pid = alexId(t.graph); });

  it('seven licenses #1836–#1842 + five contribution payments = exactly $2,842.17 net', () => {
    const l = readLedger(pid, t.graph);
    expect(l.lifetimeEarningsCents).toBe(284217);
    expect(l.entries.filter((e) => e.kind === 'license_fee')).toHaveLength(7);
    expect(l.entries.filter((e) => e.kind === 'contribution_payment')).toHaveLength(5);
    const numbers = l.entries.filter((e) => e.licenseNumber).map((e) => e.licenseNumber).sort();
    expect(numbers).toEqual(['#1836', '#1837', '#1838', '#1839', '#1840', '#1841', '#1842']);
    for (const e of l.entries) expect(e.participantCents + e.platformCents).toBe(e.grossCents);
  });
  it('exactly 4 licenses in term today; 7 licensed uses', () => {
    expect(activeLicenseCount(pid, t.graph)).toBe(4);
    expect(licensedUses(pid, t.graph)).toBe(7);
    const l = readLedger(pid, t.graph);
    expect(l.activeLicenses).toBe(4);
    expect(l.entries.filter((e) => e.licenseStatus === 'active')).toHaveLength(4);
    expect(l.entries.filter((e) => e.licenseStatus === 'expired')).toHaveLength(3);
    expect(l.entries.filter((e) => e.canRevoke)).toHaveLength(4);
  });
  it('BP license lines total $118 across 3 licenses', () => {
    const rows = t.graph.all<{ number: number; cents: number }>(
      `SELECT l.number, ll.cents FROM license_line ll JOIN license l ON l.id = ll.license_id JOIN concept c ON c.id = ll.concept_id
        WHERE l.participant_id = ? AND c.slug = 'physiology.cardiovascular.blood_pressure'`, pid);
    expect(rows.reduce((a, r) => a + r.cents, 0)).toBe(11800);
    expect(new Set(rows.map((r) => r.number)).size).toBe(3);
  });
  it('every license and every verified contribution is a ledger row', () => {
    const licenses = t.graph.get<{ n: number }>('SELECT COUNT(*) AS n FROM license WHERE participant_id = ?', pid)!.n;
    const verified = t.graph.get<{ n: number }>("SELECT COUNT(*) AS n FROM contribution WHERE participant_id = ? AND status = 'verified'", pid)!.n;
    const rows = t.graph.get<{ n: number }>('SELECT COUNT(*) AS n FROM ledger_entry WHERE participant_id = ?', pid)!.n;
    expect(rows).toBe(licenses + verified);
  });
});
