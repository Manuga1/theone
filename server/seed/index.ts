// Deterministic synthetic-data seed.
// Usage: tsx server/seed/index.ts [--force] [--scale 0.05] [--schema-only]
// Writes data/graph.sqlite.tmp + data/vault.sqlite.tmp, applies the schema, seeds, then atomically renames into place.
// All synthetic data lives only in the generated files under data/ (gitignored).
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { Rng, DEFAULT_SEED } from '@shared/rng';
import { nowIso } from '@shared/clock';
import { DEFAULT_CRITERIA } from '@shared/criteria';
import { flattenOntology } from '@shared/ontology';
import { Db } from '../db/driver';
import { migrateGraph, migrateVault } from '../db/migrate';
import { DATA_DIR, GRAPH_PATH, VAULT_PATH } from '../db/paths';
import type { SeedCtx } from './context';
import { seedAlex } from './alex';
import { seedPopulation } from './population';
import { seedMarketplace } from './marketplace';
import { finalizeCampaigns } from './finalize';
import { expectedFunnel, expectedTiles, FULL_TARGETS } from './tiers';
import { rebuildCoverage } from '../services/coverage';
import { evaluateCohort } from '../services/cohort';

export type SeedOptions = { graph: Db; vault: Db; scale?: number; seed?: string; log?: (s: string) => void; schemaOnly?: boolean };
export type SeedReport = { ms: number; participants: number; funnel: number[]; expectedFunnel: number[]; tiles: { total: number; ehr1y: number; exome: number; recontact: number; recontactBase: number }; observations: number };

export function seedConcepts(db: Db): Map<string, number> {
  const ids = new Map<string, number>();
  const now = nowIso();
  db.tx(() => {
    for (const c of flattenOntology()) {
      const id = db.run(
        'INSERT INTO concept (slug, parent_id, name, level, weight, unit, data_type, min_span_days, freshness_days, collection_method, enrichable, comp_cents, device_cost_cents, in_ring, in_list, sort_order, description, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        c.slug, c.parentSlug ? ids.get(c.parentSlug)! : null, c.name, c.level, c.weight, c.unit, c.dataType, c.minSpanDays, c.freshnessDays, c.method, c.enrichable ? 1 : 0,
        c.compCents, c.deviceCostCents, c.inRing ? 1 : 0, c.inList ? 1 : 0, c.sortOrder, c.description, now,
      ).lastId;
      ids.set(c.slug, id);
    }
  });
  return ids;
}

/** Seeds into already-migrated databases. Used by the CLI and by tests (in-memory). */
export function seedAll(opts: SeedOptions): SeedReport {
  const t0 = performance.now();
  const rawLog = opts.log ?? (() => {});
  const log = (m: string) => rawLog(m.startsWith('[seed]') ? `${m}  (+${((performance.now() - t0) / 1000).toFixed(2)} s)` : m);
  const scale = opts.scale ?? 1;
  const ctx: SeedCtx = {
    graph: opts.graph, vault: opts.vault, rng: new Rng(opts.seed ?? DEFAULT_SEED), scale,
    concepts: new Map(), log, alexId: 0, studies: {}, campaigns: {}, orgs: {},
  };
  opts.graph.beginBulk();
  log('[seed] ontology');
  ctx.concepts = seedConcepts(opts.graph);
  if (!opts.schemaOnly) {
    log('[seed] Alex');
    seedAlex(ctx);
    rebuildCoverage(ctx.alexId, opts.graph);
    log('[seed] population');
    const { tiers } = seedPopulation(ctx);
    log('[seed] campaign estimates');
    finalizeCampaigns(ctx);
    log('[seed] marketplace');
    seedMarketplace(ctx);
    opts.graph.exec('ANALYZE');
    opts.graph.endBulk();

    const participants = count(opts.graph, 'participant');
    const ev = evaluateCohort(DEFAULT_CRITERIA, { orgId: ctx.orgs.biopharma, skipCache: true }, opts.graph);
    const funnel = ev.funnel.map((f) => f.n);
    const exp = expectedFunnel(tiers);
    const tilesExp = expectedTiles(tiers);
    const tiles = {
      total: participants,
      ehr1y: scalar(opts.graph, "SELECT COUNT(*) AS n FROM participant_coverage c JOIN concept k ON k.id = c.concept_id WHERE k.slug = 'clinical.encounters.ehr_history' AND c.span_days >= 365"),
      exome: scalar(opts.graph, "SELECT COUNT(*) AS n FROM participant_coverage c JOIN concept k ON k.id = c.concept_id WHERE k.slug = 'biology.genomics.exome' AND c.n_obs > 0"),
      recontact: scalar(opts.graph, 'SELECT COUNT(*) AS n FROM consent_setting WHERE recontact_opt_in = 1'),
      recontactBase: ev.recontactBase,
    };
    const ms = performance.now() - t0;
    log(`[seed] done in ${(ms / 1000).toFixed(2)} s — ${participants.toLocaleString('en-US')} participants, ${count(opts.graph, 'observation').toLocaleString('en-US')} observations`);
    log('[seed] funnel (query → expected):');
    ev.funnel.forEach((f, i) => log(`   ${f.label.padEnd(28)} ${String(f.n).padStart(8)}  ${String(exp[i]).padStart(8)}`));
    log(`[seed] tiles: EHR≥1y ${tiles.ehr1y} (exp ${tilesExp.ehr1y}) · exome ${tiles.exome} (exp ${tilesExp.exome}) · recontact ${tiles.recontact} (exp ${tilesExp.recontact}) · recontactable base ${tiles.recontactBase} (exp ${tilesExp.recontactBase})`);
    assertCounts(scale, funnel, exp, tiles, tilesExp);
    return { ms, participants, funnel, expectedFunnel: exp, tiles, observations: count(opts.graph, 'observation') };
  }
  opts.graph.endBulk();
  return { ms: performance.now() - t0, participants: 0, funnel: [], expectedFunnel: [], tiles: { total: 0, ehr1y: 0, exome: 0, recontact: 0, recontactBase: 0 }, observations: 0 };
}

function assertCounts(scale: number, funnel: number[], exp: number[], tiles: Record<string, number>, tilesExp: Record<string, number>): void {
  const check = (label: string, got: number, want: number) => {
    if (scale >= 1 ? got !== want : Math.abs(got - want) > Math.max(1, want * 0.01)) throw new Error(`[seed] ${label}: got ${got}, expected ${want}${scale >= 1 ? '' : ' (±1%)'}`);
  };
  funnel.forEach((n, i) => check(`funnel stage ${i}`, n, exp[i]));
  for (const k of ['ehr1y', 'exome', 'recontact', 'recontactBase']) check(k, tiles[k], tilesExp[k]);
  if (scale >= 1) {
    funnel.forEach((n, i) => check(`full-scale funnel stage ${i}`, n, FULL_TARGETS.funnel[i]));
    check('full-scale ehr1y', tiles.ehr1y, FULL_TARGETS.ehr1y);
    check('full-scale exome', tiles.exome, FULL_TARGETS.exome);
    check('full-scale recontact', tiles.recontact, FULL_TARGETS.recontact);
    check('full-scale recontactable base', tiles.recontactBase, FULL_TARGETS.recontactBase);
  }
}

function count(db: Db, table: string): number {
  return db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)?.n ?? 0;
}
function scalar(db: Db, sql: string): number {
  return db.get<{ n: number }>(sql)?.n ?? 0;
}

// ---------------------------------------------------------------- CLI
function parseArgs(argv: string[]) {
  const scaleIx = argv.indexOf('--scale');
  return {
    force: argv.includes('--force'),
    schemaOnly: argv.includes('--schema-only') || process.env.SEED_DISABLED === '1',
    scale: scaleIx >= 0 ? Number(argv[scaleIx + 1]) : 1,
  };
}

export function runCli(argv = process.argv.slice(2)): void {
  const args = parseArgs(argv);
  if (!Number.isFinite(args.scale) || args.scale <= 0 || args.scale > 1) throw new Error('--scale must be in (0, 1]');
  mkdirSync(DATA_DIR, { recursive: true });
  if (existsSync(GRAPH_PATH) && !args.force) {
    console.log(`[seed] ${GRAPH_PATH} exists — pass --force to regenerate`);
    return;
  }
  const tmpG = GRAPH_PATH + '.tmp';
  const tmpV = VAULT_PATH + '.tmp';
  for (const f of [tmpG, tmpV]) for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(f + suffix, { force: true });
  const graph = new Db(tmpG);
  const vault = new Db(tmpV);
  migrateGraph(graph);
  migrateVault(vault);
  const report = seedAll({ graph, vault, scale: args.scale, schemaOnly: args.schemaOnly, log: (s) => console.log(s) });
  graph.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  vault.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  graph.close();
  vault.close();
  for (const p of [GRAPH_PATH, VAULT_PATH]) for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(p + suffix, { force: true });
  renameSync(tmpG, GRAPH_PATH);
  renameSync(tmpV, VAULT_PATH);
  for (const f of [tmpG, tmpV]) for (const suffix of ['-wal', '-shm', '-journal']) rmSync(f + suffix, { force: true });
  console.log(`[seed] wrote ${GRAPH_PATH} and ${VAULT_PATH} (${args.schemaOnly ? 'schema only' : `scale ${args.scale}, ${(report.ms / 1000).toFixed(2)} s`})`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) runCli();
