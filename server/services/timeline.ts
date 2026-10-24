// Timeline events by category + a trailing-6-month swimlane (weekly buckets per lane) relative to DEMO_TODAY.
import { DEMO_TODAY, addDays } from '@shared/clock';
import type { ParticipantTimeline, SwimlanePoint, TimelineEvent } from '@shared/api-types';
import { graph } from '../db/graph';
import type { Db } from '../db/driver';
import { conceptBySlug } from './ontology';

export const CATEGORY_ORDER: { key: TimelineEvent['category']; label: string }[] = [
  { key: 'clinical', label: 'Clinical' },
  { key: 'labs', label: 'Labs' },
  { key: 'medications', label: 'Medications' },
  { key: 'imaging', label: 'Imaging' },
  { key: 'devices', label: 'Devices' },
  { key: 'genomics', label: 'Genomics' },
  { key: 'lifestyle', label: 'Lifestyle' },
  { key: 'research', label: 'Research' },
  { key: 'other', label: 'Other' },
];

type EventRow = { id: number; occurred_at: string; kind: string; category: TimelineEvent['category']; title: string; detail: string | null; slug: string | null };

export function timelineEvents(participantId: number, category: string | undefined, db: Db = graph()): TimelineEvent[] {
  if (!db.tableExists('event')) return [];
  const rows = category && category !== 'all'
    ? db.all<EventRow>('SELECT e.id, e.occurred_at, e.kind, e.category, e.title, e.detail, c.slug FROM event e LEFT JOIN concept c ON c.id = e.concept_id WHERE e.participant_id = ? AND e.category = ? ORDER BY e.occurred_at, e.id', participantId, category)
    : db.all<EventRow>('SELECT e.id, e.occurred_at, e.kind, e.category, e.title, e.detail, c.slug FROM event e LEFT JOIN concept c ON c.id = e.concept_id WHERE e.participant_id = ? ORDER BY e.occurred_at, e.id', participantId);
  return rows.map((r) => ({ id: r.id, date: r.occurred_at, kind: r.kind, category: r.category, title: r.title, detail: r.detail, conceptSlug: r.slug }));
}

export function timeline(participantId: number, category: string | undefined, db: Db = graph()): ParticipantTimeline {
  const all = timelineEvents(participantId, undefined, db);
  const counts = new Map<string, number>();
  for (const e of all) counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
  const categories: ParticipantTimeline['categories'] = [
    { key: 'all', label: 'All', n: all.length },
    ...CATEGORY_ORDER.filter((c) => (counts.get(c.key) ?? 0) > 0).map((c) => ({ key: c.key, label: c.label, n: counts.get(c.key) ?? 0 })),
  ];
  const events = category && category !== 'all' ? all.filter((e) => e.category === category) : all;
  return { categories, events, swimlane: swimlane(participantId, db) };
}

/** Trailing 6 months: weekly dots (value = weekly mean / count) and medication bars. */
export function swimlane(participantId: number, db: Db = graph()): ParticipantTimeline['swimlane'] {
  const to = DEMO_TODAY;
  const from = addDays(to, -182);
  const months: string[] = [];
  for (let d = from.slice(0, 7) + '-01'; d <= to; d = addDays(d, 32).slice(0, 7) + '-01') {
    months.push(new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }));
  }
  const weekly = (slug: string, agg: 'avg' | 'count'): SwimlanePoint[] => {
    const c = conceptBySlug(slug, db);
    if (!c || !db.tableExists('observation')) return [];
    const rows = db.all<{ wk: string; v: number }>(
      `SELECT MIN(substr(observed_at, 1, 10)) AS wk, ${agg === 'avg' ? 'AVG(value_num)' : 'COUNT(*)'} AS v
         FROM observation WHERE participant_id = ? AND concept_id = ? AND deleted_at IS NULL AND derivation IS NULL AND substr(observed_at, 1, 10) BETWEEN ? AND ?
        GROUP BY CAST((julianday(substr(observed_at, 1, 10)) - julianday(?)) / 7 AS INTEGER) ORDER BY wk`, participantId, c.id, from, to, from);
    return rows.map((r) => ({ date: r.wk, kind: 'dot' as const, value: Math.round(r.v * 10) / 10 }));
  };
  const bars = (slug: string, textLike: string): SwimlanePoint[] => {
    const c = conceptBySlug(slug, db);
    if (!c || !db.tableExists('observation')) return [];
    return db.all<{ f: string; t: string | null }>(
      `SELECT valid_from AS f, valid_to AS t FROM observation WHERE participant_id = ? AND concept_id = ? AND deleted_at IS NULL AND lower(value_text) LIKE ? AND (valid_to IS NULL OR valid_to >= ?) AND valid_from <= ? ORDER BY valid_from`,
      participantId, c.id, `%${textLike}%`, from, to)
      .map((r) => ({ date: r.f < from ? from : r.f, kind: 'bar' as const, barUntil: r.t && r.t < to ? r.t : to }));
  };
  // every lab draw in the window: one dot per draw date across the lab leaves (value = panels drawn that day)
  const labDraws = (): SwimlanePoint[] => {
    if (!db.tableExists('observation')) return [];
    return db.all<{ d: string; n: number }>(
      `SELECT substr(o.observed_at, 1, 10) AS d, COUNT(*) AS n FROM observation o JOIN concept k ON k.id = o.concept_id
        WHERE o.participant_id = ? AND k.slug LIKE 'clinical.labs.%' AND o.deleted_at IS NULL AND o.derivation IS NULL AND substr(o.observed_at, 1, 10) BETWEEN ? AND ?
        GROUP BY d ORDER BY d`, participantId, from, to).map((r) => ({ date: r.d, kind: 'dot' as const, value: r.n }));
  };
  const lanes = [
    { key: 'bp', label: 'BP', color: '#1d6ef5', points: weekly('physiology.cardiovascular.blood_pressure', 'avg') },
    { key: 'weight', label: 'Weight', color: '#16a34a', points: weekly('physiology.metabolic.weight', 'avg') },
    { key: 'sleep', label: 'Sleep', color: '#6366f1', points: weekly('physiology.sleep.sleep_duration', 'avg') },
    { key: 'exercise', label: 'Exercise', color: '#f59e0b', points: weekly('behavior.physical_activity.exercise_log', 'avg') },
    { key: 'lisinopril', label: 'Lisinopril', color: '#ef4444', points: bars('clinical.medications.medication_list', 'lisinopril') },
    { key: 'labs', label: 'Labs', color: '#8b5cf6', points: labDraws() },
    { key: 'meals', label: 'Meals', color: '#0ea5e9', points: weekly('behavior.nutrition.food_log', 'count') },
  ];
  return { window: { from, to }, months, lanes };
}
