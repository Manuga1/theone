// Does one participant satisfy a cohort's demographics + conditions + labs? (P6 "Likely match based on your profile")
import { DEMO_TODAY } from '@shared/clock';
import type { CohortCriteria } from '@shared/criteria';
import { graph } from '../db/graph';
import type { Db } from '../db/driver';
import { conceptBySlug } from './ontology';

const DEMO_YEAR = Number(DEMO_TODAY.slice(0, 4));

export function participantMatches(c: CohortCriteria, participantId: number, db: Db = graph()): boolean {
  const p = db.get<{ birth_year: number; sex: string; country: string }>('SELECT birth_year, sex, country FROM participant WHERE id = ?', participantId);
  if (!p) return false;
  const age = DEMO_YEAR - p.birth_year;
  const d = c.demographics;
  if (d.country && p.country !== d.country) return false;
  if (d.ageMin !== undefined && age < d.ageMin) return false;
  if (d.ageMax !== undefined && age > d.ageMax) return false;
  if (d.sex && d.sex !== 'any' && p.sex !== d.sex) return false;
  for (const slug of c.conditions) {
    const k = conceptBySlug(slug, db);
    if (!k) return false;
    if (!db.get("SELECT 1 FROM condition WHERE participant_id = ? AND concept_id = ? AND status = 'active'", participantId, k.id)) return false;
  }
  for (const l of c.labs) {
    const k = conceptBySlug(l.slug, db);
    if (!k) return false;
    const r = db.get<{ v: number | null }>('SELECT last_value_num AS v FROM participant_coverage WHERE participant_id = ? AND concept_id = ?', participantId, k.id);
    if (!r || r.v === null) return false;
    const ok = l.op === '>' ? r.v > l.value : l.op === '>=' ? r.v >= l.value : l.op === '<' ? r.v < l.value : r.v <= l.value;
    if (!ok) return false;
  }
  return true;
}
