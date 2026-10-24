// Participant governance: withdraw an active enrollment, revoke a license (forward-only), delete a whole category.
// Money already paid is never undone (ledger is append-only); built dataset_member rows stay for the license term and
// are dropped at the next dataset refresh. Category opt-out blocks NEW licenses only.
import { nowIso } from '@shared/clock';
import type { CategoryDeleteResult } from '@shared/api-types';
import { graph } from '../db/graph';
import type { Db } from '../db/driver';
import { conflict, notFound } from '../errors';
import { logActivity } from './activity';
import { rebuildCoverage } from './coverage';
import { licenseNumber } from './ledger';
import { conceptBySlug } from './ontology';
import { updatePermissions, readPermissions } from './permissions';
import { assertTransition, ENROLLMENT_TRANSITIONS, OPPORTUNITY_TRANSITIONS, type EnrollmentStatus } from './state';
import type { OpportunityStatus } from '@shared/api-types';

type EnrollmentRow = { id: number; participant_id: number; study_id: number; opportunity_id: number | null; consent_grant_id: number | null; status: EnrollmentStatus; study_name: string };

function enrollmentRow(id: number, db: Db): EnrollmentRow | undefined {
  return db.get<EnrollmentRow>('SELECT e.id, e.participant_id, e.study_id, e.opportunity_id, e.consent_grant_id, e.status, s.name AS study_name FROM enrollment e JOIN study s ON s.id = e.study_id WHERE e.id = ?', id);
}

/** Inside a tx: enrollment → `to`, grant + licenses revoked, opportunity withdrawn when still open for collection. */
function endEnrollment(db: Db, e: EnrollmentRow, to: 'withdrawn' | 'revoked', now: string): void {
  assertTransition('enrollment', ENROLLMENT_TRANSITIONS, e.status, to);
  db.run(`UPDATE enrollment SET status = ?, withdrawn_at = ? WHERE id = ?`, to, now, e.id);
  if (e.consent_grant_id) db.run('UPDATE consent_grant SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?', now, e.consent_grant_id);
  db.run('UPDATE license SET revoked_at = COALESCE(revoked_at, ?) WHERE enrollment_id = ?', now, e.id);
  if (e.opportunity_id) {
    const op = db.get<{ status: OpportunityStatus }>('SELECT status FROM opportunity WHERE id = ?', e.opportunity_id);
    if (op && OPPORTUNITY_TRANSITIONS[op.status].includes('withdrawn')) db.run("UPDATE opportunity SET status = 'withdrawn' WHERE id = ?", e.opportunity_id);
  }
  db.run('UPDATE study SET updated_at = ? WHERE id = ?', now, e.study_id);
}

export function withdrawEnrollment(participantId: number, enrollmentId: number, db: Db = graph()): { enrollmentId: number; status: EnrollmentStatus } {
  const e = enrollmentRow(enrollmentId, db);
  if (!e || e.participant_id !== participantId) throw notFound('enrollment');
  if (e.status !== 'active') throw conflict(`enrollment is ${e.status}; only an active enrollment can be withdrawn`);
  const now = nowIso();
  db.tx(() => {
    endEnrollment(db, e, 'withdrawn', now);
    logActivity(db, { participantId, kind: 'withdrawn', text: `Withdrew from ${e.study_name} — license revoked; payments already made are kept`, occurredAt: now });
    logActivity(db, { orgId: db.get<{ o: number }>('SELECT buyer_org_id AS o FROM study WHERE id = ?', e.study_id)?.o ?? null, kind: 'withdrawn', text: `${e.study_name}: a participant withdrew (replacement needed)`, occurredAt: now });
  });
  return { enrollmentId, status: 'withdrawn' };
}

/** Forward-only: the license stops future use; ledger rows and dataset versions already built are untouched. */
export function revokeLicense(participantId: number, licenseId: number, db: Db = graph()): { licenseId: number; licenseNumber: string; revokedAt: string } {
  const l = db.get<{ id: number; number: number; participant_id: number; enrollment_id: number | null; consent_grant_id: number | null; revoked_at: string | null; study_id: number; study_name: string; org_id: number }>(
    'SELECT l.id, l.number, l.participant_id, l.enrollment_id, l.consent_grant_id, l.revoked_at, l.study_id, s.name AS study_name, s.buyer_org_id AS org_id FROM license l JOIN study s ON s.id = l.study_id WHERE l.id = ?', licenseId);
  if (!l || l.participant_id !== participantId) throw notFound('license');
  if (l.revoked_at) throw conflict('license is already revoked');
  const now = nowIso();
  db.tx(() => {
    db.run('UPDATE license SET revoked_at = ? WHERE id = ?', now, l.id);
    if (l.consent_grant_id) db.run('UPDATE consent_grant SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?', now, l.consent_grant_id);
    const e = l.enrollment_id ? enrollmentRow(l.enrollment_id, db) : undefined;
    if (e && (e.status === 'active' || e.status === 'completed')) endEnrollment(db, e, e.status === 'active' ? 'withdrawn' : 'revoked', now);
    db.run('UPDATE study SET updated_at = ? WHERE id = ?', now, l.study_id);
    logActivity(db, { participantId, kind: 'license_revoked', text: `Research License ${licenseNumber(l.number)} revoked — analyses already performed are not undone; your data leaves the next dataset version`, occurredAt: now });
    logActivity(db, { orgId: l.org_id, kind: 'license_revoked', text: `${l.study_name}: a participant revoked their license (forward-only; refresh the dataset)`, occurredAt: now });
  });
  return { licenseId, licenseNumber: licenseNumber(l.number), revokedAt: now };
}

/** Delete a category: soft-delete every observation under the domain, rebuild coverage and exclude the category from new licenses. */
export function deleteCategory(participantId: number, domain: string, db: Db = graph()): CategoryDeleteResult {
  const d = conceptBySlug(domain, db);
  if (!d || d.level !== 'domain') throw notFound('category');
  const now = nowIso();
  let deleted = 0;
  db.tx(() => {
    deleted = db.run(
      `UPDATE observation SET deleted_at = ? WHERE participant_id = ? AND deleted_at IS NULL AND concept_id IN (SELECT id FROM concept WHERE slug = ? OR slug LIKE ?)`,
      now, participantId, domain, `${domain}.%`).changes;
    rebuildCoverage(participantId, db);
    const current = readPermissions(participantId, db).categories.filter((c) => c.excluded).map((c) => c.slug);
    if (!current.includes(domain)) updatePermissions(participantId, { excludedCategories: [...current, domain] }, db);
    logActivity(db, { participantId, kind: 'category_deleted', text: `${d.name} data deleted (${deleted.toLocaleString('en-US')} records) and excluded from new licenses`, occurredAt: now });
  });
  return { ok: true, writeVersion: db.writeVersion, domain, observationsDeleted: deleted, excluded: true };
}
