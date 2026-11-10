// Daily check-in (2026-11-10 notes: "daily check-in vs real-time voice logging" — both exist; the check-in asks for the
// daily leaves that have not been logged today). Answers are filed through the same pipeline as quick logs (ingest_item
// kind 'checkin' → fileItem → observation + reward), so a check-in answer and a voice log land in the same branch.
import { DEMO_TODAY, nowIso } from '@shared/clock';
import type { CheckIn, CheckInInput, CheckInPrompt, CheckInResult, IngestItem, Proposal, ValueKind } from '@shared/api-types';
import { normalise, parseMeasurement, resolveAnswer } from '@shared/branching';
import { graph } from '../db/graph';
import type { Db } from '../db/driver';
import { badRequest } from '../errors';
import { leafSpecs } from './classify';
import { fileItem, ingestRow, insertItem, toItem } from './ingest';
import { conceptBySlug, conceptPath, familyIds, type ConceptRow } from './ontology';
import { streakDays } from './rewards';

/** The daily leaves, in the order they are asked. Only leaves that exist in the concept table are offered. */
export const DAILY_PROMPTS: { slug: string; question: string }[] = [
  { slug: 'clinical.medications.adherence_today', question: 'Did you take your medications today?' },
  { slug: 'behavior.mood.daily_mood', question: 'How is your mood today, 1 (worst) to 5 (best)?' },
  { slug: 'behavior.sleep.bedtime_log', question: 'What time did you go to bed last night? (e.g. 23:15)' },
  { slug: 'behavior.exercise.session', question: 'Did you exercise today? What kind?' },
  { slug: 'behavior.nutrition.caffeine', question: 'Any caffeine today? What did you drink?' },
  { slug: 'behavior.tobacco.cigarettes', question: 'Did you smoke today? (brand, or "no")' },
  { slug: 'physiology.cardiovascular.blood_pressure', question: 'Home blood pressure reading? (e.g. 120/80)' },
  { slug: 'physiology.metabolic.weight', question: "Today's weight? (kg or lb)" },
];

const NEGATIVES = new Set(['no', 'none', 'n', 'nope', 'false', '0', 'skipped', 'not today', 'did not', "didn't"]);
const POSITIVES = new Set(['yes', 'y', 'true', '1', 'yep', 'took them', 'done']);

async function loggedToday(db: Db, participantId: number, c: ConceptRow): Promise<boolean> {
  const ids = await familyIds(c, db);
  return !!await db.get(`SELECT 1 FROM observation WHERE participant_id = ? AND deleted_at IS NULL AND substr(observed_at, 1, 10) = ? AND concept_id IN (${ids.map(() => '?').join(', ')}) LIMIT 1`, participantId, DEMO_TODAY, ...ids);
}
async function promptFor(c: ConceptRow, question: string, db: Db): Promise<CheckInPrompt> {
  const spec = (await leafSpecs(db)).find((l) => l.slug === c.slug);
  const fu = spec?.followUps[0];
  const valueKind: ValueKind = c.value_kind ?? 'text';
  const options = valueKind === 'boolean' ? ['yes', 'no'] : fu?.options ? [...fu.options, ...(fu.createsSubBranch ? ['none'] : [])] : undefined;
  return { id: c.slug, conceptSlug: c.slug, conceptName: c.name, question, valueKind, ...(options ? { options } : {}), unit: c.unit };
}

export async function getCheckIn(participantId: number, db: Db = graph()): Promise<CheckIn> {
  const day = await db.tableExists('checkin_day') ? await db.get<{ done: number; reward_cents: number }>('SELECT done, reward_cents FROM checkin_day WHERE participant_id = ? AND date = ?', participantId, DEMO_TODAY) : undefined;
  const prompts: CheckInPrompt[] = [];
  if (await db.tableExists('concept')) {
    for (const p of DAILY_PROMPTS) {
      const c = await conceptBySlug(p.slug, db);
      if (!c || c.level !== 'leaf' || await loggedToday(db, participantId, c)) continue;
      prompts.push((await promptFor(c, p.question, db)));
    }
  }
  return { date: DEMO_TODAY, done: !!day?.done, prompts, streakDays: await streakDays(participantId, db), rewardCents: day?.reward_cents ?? 0 };
}

type Answer = { id: string; value: string | number | boolean | null };

/** Build the proposal one answer files (no classifier: the prompt already names the branch). null → nothing to file. */
export async function proposalForAnswer(db: Db, c: ConceptRow, raw: Answer['value'], now: string): Promise<{ proposal: Proposal; text: string } | null> {
  if (raw === null || raw === undefined || (typeof raw === 'string' && !raw.trim())) return null;
  const spec = (await leafSpecs(db)).find((l) => l.slug === c.slug);
  const valueKind: ValueKind = c.value_kind ?? 'text';
  const text = typeof raw === 'boolean' ? (raw ? 'yes' : 'no') : String(raw).trim();
  const norm = normalise(text);
  const negative = typeof raw === 'boolean' ? !raw : NEGATIVES.has(norm);
  const base: Proposal = { conceptSlug: c.slug, conceptName: c.name, path: await conceptPath(c.slug, db), newConcept: null, confidence: 1, rationale: 'daily check-in answer', extracted: { valueText: text, observedAt: now, attributes: {}, context: null }, followUp: null, classifier: 'rules', alternatives: [] };
  const e = base.extracted;
  switch (valueKind) {
    case 'boolean':
      e.valueBool = !(negative || (!POSITIVES.has(norm) && typeof raw === 'string' && /\b(no|not|skip|forgot|missed)\b/.test(norm)));
      return { proposal: base, text };
    case 'categorical': {
      const fu = spec?.followUps[0];
      if (negative) { e.valueBool = false; e.valueNum = 0; return { proposal: base, text }; }
      if (fu && spec) {
        const numericOptions = !!fu.options?.length && fu.options.every((o) => /^\d+$/.test(o));
        if (numericOptions) {
          // a score (mood 1–5): the number itself, or an alias such as "good" → 4
          const direct = typeof raw === 'number' ? String(raw) : /^\d+$/.test(norm) ? norm : null;
          const value = direct && fu.options!.includes(direct) ? direct : resolveAnswer(spec, fu.attribute, text).value;
          if (!fu.options!.includes(value)) throw badRequest(`${c.name}: answer must be one of ${fu.options!.join(', ')}`);
          e.attributes![fu.attribute] = value;
          e.valueNum = Number(value);
        } else {
          // a drink / activity / brand: existing sub-branch, option alias or free text (→ new sub-branch); "2 espressos" keeps the count
          const hit = resolveAnswer(spec, fu.attribute, text);
          e.attributes![fu.attribute] = hit.value;
          const m = parseMeasurement(norm);
          if (m?.kind === 'value' && m.unit !== 'score') e.valueNum = m.value;
        }
      }
      return { proposal: base, text };
    }
    case 'continuous': case 'float': {
      if (negative) return null;
      if (typeof raw === 'number') { e.valueNum = raw; e.unit = c.unit; return { proposal: base, text }; }
      const clock = /^(\d{1,2})[:.h](\d{2})$/.exec(text);
      if (clock && c.unit === 'h') { e.valueNum = Math.round((Number(clock[1]) + Number(clock[2]) / 60) * 100) / 100; e.unit = 'h'; return { proposal: base, text }; }
      const m = parseMeasurement(norm);
      if (!m) return null;
      if (m.kind === 'bp') { e.valueNum = m.systolic; e.unit = 'mmHg'; e.attributes = { systolic: String(m.systolic), diastolic: String(m.diastolic) }; }
      else { e.valueNum = m.value; e.unit = c.unit ?? m.unit; if (m.rawUnit && m.rawUnit !== (e.unit ?? '')) e.attributes!.raw = `${m.rawValue} ${m.rawUnit}`; }
      return { proposal: base, text };
    }
    default:
      return { proposal: base, text };
  }
}

export async function submitCheckIn(participantId: number, input: CheckInInput, db: Db = graph()): Promise<CheckInResult> {
  const answers = Array.isArray(input?.answers) ? input.answers : null;
  if (!answers) throw badRequest('answers[] is required');
  const now = nowIso();
  return await db.tx(async () => {
      const items: IngestItem[] = [];
      let rewardCents = 0;
      const filedAnswers: Record<string, unknown> = {};
      for (const a of answers) {
        const c = a && typeof a.id === 'string' ? await conceptBySlug(a.id, db) : undefined;
        if (!c || c.level !== 'leaf' || !DAILY_PROMPTS.some((p) => p.slug === c.slug)) throw badRequest(`unknown check-in prompt ${String(a?.id)}`);
        const built = await proposalForAnswer(db, c, a.value, now);
        if (!built) continue;
        const id = await insertItem(db, participantId, { kind: 'checkin', status: 'auto_filed', text: `${c.name}: ${built.text}`, proposal: built.proposal, createdAt: now });
        const filed = await fileItem(db, participantId, id, 'checkin', built.proposal, { provenance: 'self_report', allowVariantCreate: true, classifier: 'rules', sourceText: built.text }, 'auto_filed', now);
        rewardCents += filed.rewardCents;
        filedAnswers[c.slug] = a.value;
        items.push((await toItem((await ingestRow(id, participantId, db))!, db)));
      }
      const prev = await db.get<{ reward_cents: number; answers_json: string | null }>('SELECT reward_cents, answers_json FROM checkin_day WHERE participant_id = ? AND date = ?', participantId, DEMO_TODAY);
      const merged = { ...(prev?.answers_json ? (JSON.parse(prev.answers_json) as Record<string, unknown>) : {}), ...filedAnswers };
      await db.run('INSERT INTO checkin_day (participant_id, date, done, reward_cents, answers_json, created_at) VALUES (?,?,1,?,?,?) ON CONFLICT(participant_id, date) DO UPDATE SET done = 1, reward_cents = checkin_day.reward_cents + excluded.reward_cents, answers_json = excluded.answers_json',
              participantId, DEMO_TODAY, rewardCents, JSON.stringify(merged), now);
      return { filed: items.length, rewardCents, streakDays: await streakDays(participantId, db), items };
    });
}
