import type { BuyerSearch, SearchResult } from '@shared/api-types';
import { graph } from '../db/graph';
import type { Db } from '../db/driver';

export function buyerSearch(orgId: number, q: string, db: Db = graph()): BuyerSearch {
  const term = q.trim().toLowerCase();
  if (!term || !db.tableExists('concept')) return { results: [] };
  const like = `%${term.replace(/[%_]/g, '')}%`;
  const results: SearchResult[] = [];
  for (const r of db.all<{ slug: string; name: string; level: string; path: string }>(
    `SELECT c.slug, c.name, c.level, COALESCE(p.name, '') AS path FROM concept c LEFT JOIN concept p ON p.id = c.parent_id
      WHERE c.in_list = 1 AND (lower(c.name) LIKE ? OR c.slug LIKE ?) ORDER BY c.level = 'leaf' DESC, c.sort_order LIMIT 8`, like, like)) {
    results.push({ type: 'concept', id: r.slug, label: r.name, sub: r.path ? `${r.level} · ${r.path}` : r.level, href: `/b/cohorts/new?concept=${encodeURIComponent(r.slug)}` });
  }
  for (const r of db.all<{ id: number; name: string; created_at: string }>('SELECT id, name, created_at FROM cohort_definition WHERE buyer_org_id = ? AND lower(name) LIKE ? ORDER BY id DESC LIMIT 5', orgId, like)) {
    results.push({ type: 'cohort', id: r.id, label: r.name, sub: `Saved cohort · ${r.created_at.slice(0, 10)}`, href: `/b/cohorts/${r.id}/define` });
  }
  for (const r of db.all<{ id: number; name: string; status: string }>('SELECT id, name, status FROM study WHERE buyer_org_id = ? AND lower(name) LIKE ? ORDER BY id DESC LIMIT 5', orgId, like)) {
    results.push({ type: 'study', id: r.id, label: r.name, sub: `Study · ${r.status}`, href: `/b/studies/${r.id}` });
  }
  for (const r of db.all<{ id: number; name: string; version: number }>(
    'SELECT d.id, s.name, d.version FROM dataset d JOIN study s ON s.id = d.study_id WHERE s.buyer_org_id = ? AND lower(s.name) LIKE ? ORDER BY d.id DESC LIMIT 5', orgId, like)) {
    results.push({ type: 'dataset', id: r.id, label: `${r.name} dataset v${r.version}`, sub: 'Dataset', href: `/b/datasets/${r.id}` });
  }
  return { results };
}
