# Health Data Asset Platform — local working model

A runnable model of a participant-owned health data network: one **personal health graph** that serves two products.

- **Participant app** ("My Health Asset"): what data do I have, how complete is it, who used it, what did I earn, what can I add.
- **Buyer / researcher app** ("Research Workspace"): who has the data I need, where are the gaps, what would it cost to fill them, run the study, access the controlled dataset.

Everything on screen is a query over the same SQLite database. The flywheel from the founder brief runs end to end: **buyer question → cohort search → missing data → paid collection → richer asset → future value**.

This is a model, not a product: no real integrations (connecting MyChart, Apple Health, a BP cuff, etc. is simulated), no authentication beyond a persona switch, no diagnostics or risk scoring, no payments rails. See *Boundaries* below.

## Run it

Requires Node 22.13+ (uses the built-in `node:sqlite`; no native modules).

```bash
npm install
npm run dev        # seeds data/ on first run (~10 s), then API on :4000 and app on :5173
```

Open <http://localhost:5173>. The header has a **persona switch** (participant ⇄ buyer), a buyer **organisation selector**, and **Reset demo**.

| Script | What it does |
|---|---|
| `npm run dev` | Seed if `data/` is empty, then start API (tsx watch) and Vite together |
| `npm run seed` | Regenerate the full synthetic dataset (deterministic; ~10 s) |
| `npm run seed:small` | Same at 5 % scale (for quick runs) |
| `npm run data:wipe` | Delete every generated database file |
| `npm test` | Unit + API tests (in-memory DB, 5 % scale) |
| `npm run test:full` | Exact full-scale assertions (needs a full seed in `data/`) |
| `npm run test:e2e` | Playwright: screenshots of all screens + the browser flywheel |
| `npm run typecheck` | Server and client type checks |
| `npm run build` / `npm start` | Production build of the client, served by the API |

## Synthetic data, and how to remove it

All fake data lives in **`data/graph.sqlite` and `data/vault.sqlite`**, which are generated and gitignored. Nothing synthetic is committed, and the only code that produces it is `server/seed/`.

- `npm run data:wipe` deletes it. `npm run seed` regenerates it. The in-app **Reset demo** button does both.
- `SEED_DISABLED=1 npm run dev` (or `node scripts/ensure-seed.mjs --no-seed`) creates the schema only. The app runs against an empty database: participant pages show an empty state and buyer counts read zero. A test boots the API this way and asserts every route still answers.
- To remove generation entirely, delete `server/seed/` and the `ensure-seed` step from the `dev`/`start` scripts. Real data would enter through the same observation envelope (`observation` table) via connectors you write.

What the seed produces (deterministic from `SEED`, fixed clock `DEMO_TODAY = 2026-10-24`):

- **Alex**, 48, the one fully detailed participant: a 10-year history (hypertension 2016 → lisinopril 2018 → COVID 2021 → Apple Watch 2023 → exome and knee MRI 2024 → connected BP cuff and food tracking 2025 → metabolic research cohort 2026), 1,482 blood-pressure readings over 14 months, labs twice a year, nightly sleep, ~1,150 meal photos with derived nutrition, a VCF and a DICOM artifact, seven licenses and five contribution payments totalling $2,842.17, four open research opportunities.
- A **population of 128,420 pseudonymous participants** built from exact quotas, so the buyer funnel for the default cohort (age 40–65, US, type 2 diabetes + hypertension, HbA1c > 7, exome, EHR ≥ 3 y, BP ≥ 12 mo, nutrition ≥ 30 d) comes out of real filters as 128,420 → 18,422 → 8,912 → 6,820 → 3,408 → 2,140 → **611 ready now**.
- One buyer campaign already mid-flight (Example BioPharma's Metabolic Monitoring Study: 4,850 invited, 3,011 accepted, 2,421 completed) and a licensed dataset built from it. Alex's "$240 Metabolic Monitoring" offer is that same campaign.

## Architecture

```
shared/     contracts: api-types.ts (every endpoint's shape), ontology.ts (concept tree + completeness weights),
            requirement.ts (historical vs protocol semantics), criteria.ts (cohort filters, zod), pricing.ts, clock.ts, rng.ts
server/     Express 5 API over node:sqlite
  db/       schema.sql (25 STRICT tables), vault-schema.sql (identity, separate file), driver.ts (6-method wrapper, hand-rolled tx)
  seed/     alex.ts, population.ts (tiers/quotas), marketplace.ts (bulk campaign), reset.ts
  services/ completeness, timeline, cohort (single-pass preview), estimate, campaign + state machines, consent,
            governance, simulate (contributions, study advance), dataset, variables (request another variable), ledger
  routes/   participant.ts (sole importer of the vault), buyer.ts (identity guard + k-floor), demo.ts
client/     React 19 + Vite 8; components/ (radial signature, concept tree, funnel, heatmap, timeline…),
            participant/ and buyer/ screens
tests/      vitest unit + API tests; e2e/ Playwright
```

**The personal health graph.** A participant has four synchronized views over one event store: profile, timeline, expandable data graph, and consent/economic ledger. Every datum is a row in `observation` with the universal envelope: participant, concept, value/unit, timestamp or validity interval, source and acquisition method, provenance class and rank, verification, the original artifact, and a lineage link from derived rows (recognised foods, monthly trajectories) back to raw ones (the meal photo, the device reading).

**Ontology.** `shared/ontology.ts` is the canonical concept tree (nine domains → groups → leaves, e.g. `physiology.strength.grip_strength`). A dimension exists for everyone even where a participant has no data; empty nodes are future measurements. Each leaf carries a completeness weight, a minimum span, freshness, collection method, compensation, and whether buyers can fund it (`enrichable`). Requesting a variable that does not exist yet inserts a concept row.

**Node state.** A leaf is *verified* when it has data of provenance rank ≥ 2 spanning at least its minimum, fresh enough; *partial* when data exists but a test fails (e.g. self-report only); otherwise *missing*. Overlays mark *opportunity* (an open paid offer lists the leaf) and *demand* (an active campaign collects it). Group and domain percentages are weighted means, as-of a date, so "+6 % this month" is a real comparison.

**Identity.** Legal name, email, phone and date of birth live in `data/vault.sqlite`, opened only by the participant routes. Buyer responses pass an identity guard that rejects any direct or quasi-identifier key; buyers see participants only as study- or dataset-scoped hashed pseudonyms, with age bands and country, and aggregates under 20 render as "<20".

**Money.** Card amounts are net to the participant. One function computes gross = net / 0.9 and the 90/10 split. Every license and every verified contribution is an append-only ledger row. A license is created only when the participant accepts an offer; never at campaign launch.

**Requirements.** A campaign variable has a *historical* requirement (data already spanning ≥ N days at provenance ≥ rank) and/or a *protocol* requirement (a verified protocol collection of ≥ N days). The cohort funnel uses only the historical branch, so a 14-day protocol never satisfies "BP ≥ 12 months"; study completion accepts either. That keeps the funnel stable while completions move the study and dataset views.

**Governance.** Consent is visible and revocable, with the one limit from the brief: completed research cannot be undone. Revoking a license is forward-only (the member drops out of the next dataset version, ledger rows stay). Disconnecting a source or deleting a category soft-deletes observations and rebuilds coverage. Seven uses are red-lined for every participant (employment, credit, housing, insurance, advertising, criminal suspicion, political targeting); an organisation declaring one of them sees zero counts and cannot create campaigns.

## The loop, as the code runs it

1. **Buyer** defines a cohort (B2); every filter re-runs a single-pass evaluation over a temp table of the base population (funnel, missing-data matrix, coverage heatmap, bars; < 300 ms at full scale, cached by criteria hash + write version).
2. The **missing-data matrix** (B4) enumerates groups of participants lacking exactly one subset of the enrichable variables and estimates how many are recruitable (recontact opt-in, no category exclusion, no red-line conflict, no open offer).
3. **Expand cohort** (B6) turns a target N into contacts / expected acceptances / completions and four cost lines, using the constants in `shared/pricing.ts`.
4. **Launch** inserts an `offered` opportunity per contacted participant. Ready-now members get a reuse-only offer (license fee for existing data); others get collection tasks.
5. **Participant** reviews the consent panel (what they receive, what they do not, term, no future reuse, recontact only through the platform), accepts; the reuse license, its per-concept lines and the ledger row are written; contributions are created.
6. **Sync data** simulates the protocol (BP cuff 14 days, meal photos, CGM, grip dynamometer, microbiome kit, surveys), writes raw and derived observations with artifacts, verifies, pays, rebuilds coverage. The node flips to verified; the study counters and the dataset version move.
7. **Request additional variable** (B8) previews eligibility and cost for any concept, including a new one, creates a child campaign, offers it, and notifies participants who asked to be told ("Notify me"). Then steps 5–6 repeat.

`POST /api/buyer/studies/:id/advance {days}` moves the non-Alex population through the same state machines deterministically, so a demo can fast-forward a study.

## Demo walkthrough

See *DEMO.md* for the click-by-click script that the end-to-end test also runs.

## Deviations from the mockups (deliberate, documented)

- **Missing-data matrix side cells.** The deck's 829 / 1,403 / 917 cannot coexist with its own sequential funnel; the computed values are 1,529 / 697 / 571 (exome-only 622 matches).
- **Coverage bars** count any data for a variable, including data the running campaign has already collected, so BP and Diet read higher than the deck's pre-enrichment snapshot. The bars move as a campaign progresses, which is the point.
- **Estimated after enrichment** is derived (≈ 2,417–2,648) rather than typed (2,300–2,600).
- **"Up to $1,180"** on the home tile is computed from the actual cards ($1,855); the deck's number does not add up.
- Alex gains a 2024 type 2 diabetes diagnosis (HbA1c 7.2) so he matches the default cohort and the metabolic study.
- The swimlane shows the trailing six months (the deck labels Jan–Jun 2025, before Alex's BP cuff existed).
- The "request another variable" example uses gut microbiome rather than grip strength, so the rest-state screens still show grip strength as an open opportunity as the deck does.
- Red-line uses are fixed on for every participant; the brief allows participants to set them.

## Boundaries (intentionally out of scope)

Diagnostic recommendations, disease-risk scoring, automated discovery, biobank logistics, real integrations, crypto or token economics, live data auctions, individualized data-valuation algorithms, and the "personalized health signature" future concept. The 90/10 split is a hypothesis carried as a constant, not a validated economic model.
