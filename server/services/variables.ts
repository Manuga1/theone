// "Request additional variable" (B8 → S11): preview the pool of study members / cohort matches lacking a variable,
// then create a child campaign that offers it (inserting a new concept row when the variable is new — a dynamic
// dimension of the ontology) and notifies every participant watching that concept ("Notify me").
import { nowIso } from '@shared/clock';
import { Rng } from '@shared/rng';
import type { CampaignVariable, ProtocolRequirement } from '@shared/requirement';
import type { VariablePreview, VariablePreviewQuery, VariableRequest, VariableRequestResult } from '@shared/api-types';
import { graph } from '../db/graph';
import type { Db } from '../db/driver';
import { badRequest, conflict, forbidden, notFound } from '../errors';
import { logActivity } from './activity';
import { campaignRow, getCampaign, offerOpportunities, parseVariables, rootCampaign, studyCriteria, studyForOrg, type StudyRow } from './campaign';
import { evaluateCohort, orgConsent, recruitablePool } from './cohort';
import { buildEstimate, contactsForTarget } from './estimate';
import { conceptBySlug, leaves, reuseFeeCents, type ConceptRow } from './ontology';
import { mapSeq } from '../util/async';

const METHODS: ProtocolRequirement['method'][] = ['device', 'protocol', 'survey', 'photo', 'upload', 'kit'];

/** The root campaign's reuse variables, fees included: a child campaign's license carries the same reuse fee as the root's. */
async function reuseVariables(study: StudyRow, db: Db): Promise<CampaignVariable[]> {
  const root = await rootCampaign(study.id, db);
  return root
    ? await mapSeq(parseVariables(root.variables_json).filter((v) => v.mode === 'reuse'), async (v) => ({
        conceptSlug: v.conceptSlug, mode: 'reuse' as const, requirement: v.requirement, deviceCostCents: 0,
        compCents: v.compCents > 0 ? v.compCents : reuseFeeCents(await conceptBySlug(v.conceptSlug, db) ?? { comp_cents: 0, reuse_comp_cents: 0 }),
      }))
    : [];
}

function collectVariable(slug: string, c: ConceptRow | undefined, protocol: { method: string; durationDays: number; trials?: number; device?: string }, minProvRank: number, compCents: number | undefined): CampaignVariable {
  const method = (METHODS.includes(protocol.method as ProtocolRequirement['method']) ? protocol.method : c?.collection_method && METHODS.includes(c.collection_method as ProtocolRequirement['method']) ? c.collection_method : 'protocol') as ProtocolRequirement['method'];
  const rank = Math.min(4, Math.max(1, Math.round(minProvRank || 3)));
  return {
    conceptSlug: slug, mode: 'collect_if_missing',
    requirement: { historical: { minSpanDays: c?.min_span_days ?? 0, minProvRank: rank }, protocol: { method, durationDays: Math.max(1, Math.round(protocol.durationDays || 1)), trials: protocol.trials, device: protocol.device, minProvRank: rank } },
    compCents: Math.max(0, Math.round(compCents ?? c?.comp_cents ?? 9000)), deviceCostCents: c?.device_cost_cents ?? 0,
  };
}

export async function previewVariable(orgId: number, studyId: number, q: VariablePreviewQuery, db: Db = graph()): Promise<VariablePreview> {
  const study = await studyForOrg(orgId, studyId, db);
  const consent = await orgConsent(orgId, db);
  if (consent.blocked) throw forbidden(consent.reason ?? 'blocked by participant red-lines');
  const slug = String(q.concept ?? '').trim();
  if (!slug) throw badRequest('concept is required');
  const targetN = Math.round(Number(q.targetN));
  if (!Number.isFinite(targetN) || targetN <= 0) throw badRequest('targetN must be a positive number');
  const c = await conceptBySlug(slug, db);
  if (c && c.level !== 'leaf') throw badRequest('concept must be a leaf');
  const isNew = !c;
  const reuse = await reuseVariables(study, db);
  // A new concept has no rows yet: everyone lacks it. A stand-in leaf in collect_all mode puts every base member in one group.
  const standIn = isNew ? (await leaves(db)).find((l) => l.enrichable && !reuse.some((r) => r.conceptSlug === l.slug))?.slug ?? (await leaves(db))[0]?.slug : slug;
  const variable = collectVariable(standIn ?? slug, c, { method: String(q.durationDays ? 'protocol' : 'protocol'), durationDays: Number(q.durationDays) || 1 }, Number(q.minProvRank) || 3, q.compCents !== undefined ? Number(q.compCents) : undefined);
  if (isNew) variable.mode = 'collect_all';
  const variables = [...reuse, variable];
  const ev = standIn ? await evaluateCohort(studyCriteria(study), { orgId, variables }, db) : null;
  const groups = ev ? ev.groups : [];
  const estimate = buildEstimate({ targetN, readyNow: 0, groups, variables });
  return {
    conceptSlug: isNew ? slug : c!.slug, conceptName: c?.name ?? slug, isNewConcept: isNew,
    missingN: groups.reduce((a, g) => a + g.eligible, 0), recruitableN: groups.reduce((a, g) => a + g.recruitable, 0), estimate,
  };
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'variable';
}

export async function requestVariable(orgId: number, studyId: number, body: VariableRequest, db: Db = graph()): Promise<VariableRequestResult> {
  const study = await studyForOrg(orgId, studyId, db);
  const consent = await orgConsent(orgId, db);
  if (consent.blocked) throw forbidden(consent.reason ?? 'blocked by participant red-lines');
  if (study.status !== 'active') throw conflict('variables can only be requested for an active study');
  const root = await rootCampaign(study.id, db);
  if (!root) throw conflict('the study has no campaign');
  const protocol = body.protocol && typeof body.protocol === 'object' ? body.protocol : { method: 'protocol', durationDays: 1 };
  const targetN = Math.round(Number(body.targetN));
  if (!Number.isFinite(targetN) || targetN <= 0) throw badRequest('targetN must be a positive number');
  const now = nowIso();
  const result = await db.tx(async () => {
      let c: ConceptRow | undefined;
      let isNew = false;
      if (typeof body.concept === 'string') {
        c = await conceptBySlug(body.concept.trim(), db);
        if (!c || c.level !== 'leaf') throw notFound('concept');
      } else if (body.concept && typeof body.concept === 'object' && typeof body.concept.name === 'string' && body.concept.name.trim()) {
        const parent = await conceptBySlug(String(body.concept.parentSlug ?? ''), db);
        if (!parent || parent.level !== 'group') throw badRequest('newConcept.parentSlug must be an existing group');
        const slug = `${parent.slug}.${slugify(body.concept.name)}`;
        if (await conceptBySlug(slug, db)) { c = await conceptBySlug(slug, db); }
        else {
          const maxOrder = (await db.get<{ n: number | null }>('SELECT MAX(sort_order) AS n FROM concept'))?.n ?? 0;
          const method = METHODS.includes(body.concept.method as ProtocolRequirement['method']) ? body.concept.method : 'protocol';
          const valueKind = method === 'kit' || method === 'upload' ? 'file' : method === 'photo' ? 'photo' : method === 'device' ? 'continuous' : body.concept.unit ? 'float' : 'text';
          await db.run(
                      'INSERT INTO concept (slug, parent_id, name, level, weight, unit, data_type, min_span_days, freshness_days, collection_method, enrichable, comp_cents, device_cost_cents, in_ring, in_list, sort_order, description, value_kind, synonyms_json, created_at) VALUES (?,?,?,?,0,?,?,?,NULL,?,1,?,0,0,1,?,?,?,?,?)',
                      slug, parent.id, body.concept.name.trim(), 'leaf', body.concept.unit ?? null, method === 'kit' || method === 'upload' ? 'file' : method === 'device' ? 'time_series' : 'structured', Math.max(0, Math.round(body.concept.minSpanDays ?? 0)), method,
                      Math.max(0, Math.round(Number(body.compCents) || 0)), maxOrder + 1, `Requested by ${study.org_name} for ${study.name}`, valueKind, JSON.stringify([body.concept.name.trim().toLowerCase()]), now);
          isNew = true;
          c = await db.get<ConceptRow>('SELECT * FROM concept WHERE slug = ?', slug);
        }
      } else throw badRequest('concept must be a slug or { name, parentSlug, method }');
      if (!c) throw notFound('concept');
      const concept = c;
      const reuse = await reuseVariables(study, db);
      const variable = collectVariable(concept.slug, concept, { method: String(protocol.method ?? 'protocol'), durationDays: Number(protocol.durationDays) || 1, trials: protocol.trials, device: protocol.device }, Number(body.minProvRank) || 3, body.compCents !== undefined ? Number(body.compCents) : undefined);
      const p = variable.requirement.protocol!;
      const labelled = { ...variable, label: p.durationDays > 1 ? `${p.durationDays} days ${concept.name.toLowerCase()}` : `${concept.name} (${p.method === 'kit' ? 'kit' : p.method === 'survey' ? 'questionnaire' : p.method === 'upload' ? 'upload' : 'protocol'})` };
      const variables = [...reuse, labelled];
      const name = `${concept.name} collection`;
      const campaignId = (await db.run(
            "INSERT INTO campaign (study_id, parent_campaign_id, name, status, target_complete_n, eligible_n, variables_json, estimate_json, launched_at, closed_at, created_at) VALUES (?,?,?,'active',?,0,?,NULL,?,NULL,?)",
            study.id, root.id, name, targetN, JSON.stringify(variables), now.slice(0, 10), now)).lastId;
      const campaign = (await campaignRow(campaignId, db))!;
      // pool: cohort base ∪ study members lacking the variable (fresh concept → everyone lacks it); nobody holds an offer in this campaign yet
      const { ev, members } = await recruitablePool(studyCriteria(study), { orgId, variables, openOpportunityCampaignId: campaignId }, db);
      const estimate = buildEstimate({ targetN, readyNow: 0, groups: ev.groups, variables });
      const contacts = contactsForTarget(targetN, members.length);
      const watchers = (await db.all<{ pid: number }>(
            `SELECT w.participant_id AS pid FROM demand_watch w JOIN consent_setting cs ON cs.participant_id = w.participant_id
        WHERE w.concept_id = ? AND cs.recontact_opt_in = 1 AND cs.vault_only = 0 AND instr(cs.excluded_categories_json, ?) = 0
          AND NOT EXISTS (SELECT 1 FROM participant_coverage cv WHERE cv.participant_id = w.participant_id AND cv.concept_id = ? AND cv.n_obs > 0 AND cv.best_prov_rank >= ?)`,
            concept.id, `"${concept.slug.split('.')[0]}"`, concept.id, variable.requirement.historical!.minProvRank)).map((r) => r.pid);
      const offered = await offerOpportunities(db, campaign, variables, members, contacts, new Rng(`variable:${campaignId}`), now, watchers);
      await db.run('UPDATE campaign SET eligible_n = ?, estimate_json = ? WHERE id = ?', ev.recontactBase, JSON.stringify({ ...estimate, contacts: Math.min(estimate.contacts, offered) }), campaignId);
      await db.run("UPDATE study SET updated_at = ? WHERE id = ?", now, study.id);
      for (const pid of watchers) {
        await logActivity(db, { participantId: pid, kind: 'demand', text: `Research needs your ${concept.name}: ${study.name} (${study.org_name}) is now collecting it`, amountCents: variable.compCents, occurredAt: now });
      }
      await logActivity(db, { orgId, kind: 'variable_request', text: `${study.name}: requested additional variable "${concept.name}"${isNew ? ' (new concept)' : ''} — ${offered.toLocaleString('en-US')} participants invited`, occurredAt: now });
      return { campaignId, slug: concept.slug, isNew, offered, watchersNotified: watchers.length };
    });
  return { ok: true, writeVersion: (await db.version()), campaign: await getCampaign(orgId, result.campaignId, db), conceptSlug: result.slug, isNewConcept: result.isNew, offered: result.offered, watchersNotified: result.watchersNotified };
}

