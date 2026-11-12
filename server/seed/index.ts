// Deterministic synthetic-data seed.
// Usage: tsx server/seed/index.ts [--force] [--scale 0.05] [--schema-only]
// Builds the dataset in an in-memory PGlite and publishes it (COPY) into the configured database — Supabase when a
// DATABASE_URL is set, else data/pglite (gitignored). All synthetic data comes from this directory only.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { Rng, DEFAULT_SEED } from '@shared/rng';
import { DEFAULT_CRITERIA } from '@shared/criteria';
import { flattenOntology } from '@shared/ontology';
import { PgDb, PgliteDb, type Db } from '../db/driver';
import { migrate } from '../db/migrate';
import { DATA_DIR, PGLITE_DIR, databaseUrl, directDatabaseUrl } from '../db/paths';
import { participantCount, publishSeed, restoreSnapshot, snapshotInfo } from './snapshot';
import type { SeedCtx } from './context';
import { seedAlex } from './alex';
import { seedPopulation } from './population';
import { seedMarketplace } from './marketplace';
import { finalizeCampaigns } from './finalize';
import { expectedFunnel, expectedTiles, FULL_TARGETS } from './tiers';
import { rebuildCoverage } from '../services/coverage';
import { evaluateCohort } from '../services/cohort';
import { ensureAnchors } from '../services/audit';

export type SeedOptions = { graph: Db; vault: Db; scale?: number; seed?: string; log?: (s: string) => void; schemaOnly?: boolean };
export type SeedReport = { ms: number; participants: number; funnel: number[]; expectedFunnel: number[]; tiles: { total: number; ehr1y: number; exome: number; recontact: number; recontactBase: number }; observations: number };

/** The canonical ontology predates every participant: concepts created later (variable requests, review "create branch") read as new in the tree. */
export const ONTOLOGY_GENESIS = '2023-01-01T00:00:00Z';

export async function seedConcepts(db: Db): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  await db.tx(async () => {
        for (const c of flattenOntology()) {
          const id = (await db.run(
                  'INSERT INTO concept (slug, parent_id, name, level, weight, unit, data_type, min_span_days, freshness_days, collection_method, enrichable, comp_cents, device_cost_cents, reuse_comp_cents, in_ring, in_list, sort_order, description, value_kind, synonyms_json, follow_ups_json, context_rule_json, is_variant, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)',
                  c.slug, c.parentSlug ? ids.get(c.parentSlug)! : null, c.name, c.level, c.weight, c.unit, c.dataType, c.minSpanDays, c.freshnessDays, c.method, c.enrichable ? 1 : 0,
                  c.compCents, c.deviceCostCents, c.reuseCompCents, c.inRing ? 1 : 0, c.inList ? 1 : 0, c.sortOrder, c.description,
                  c.valueKind, JSON.stringify(c.synonyms), c.followUps ? JSON.stringify(c.followUps) : null, c.contextRule ? JSON.stringify(c.contextRule) : null, ONTOLOGY_GENESIS,
                )).lastId;
          ids.set(c.slug, id);
        }
      });
  return ids;
}

/** Seeds into already-migrated databases. Used by the CLI and by tests (in-memory). */
export async function seedAll(opts: SeedOptions): Promise<SeedReport> {
  const t0 = performance.now();
  const rawLog = opts.log ?? (() => {});
  const log = (m: string) => rawLog(m.startsWith('[seed]') ? `${m}  (+${((performance.now() - t0) / 1000).toFixed(2)} s)` : m);
  const scale = opts.scale ?? 1;
  const ctx: SeedCtx = {
    graph: opts.graph, vault: opts.vault, rng: new Rng(opts.seed ?? DEFAULT_SEED), scale,
    concepts: new Map(), log, alexId: 0, studies: {}, campaigns: {}, orgs: {},
  };
  log('[seed] ontology');
  ctx.concepts = await seedConcepts(opts.graph);
  if (!opts.schemaOnly) {
    log('[seed] Alex');
    await seedAlex(ctx);
    await rebuildCoverage(ctx.alexId, opts.graph);
    log('[seed] population');
    const { tiers } = await seedPopulation(ctx);
    log('[seed] campaign estimates');
    await finalizeCampaigns(ctx);
    log('[seed] marketplace');
    await seedMarketplace(ctx);
    // every seeded ledger row / grant / license already appended its hash-chained audit_event; anchor each past day's Merkle root
    log(`[seed] audit anchors: ${await ensureAnchors(opts.graph)} days`);
    await opts.graph.exec('ANALYZE');

    const participants = await count(opts.graph, 'participant');
    const ev = await evaluateCohort(DEFAULT_CRITERIA, { orgId: ctx.orgs.biopharma, skipCache: true }, opts.graph);
    const funnel = ev.funnel.map((f) => f.n);
    const exp = expectedFunnel(tiers);
    const tilesExp = expectedTiles(tiers);
    const tiles = {
      total: participants,
      ehr1y: await scalar(opts.graph, "SELECT COUNT(*) AS n FROM participant_coverage c JOIN concept k ON k.id = c.concept_id WHERE k.slug = 'clinical.encounters.ehr_history' AND c.span_days >= 365"),
      exome: await scalar(opts.graph, "SELECT COUNT(*) AS n FROM participant_coverage c JOIN concept k ON k.id = c.concept_id WHERE k.slug = 'biology.genomics.exome' AND c.n_obs > 0"),
      recontact: await scalar(opts.graph, 'SELECT COUNT(*) AS n FROM consent_setting WHERE recontact_opt_in = 1'),
      recontactBase: ev.recontactBase,
    };
    const ms = performance.now() - t0;
    log(`[seed] done in ${(ms / 1000).toFixed(2)} s — ${participants.toLocaleString('en-US')} participants, ${(await count(opts.graph, 'observation')).toLocaleString('en-US')} observations`);
    log('[seed] funnel (query → expected):');
    ev.funnel.forEach((f, i) => log(`   ${f.label.padEnd(28)} ${String(f.n).padStart(8)}  ${String(exp[i]).padStart(8)}`));
    log(`[seed] tiles: EHR≥1y ${tiles.ehr1y} (exp ${tilesExp.ehr1y}) · exome ${tiles.exome} (exp ${tilesExp.exome}) · recontact ${tiles.recontact} (exp ${tilesExp.recontact}) · recontactable base ${tiles.recontactBase} (exp ${tilesExp.recontactBase})`);
    assertCounts(scale, funnel, exp, tiles, tilesExp);
    return { ms, participants, funnel, expectedFunnel: exp, tiles, observations: await count(opts.graph, 'observation') };
  }
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

async function count(db: Db, table: string): Promise<number> {
  return (await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))?.n ?? 0;
}
async function scalar(db: Db, sql: string): Promise<number> {
  return (await db.get<{ n: number }>(sql))?.n ?? 0;
}

// ---------------------------------------------------------------- CLI
/** The database to seed: the direct Postgres URL, else the pooled one (Supabase's direct host is IPv6-only, which some
 *  build machines cannot reach), else the local PGlite directory. */
async function openTarget(): Promise<Db> {
  const urls = Array.from(new Set([directDatabaseUrl(), databaseUrl()].filter((u): u is string => !!u)));
  if (!urls.length) {
    mkdirSync(DATA_DIR, { recursive: true });
    return await PgliteDb.open(PGLITE_DIR);
  }
  for (const url of urls) {
    const db = new PgDb(url, { max: 1 });
    try {
      await db.get('SELECT 1');
      console.log(`[seed] connected to ${db.label}`);
      return db;
    } catch (e) {
      console.warn(`[seed] cannot use ${db.label}: ${(e as Error).message}`);
      await db.close().catch(() => {});
    }
  }
  throw new Error('[seed] no reachable database');
}

function parseArgs(argv: string[]) {
  const scaleIx = argv.indexOf('--scale');
  const envScale = process.env.SEED_SCALE ? Number(process.env.SEED_SCALE) : 1;
  return {
    force: argv.includes('--force') || process.env.SEED_FORCE === '1',
    schemaOnly: argv.includes('--schema-only') || process.env.SEED_DISABLED === '1',
    scale: scaleIx >= 0 ? Number(argv[scaleIx + 1]) : envScale,
  };
}

/**
 * Seeds the configured database: Supabase when DATABASE_URL / POSTGRES_URL(_NON_POOLING) is set, else the local PGlite
 * under data/pglite. Skips a database that already holds a seed snapshot of the same scale unless --force (or SEED_FORCE=1).
 */
export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  if (!Number.isFinite(args.scale) || args.scale <= 0 || args.scale > 1) throw new Error('--scale must be in (0, 1]');
  const target = await openTarget();
  try {
    await migrate(target);
    const snap = await snapshotInfo(target);
    const live = await participantCount(target);
    const same = snap && snap.scale === args.scale && snap.schemaOnly === args.schemaOnly;
    if (!args.force && same && (live > 0 || args.schemaOnly)) {
      console.log(`[seed] ${target.label} already seeded (scale ${snap.scale}, ${live.toLocaleString('en-US')} participants) — pass --force to regenerate`);
      return;
    }
    if (!args.force && same && live === 0) {
      console.log(`[seed] ${target.label}: restoring the seed snapshot`);
      await restoreSnapshot(target);
      return;
    }
    const report = await publishSeed(target, { scale: args.scale, schemaOnly: args.schemaOnly, log: (s) => console.log(s) });
    console.log(`[seed] wrote ${target.label} (${args.schemaOnly ? 'schema only' : `scale ${args.scale}, ${report.participants.toLocaleString('en-US')} participants, ${(report.ms / 1000).toFixed(2)} s`})`);
  } finally {
    await target.close();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) runCli().catch((e) => { console.error(e); process.exit(1); });
