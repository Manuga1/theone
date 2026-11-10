// Leaf concepts for pickers and the quick-log preview, flattened from the participant's signature tree (which every API
// version serves and which carries the TreeNodeExtras: valueKind, isNew). No separate ontology probe: a 404 would show
// up as a browser console error and the e2e screens assert there are none.
import { useEffect, useState } from 'react';
import type { ParticipantSignature, TreeNode, ValueKind } from '@shared/api-types';
import { api, onChanged } from './api';

export type ConceptOption = { slug: string; name: string; path: string[]; valueKind?: ValueKind; level: TreeNode['level']; isNew?: boolean };

export function flattenLeaves(domains: TreeNode[]): ConceptOption[] {
  const out: ConceptOption[] = [];
  const walk = (n: TreeNode, path: string[]) => {
    const p = [...path, n.name];
    if (n.level === 'leaf' || n.children.length === 0) out.push({ slug: n.slug, name: n.name, path: p, valueKind: n.valueKind, level: n.level, isNew: n.isNew });
    else n.children.forEach((c) => walk(c, p));
  };
  domains.forEach((d) => walk(d, []));
  return out;
}

/** Group nodes (domain › group) — the parents a brand-new leaf can be created under from the inbox review box. */
export function flattenGroups(domains: TreeNode[]): ConceptOption[] {
  const out: ConceptOption[] = [];
  const walk = (n: TreeNode, path: string[]) => {
    const p = [...path, n.name];
    if (n.level === 'group' && n.children.length > 0) out.push({ slug: n.slug, name: n.name, path: p, level: n.level, isNew: n.isNew });
    n.children.forEach((c) => walk(c, p));
  };
  domains.forEach((d) => walk(d, []));
  return out;
}

export function useConcepts(): { concepts: ConceptOption[]; groups: ConceptOption[]; loading: boolean } {
  const [concepts, setConcepts] = useState<ConceptOption[]>([]);
  const [groups, setGroups] = useState<ConceptOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => onChanged(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.get<ParticipantSignature>('/participant/signature')
      .then((s) => { if (alive) { setConcepts(flattenLeaves(s.domains)); setGroups(flattenGroups(s.domains)); } })
      .catch(() => { if (alive) { setConcepts([]); setGroups([]); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [tick]);
  return { concepts, groups, loading };
}

const STOP = new Set(['the', 'a', 'an', 'and', 'of', 'my', 'i', 'to', 'at', 'in', 'on', 'this', 'last', 'had', 'have', 'was', 'is', 'it', 'for', 'with', 'today', 'morning', 'night', 'yesterday']);

/** Cheap client-side preview of where a phrase will be filed: token overlap with leaf names and slug segments.
 *  The server's classifier (rules or Claude) is authoritative; this only labels the "will be filed under …" hint. */
export function previewConcept(text: string, concepts: ConceptOption[]): { concept: ConceptOption; score: number } | null {
  const words = text.toLowerCase().replace(/[^a-z0-9/ ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));
  if (words.length === 0) return null;
  let best: { concept: ConceptOption; score: number } | null = null;
  for (const c of concepts) {
    const hay = new Set(`${c.name} ${c.slug.replace(/[._]/g, ' ')} ${c.path.join(' ')}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
    let score = 0;
    for (const w of words) {
      for (const h of hay) {
        if (h === w) score += 2;
        else if (h.length > 3 && w.length > 3 && (h.startsWith(w) || w.startsWith(h))) score += 1;
      }
    }
    if (score > 0 && (!best || score > best.score)) best = { concept: c, score };
  }
  return best;
}
