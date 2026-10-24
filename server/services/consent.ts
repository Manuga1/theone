// Participant response to an opportunity (P7 Review & Consent): view → review → accept | decline.
// Accept is the ONLY place a license is minted: consent_grant + enrollment + reuse license + license lines +
// license_fee ledger row + pending contributions per collect variable. Red-lines, category exclusions and the
// recontact opt-in are checked here (403). The same `enroll()` core is used by the bulk advance simulation.
import { DEMO_TODAY, addMonths, nowIso } from '@shared/clock';
import { domainOf } from '@shared/ontology';
import type { OpportunityStatus } from '@shared/api-types';
import type { CampaignVariable } from '@shared/requirement';
import { graph } from '../db/graph';
import type { Db } from '../db/driver';
import { forbidden, notFound, conflict } from '../errors';
import { logActivity } from './activity';
import { orgConsent } from './cohort';
import { conceptNames, fromNet, postLedger } from './ledger';
import { conceptBySlug, reuseFeeCents } from './ontology';
import { assertTransition, OPPORTUNITY_TRANSITIONS } from './state';

export type SeedVariable = CampaignVariable & { label?: string };

/** One licensed (reused) variable of an opportunity with its license fee (net cents). */
export type ReuseScopeItem = { variable: SeedVariable; conceptSlug: string; cents: number };

/**
 * The reuse scope of ONE opportunity = the campaign's `reuse` variables ∪ its `collect_if_missing` variables that this
 * participant already holds (i.e. not listed in the opportunity's missing concepts). A held collect_if_missing variable
 * is licensed at the concept's reuse fee (B6: "collect only from participants who lack it; reuse — and pay the fee —
 * for the rest"). `collect_all` variables are always re-measured and never licensed.
 */
export function reuseScope(vars: SeedVariable[], missing: Iterable<string> | string, db: Db = graph()): ReuseScopeItem[] {
  const miss = new Set(typeof missing === 'string' ? (JSON.parse(missing) as string[]) : missing);
  const out: ReuseScopeItem[] = [];
  for (const v of vars) {
    if (v.mode === 'reuse') out.push({ variable: v, conceptSlug: v.conceptSlug, cents: v.compCents });
    else if (v.mode === 'collect_if_missing' && !miss.has(v.conceptSlug)) {
      const c = conceptBySlug(v.conceptSlug, db);
      out.push({ variable: v, conceptSlug: v.conceptSlug, cents: c ? reuseFeeCents(c) : Math.max(300, Math.round(v.compCents * 0.15)) });
    }
  }
  return out;
}
/** Σ license fees of an opportunity's reuse scope. */
export function reuseFeeFor(vars: SeedVariable[], missing: Iterable<string> | string, db: Db = graph()): number {
  return reuseScope(vars, missing, db).reduce((a, s) => a + s.cents, 0);
}
/** What this participant collects under the opportunity: collect_all variables + the collect_if_missing ones they lack. */
export function collectVariables(vars: SeedVariable[], missing: Iterable<string> | string): SeedVariable[] {
  const miss = new Set(typeof missing === 'string' ? (JSON.parse(missing) as string[]) : missing);
  return vars.filter((v) => v.mode === 'collect_all' || (v.mode === 'collect_if_missing' && miss.has(v.conceptSlug)));
}
/** comp_max of an offer = Σ collection comps of what the member collects + Σ license fees of what is reused. */
export function offerComp(vars: SeedVariable[], missing: string[], db: Db = graph()): number {
  return collectVariables(vars, missing).reduce((a, v) => a + v.compCents, 0) + reuseFeeFor(vars, missing, db);
}

export type OppJoined = {
  id: number; participant_id: number; status: OpportunityStatus; missing_concepts_json: string; comp_max_cents: number; viewed_at: string | null; reviewed_at: string | null;
  campaign_id: number; campaign_name: string; campaign_status: string; variables_json: string; study_id: number; study_name: string; purpose: string; license_term_months: number;
  buyer_org_id: number; org_name: string; is_detailed: number;
};

export function loadOpportunity(id: number, db: Db = graph()): OppJoined | undefined {
  if (!db.tableExists('opportunity')) return undefined;
  return db.get<OppJoined>(
    `SELECT op.id, op.participant_id, op.status, op.missing_concepts_json, op.comp_max_cents, op.viewed_at, op.reviewed_at,
            cp.id AS campaign_id, cp.name AS campaign_name, cp.status AS campaign_status, cp.variables_json, s.id AS study_id, s.name AS study_name, s.purpose, s.license_term_months,
            s.buyer_org_id, o.name AS org_name, p.is_detailed
       FROM opportunity op JOIN campaign cp ON cp.id = op.campaign_id JOIN study s ON s.id = cp.study_id JOIN buyer_org o ON o.id = s.buyer_org_id JOIN participant p ON p.id = op.participant_id
      WHERE op.id = ?`, id);
}

function ownOpportunity(participantId: number, id: number, db: Db): OppJoined {
  const o = loadOpportunity(id, db);
  if (!o || o.participant_id !== participantId) throw notFound('opportunity');
  return o;
}

function setStatus(db: Db, o: OppJoined, to: OpportunityStatus, extra: Record<string, string | null> = {}): void {
  assertTransition('opportunity', OPPORTUNITY_TRANSITIONS, o.status, to);
  const sets = ['status = ?', ...Object.keys(extra).map((k) => `${k} = ?`)].join(', ');
  db.run(`UPDATE opportunity SET ${sets} WHERE id = ?`, to, ...Object.values(extra), o.id);
  o.status = to;
}

export function viewOpportunity(participantId: number, id: number, db: Db = graph()): OpportunityStatus {
  const o = ownOpportunity(participantId, id, db);
  if (o.status !== 'offered') return o.status; // idempotent: viewing again is not a transition
  const now = nowIso();
  db.tx(() => setStatus(db, o, 'viewed', { viewed_at: now }));
  return o.status;
}

export function reviewOpportunity(participantId: number, id: number, db: Db = graph()): OpportunityStatus {
  const o = ownOpportunity(participantId, id, db);
  if (o.status === 'reviewed') return o.status;
  const now = nowIso();
  db.tx(() => setStatus(db, o, 'reviewed', { reviewed_at: now, viewed_at: o.viewed_at ?? now }));
  return o.status;
}

export function declineOpportunity(participantId: number, id: number, db: Db = graph()): OpportunityStatus {
  const o = ownOpportunity(participantId, id, db);
  const now = nowIso();
  db.tx(() => {
    setStatus(db, o, 'declined', { responded_at: now });
    logActivity(db, { participantId, kind: 'opportunity_declined', text: `Declined: ${o.study_name}`, occurredAt: now });
  });
  return o.status;
}

export type ConsentCheck = { ok: true } | { ok: false; reason: string };

/** Red-lines (org declared uses), category exclusions (domains of the campaign scope) and the recontact opt-in. */
export function consentCheck(participantId: number, o: Pick<OppJoined, 'buyer_org_id' | 'variables_json'>, db: Db = graph()): ConsentCheck {
  const org = orgConsent(o.buyer_org_id, db);
  if (org.blocked) return { ok: false, reason: org.reason ?? 'blocked by participant red-lines' };
  const cs = db.get<{ excluded_categories_json: string; recontact_opt_in: number; commercial_ok: number }>('SELECT excluded_categories_json, recontact_opt_in, commercial_ok FROM consent_setting WHERE participant_id = ?', participantId);
  const excluded = new Set<string>(cs ? (JSON.parse(cs.excluded_categories_json) as string[]) : []);
  const vars = JSON.parse(o.variables_json) as SeedVariable[];
  const hit = vars.map((v) => domainOf(v.conceptSlug)).find((d) => excluded.has(d));
  if (hit) return { ok: false, reason: `You have excluded the "${hit}" category; no new license can include it.` };
  if (cs && !cs.recontact_opt_in) return { ok: false, reason: 'Recontact is switched off in your permissions; enable it to accept new opportunities.' };
  if (cs && !cs.commercial_ok && org.type !== 'academic') return { ok: false, reason: 'Commercial research use is switched off in your permissions.' };
  return { ok: true };
}

export type EnrollResult = { enrollmentId: number; grantId: number; licenseId: number; licenseNumber: number; contributionIds: number[]; licenseNetCents: number };

export function nextLicenseNumber(db: Db): number {
  return (db.get<{ n: number | null }>('SELECT MAX(number) AS n FROM license')?.n ?? 1000) + 1;
}

/**
 * The accept core (must run inside a transaction): consent grant, enrollment, reuse license (+ lines, ledger row) and
 * pending contributions for every variable this participant still has to collect. `at` is the acceptance timestamp;
 * `termStart` the license term start (date). Used by the participant accept route and by the advance simulation.
 */
export function enroll(db: Db, o: OppJoined, opts: { at: string; termStart?: string; licenseNumber?: number }): EnrollResult {
  const vars = JSON.parse(o.variables_json) as SeedVariable[];
  const scope = Array.from(new Set(vars.map((v) => v.conceptSlug)));
  const reuse = reuseScope(vars, o.missing_concepts_json, db); // reuse vars + held collect_if_missing vars (licensed at the reuse fee)
  const collect = collectVariables(vars, o.missing_concepts_json);
  const termStart = opts.termStart ?? opts.at.slice(0, 10);
  const termEnd = addMonths(termStart, o.license_term_months);
  const grantId = db.run(
    'INSERT INTO consent_grant (participant_id, study_id, opportunity_id, scope_concepts_json, withheld_json, purpose, term_months, reuse_allowed, recontact_via_platform, granted_at, revoked_at, created_at) VALUES (?,?,?,?,?,?,?,0,1,?,NULL,?)',
    o.participant_id, o.study_id, o.id, JSON.stringify(scope), '["identity"]', o.purpose, o.license_term_months, opts.at, opts.at).lastId;
  const enrollmentId = db.run(
    "INSERT INTO enrollment (participant_id, study_id, campaign_id, opportunity_id, consent_grant_id, status, enrolled_at, completed_at, withdrawn_at, created_at) VALUES (?,?,?,?,?,'active',?,NULL,NULL,?)",
    o.participant_id, o.study_id, o.campaign_id, o.id, grantId, opts.at, opts.at).lastId;
  const licenseNet = reuse.reduce((a, s) => a + s.cents, 0);
  const number = opts.licenseNumber ?? nextLicenseNumber(db);
  const split = fromNet(licenseNet);
  const licenseId = db.run(
    'INSERT INTO license (number, study_id, buyer_org_id, participant_id, consent_grant_id, enrollment_id, scope_concepts_json, purpose, term_start, term_end, gross_cents, participant_cents, platform_cents, revoked_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?)',
    number, o.study_id, o.buyer_org_id, o.participant_id, grantId, enrollmentId, JSON.stringify(reuse.map((s) => s.conceptSlug)), o.purpose, termStart, termEnd,
    split.gross, split.participant, split.platform, opts.at).lastId;
  for (const s of reuse) {
    const c = conceptBySlug(s.conceptSlug, db);
    if (c) db.run('INSERT INTO license_line (license_id, concept_id, cents, created_at) VALUES (?,?,?,?)', licenseId, c.id, s.cents, opts.at);
  }
  postLedger(db, { participantId: o.participant_id, kind: 'license_fee', netCents: licenseNet, occurredAt: opts.at, studyId: o.study_id, licenseId, memo: `Research License #${number} — ${o.study_name}` });
  const contributionIds: number[] = [];
  for (const v of collect) {
    const c = conceptBySlug(v.conceptSlug, db);
    if (!c) continue;
    const p = v.requirement.protocol;
    contributionIds.push(db.run(
      "INSERT INTO contribution (opportunity_id, participant_id, concept_id, status, method, duration_days, comp_cents, artifact_id, observation_count, submitted_at, verified_at, created_at) VALUES (?,?,?,'pending',?,?,?,NULL,0,NULL,NULL,?)",
      o.id, o.participant_id, c.id, p?.method ?? c.collection_method ?? 'protocol', Math.max(1, p?.durationDays ?? 1), v.compCents, opts.at).lastId);
  }
  return { enrollmentId, grantId, licenseId, licenseNumber: number, contributionIds, licenseNetCents: licenseNet };
}

export function acceptOpportunity(participantId: number, id: number, db: Db = graph()): EnrollResult & { opportunityStatus: OpportunityStatus } {
  const o = ownOpportunity(participantId, id, db);
  if (o.status !== 'reviewed') {
    if (o.status === 'offered' || o.status === 'viewed') throw conflict('review the consent terms before accepting');
    assertTransition('opportunity', OPPORTUNITY_TRANSITIONS, o.status, 'accepted');
  }
  if (o.campaign_status !== 'active') throw conflict('this campaign is no longer recruiting');
  const check = consentCheck(participantId, o, db);
  if (!check.ok) throw forbidden(check.reason);
  const now = nowIso();
  const names = conceptNames(db);
  return db.tx(() => {
    setStatus(db, o, 'accepted', { responded_at: now });
    const r = enroll(db, o, { at: now, termStart: DEMO_TODAY });
    const tasks = db.all<{ name: string }>('SELECT k.name FROM contribution c JOIN concept k ON k.id = c.concept_id WHERE c.opportunity_id = ? ORDER BY c.id', o.id).map((t) => t.name);
    logActivity(db, { participantId, kind: 'enrollment', text: `Enrolled: ${o.study_name} — Research License #${r.licenseNumber}${tasks.length ? ` · ${tasks.length} task${tasks.length === 1 ? '' : 's'} pending` : ''}`, amountCents: r.licenseNetCents || null, occurredAt: now });
    logActivity(db, { orgId: o.buyer_org_id, kind: 'enrollment', text: `${o.study_name}: new participant enrolled (${tasks.map((t) => names.get(t) ?? t).join(', ') || 'reuse only'})`, occurredAt: now });
    db.run('INSERT INTO event (participant_id, occurred_at, kind, category, title, detail, concept_id, created_at) VALUES (?,?,?,?,?,?,NULL,?)',
      participantId, now.slice(0, 10), 'enrollment', 'research', `Enrolled: ${o.study_name}`, `${o.org_name} · ${o.license_term_months}-month license · identity withheld`, now);
    db.run('UPDATE study SET updated_at = ? WHERE id = ?', now, o.study_id);
    if (!r.contributionIds.length) completeWithoutTasks(db, o, r.enrollmentId, now);
    return { ...r, opportunityStatus: o.status };
  });
}

/** Reuse-only campaigns: nothing to collect, so acceptance completes the enrollment at once. */
function completeWithoutTasks(db: Db, o: OppJoined, enrollmentId: number, now: string): void {
  setStatus(db, o, 'in_progress');
  setStatus(db, o, 'paid', { completed_at: now });
  db.run("UPDATE enrollment SET status = 'completed', completed_at = ? WHERE id = ?", now, enrollmentId);
}
