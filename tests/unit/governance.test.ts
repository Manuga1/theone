// Governance semantics: revoke is forward-only (ledger rows and built dataset members stay), withdraw ends an active
// enrollment, source disconnect / category delete soft-delete observations and rebuild coverage, category opt-out
// blocks NEW licenses only.
import { beforeAll, describe, expect, it } from 'vitest';
import { HttpError } from '../../server/errors';
import { acceptOpportunity, reviewOpportunity, viewOpportunity } from '../../server/services/consent';
import { deleteCategory, revokeLicense, withdrawEnrollment } from '../../server/services/governance';
import { activeLicenseCount, licensedUses, readLedger } from '../../server/services/ledger';
import { updatePermissions } from '../../server/services/permissions';
import { refreshDataset, currentDataset } from '../../server/services/dataset';
import { computeCompleteness } from '../../server/services/completeness';
import { disconnectSource } from '../../server/services/sources';
import { seededDbs, alexId, type TestDbs } from '../helpers/db';

const status = (fn: () => unknown) => { try { fn(); return 200; } catch (e) { return e instanceof HttpError ? e.status : 500; } };
const count = (t: TestDbs, sql: string, ...p: (number | string)[]) => t.graph.get<{ n: number }>(sql, ...p)!.n;

describe('governance (scale 0.05)', () => {
  let t: TestDbs;
  let pid: number;
  beforeAll(() => { t = seededDbs(); pid = alexId(t.graph); });

  it('license revoke is forward-only: ledger rows and built dataset members are untouched; the next refresh drops the member', () => {
    const study = t.graph.get<{ id: number }>("SELECT id FROM study WHERE name = 'Metabolic Monitoring Study'")!.id;
    const ds = currentDataset(study, t.graph)!;
    const member = t.graph.get<{ participant_id: number; license_id: number }>(
      `SELECT dm.participant_id, l.id AS license_id FROM dataset_member dm JOIN enrollment e ON e.participant_id = dm.participant_id AND e.study_id = ? AND e.status = 'completed'
         JOIN license l ON l.enrollment_id = e.id AND l.revoked_at IS NULL WHERE dm.dataset_id = ? ORDER BY dm.id LIMIT 1`, study, ds.id)!;
    const ledgerBefore = count(t, 'SELECT COUNT(*) AS n FROM ledger_entry WHERE participant_id = ?', member.participant_id);
    const membersBefore = count(t, 'SELECT COUNT(*) AS n FROM dataset_member WHERE dataset_id = ?', ds.id);
    expect(ledgerBefore).toBeGreaterThan(0);
    const r = revokeLicense(member.participant_id, member.license_id, t.graph);
    expect(r.revokedAt).toBeTruthy();
    expect(t.graph.get<{ revoked_at: string | null; status: string }>('SELECT l.revoked_at, e.status FROM license l JOIN enrollment e ON e.id = l.enrollment_id WHERE l.id = ?', member.license_id)).toEqual({ revoked_at: r.revokedAt, status: 'revoked' });
    expect(count(t, 'SELECT COUNT(*) AS n FROM ledger_entry WHERE participant_id = ?', member.participant_id)).toBe(ledgerBefore);
    expect(count(t, 'SELECT COUNT(*) AS n FROM dataset_member WHERE dataset_id = ?', ds.id)).toBe(membersBefore);
    expect(count(t, 'SELECT COUNT(*) AS n FROM dataset_member WHERE dataset_id = ? AND participant_id = ?', ds.id, member.participant_id)).toBe(1);
    const fresh = refreshDataset(1, ds.id, t.graph);
    expect(fresh.version).toBe(ds.version + 1);
    expect(fresh.dropped).toBe(1);
    expect(fresh.memberCount).toBe(membersBefore - 1);
    expect(count(t, 'SELECT COUNT(*) AS n FROM dataset_member WHERE dataset_id = ?', ds.id)).toBe(membersBefore); // old version intact
    expect(status(() => revokeLicense(member.participant_id, member.license_id, t.graph))).toBe(409);
    expect(status(() => revokeLicense(pid, member.license_id, t.graph))).toBe(404);
  });

  it("withdraw ends Alex's active enrollment: license revoked, opportunity withdrawn, ledger untouched", () => {
    const e = t.graph.get<{ id: number; opportunity_id: number }>("SELECT id, opportunity_id FROM enrollment WHERE participant_id = ? AND status = 'active'", pid)!;
    const before = readLedger(pid, t.graph);
    expect(activeLicenseCount(pid, t.graph)).toBe(4);
    withdrawEnrollment(pid, e.id, t.graph);
    expect(t.graph.get<{ status: string }>('SELECT status FROM enrollment WHERE id = ?', e.id)!.status).toBe('withdrawn');
    expect(t.graph.get<{ status: string }>('SELECT status FROM opportunity WHERE id = ?', e.opportunity_id)!.status).toBe('withdrawn');
    expect(t.graph.get<{ revoked_at: string | null }>('SELECT revoked_at FROM license WHERE enrollment_id = ?', e.id)!.revoked_at).toBeTruthy();
    const after = readLedger(pid, t.graph);
    expect(after.entries).toHaveLength(before.entries.length);
    expect(after.lifetimeEarningsCents).toBe(before.lifetimeEarningsCents);
    expect(activeLicenseCount(pid, t.graph)).toBe(3);
    expect(licensedUses(pid, t.graph)).toBe(6);
    expect(status(() => withdrawEnrollment(pid, e.id, t.graph))).toBe(409);
  });

  it('category opt-out blocks new licenses only; existing licenses run to term', () => {
    const opp = t.graph.get<{ id: number }>("SELECT op.id FROM opportunity op JOIN campaign c ON c.id = op.campaign_id WHERE op.participant_id = ? AND op.status = 'offered' AND c.name = 'Metabolic Monitoring Study'", pid)!.id;
    viewOpportunity(pid, opp, t.graph);
    reviewOpportunity(pid, opp, t.graph);
    updatePermissions(pid, { excludedCategories: ['outcomes'] }, t.graph); // the campaign collects a symptom survey
    expect(status(() => acceptOpportunity(pid, opp, t.graph))).toBe(403);
    expect(activeLicenseCount(pid, t.graph)).toBe(3);
    expect(t.graph.get<{ status: string }>('SELECT status FROM opportunity WHERE id = ?', opp)!.status).toBe('reviewed');
    updatePermissions(pid, { excludedCategories: [], recontactOptIn: false }, t.graph);
    expect(status(() => acceptOpportunity(pid, opp, t.graph))).toBe(403); // recontact switched off
    updatePermissions(pid, { recontactOptIn: true }, t.graph);
    const r = acceptOpportunity(pid, opp, t.graph);
    expect(r.contributionIds).toHaveLength(3);
    expect(activeLicenseCount(pid, t.graph)).toBe(4);
  });

  it('source disconnect and category delete soft-delete observations and rebuild coverage; datasets keep built rows', () => {
    const imagingBefore = count(t, "SELECT COUNT(*) AS n FROM observation o JOIN concept c ON c.id = o.concept_id WHERE o.participant_id = ? AND c.slug LIKE 'imaging.%' AND o.deleted_at IS NULL", pid);
    expect(imagingBefore).toBeGreaterThan(0);
    expect(Math.round(computeCompleteness(pid, undefined, t.graph).domains.get('imaging')!)).toBe(71);
    const r = deleteCategory(pid, 'imaging', t.graph);
    expect(r.observationsDeleted).toBe(imagingBefore);
    expect(count(t, "SELECT COUNT(*) AS n FROM observation o JOIN concept c ON c.id = o.concept_id WHERE o.participant_id = ? AND c.slug LIKE 'imaging.%' AND o.deleted_at IS NULL", pid)).toBe(0);
    expect(count(t, 'SELECT COUNT(*) AS n FROM observation WHERE participant_id = ? AND deleted_at IS NOT NULL', pid)).toBe(imagingBefore);
    expect(count(t, "SELECT COUNT(*) AS n FROM participant_coverage cv JOIN concept c ON c.id = cv.concept_id WHERE cv.participant_id = ? AND c.slug LIKE 'imaging.%'", pid)).toBe(0);
    expect(computeCompleteness(pid, undefined, t.graph).domains.get('imaging')).toBe(0);
    expect(t.graph.get<{ excl: string }>('SELECT excluded_categories_json AS excl FROM consent_setting WHERE participant_id = ?', pid)!.excl).toContain('imaging');
    expect(status(() => deleteCategory(pid, 'nope', t.graph))).toBe(404);
    const dmBefore = count(t, 'SELECT COUNT(*) AS n FROM dataset_member');
    const omron = t.graph.get<{ id: number }>("SELECT id FROM source WHERE participant_id = ? AND vendor = 'Omron BP7450'", pid)!.id;
    disconnectSource(pid, omron, t.graph);
    expect(count(t, 'SELECT COUNT(*) AS n FROM observation WHERE participant_id = ? AND source_id = ? AND deleted_at IS NULL', pid, omron)).toBe(0);
    expect(count(t, "SELECT COUNT(*) AS n FROM participant_coverage cv JOIN concept c ON c.id = cv.concept_id WHERE cv.participant_id = ? AND c.slug = 'physiology.cardiovascular.blood_pressure'", pid)).toBe(0);
    expect(count(t, 'SELECT COUNT(*) AS n FROM dataset_member')).toBe(dmBefore);
  });
});
