# Health Data Asset Platform — local working model

A runnable model of a participant-owned health data network: one **personal health graph** that serves two products.

- **Participant app** ("My Health Asset"): what data do I have, how complete is it, who used it, what did I earn, what can I add.
- **Buyer / researcher app** ("Research Workspace"): who has the data I need, where are the gaps, what would it cost to fill them, run the study, access the controlled dataset.

Everything on screen is a query over the same SQLite database. The flywheel from the founder brief runs end to end: **buyer question → cohort search → missing data → paid collection → richer asset → future value**. The 2026-11-10 notes added the other half of the loop, how data gets *in*: a quick log (text or voice) and a folder upload that the graph files into the right branch by itself, sub-branches that open for a new brand, drink or activity, micro-rewards per log, a daily check-in, a vault-only mode, onboarding, an Apple Health `export.xml` import and a tamper-evident audit log.

This is a model, not a product: no real integrations (connecting MyChart, a BP cuff, etc. is simulated; Apple Health is a file import, not live sync), no authentication beyond a persona switch, no diagnostics or risk scoring, no payments rails, nothing on a blockchain. See *Boundaries* below.

## Run it

Requires Node 22.13+ (uses the built-in `node:sqlite`; no native modules).

```bash
npm install
npm run dev        # seeds data/ on first run (~15 s), then API on :4000 and app on :5173
```

Open <http://localhost:5173>. `/` is the public site (see *Go-to-market kit*); the product demo is at `/p` (participant) and `/b` (buyer). The demo header has a **persona switch** (participant ⇄ buyer) and a buyer **organisation selector**. **Reset demo**, **Advance 7 days** and the Admin and Analytics pages appear only in admin mode: open any demo page with `?admin` (locally) or `?admin=<DEMO_ADMIN_TOKEN>` (hosted).

| Script | What it does |
|---|---|
| `npm run dev` | Seed if `data/` is empty, then start API (tsx watch) and Vite together |
| `npm run seed` | Regenerate the full synthetic dataset (deterministic; ~15 s on a 4-core machine) |
| `npm run seed:small` | Same at 5 % scale (for quick runs) |
| `npm run data:wipe` | Delete every generated database file |
| `npm test` | Unit + API tests (in-memory DB, 5 % scale) |
| `npm run test:full` | Exact full-scale assertions (needs a full seed in `data/`) |
| `npm run test:e2e` | Playwright: screenshots of all screens (desktop + phone), the notes' logging flows, vault / onboarding / audit, the browser flywheel |
| `npm run typecheck` | Server and client type checks |
| `npm run build` / `npm start` | Production build of the client, served by the API |

Environment knobs: `CLASSIFIER=rules` forces the rule classifier (tests always set it; the Anthropic API is never called from tests); `ANTHROPIC_API_KEY` (or `ANTHROPIC_AUTH_TOKEN`) enables the Claude classifier for uploads and quick logs; `CLASSIFIER_MODEL` overrides the model (default `claude-opus-5-5`). See *Ingestion & branching*.

## Synthetic data, and how to remove it

All fake data lives in **`data/graph.sqlite` and `data/vault.sqlite`**, which are generated and gitignored. Nothing synthetic is committed, and the only code that produces it is `server/seed/`.

- `npm run data:wipe` deletes it. `npm run seed` regenerates it. The in-app **Reset demo** button (admin mode only) does both (≈ 15 s) and returns to the persona's home page.
- `DATA_DIR=/somewhere npm run dev` (or `GRAPH_DB=` / `VAULT_DB=`) keeps the databases elsewhere; the seed check, the seed CLI and the server all resolve the same path.
- `SEED_DISABLED=1 npm run dev` (or `node scripts/ensure-seed.mjs --no-seed`) creates the schema only. The app runs against an empty database: participant pages show an empty state and buyer counts read zero. A test boots the API this way and asserts every route still answers.
- To remove generation entirely, delete `server/seed/` and the `ensure-seed` step from the `dev`/`start` scripts. Real data would enter through the same observation envelope (`observation` table) via connectors you write.

What the seed produces (deterministic from `SEED`, fixed clock `DEMO_TODAY = 2026-10-24`):

- **Alex**, 48, the one fully detailed participant: a 10-year history (hypertension 2016 → lisinopril 2018 → COVID 2021 → Apple Watch 2023 → exome and knee MRI 2024 → connected BP cuff and food tracking 2025 → metabolic research cohort 2026), 1,482 blood-pressure readings over 14 months, labs twice a year, nightly sleep, ~1,150 meal photos with derived nutrition, a VCF and a DICOM artifact, seven licenses and five contribution payments totalling $2,842.17, four open research opportunities.
- A **population of 128,420 pseudonymous participants** built from exact quotas, so the buyer funnel for the default cohort (age 40–65, US, type 2 diabetes + hypertension, HbA1c > 7, exome, EHR ≥ 3 y, BP ≥ 12 mo, nutrition ≥ 30 d) comes out of real filters as 128,420 → 18,422 → 8,912 → 6,820 → 3,408 → 2,140 → **611 ready now**.
- One buyer campaign already mid-flight (Example BioPharma's Metabolic Monitoring Study: 4,850 invited, 3,011 accepted, 2,421 completed) and a licensed dataset built from it. Alex's "$240 Metabolic Monitoring" offer is that same campaign.
- Alex's logging history: two sub-branches the classifier opened (caffeine › drink › **espresso**, exercise › activity › **run**), a week of quick-log observations (adherence yes/no, mood 1–5, bedtime, a family-history fact with two versions), four ingestion items (a knee-MRI follow-up, a lunch photo and "two espressos this morning" auto-filed; "had a yerba mate after lunch" waiting for review because it proposes a new sub-branch), three reward rules ($1 per food photo funded by the Metabolic Monitoring Study, $0.25 per BP reading capped at $1/day by the platform, $5 per weekly survey funded by the Wearable Sleep Study), a 5-day check-in streak, an available Apple Health card, and a hash-chained audit log of every seeded ledger row, consent and license (16,944 events, one simulated Merkle anchor per past day). None of it moves the population numbers: participant-created branches have weight 0.

## Architecture

```
shared/     contracts: api-types.ts (every endpoint's shape), ontology.ts (concept tree + completeness weights, valueKind,
            synonyms, follow-ups, context rules), branching.ts (the pure decision tree: file router, text pipeline,
            type rules, confidence policy), requirement.ts (historical vs protocol semantics), criteria.ts (cohort
            filters, zod), pricing.ts, clock.ts, rng.ts
server/     Express 5 API over node:sqlite
  db/       schema.sql (30 STRICT tables), vault-schema.sql (identity, separate file), driver.ts (6-method wrapper,
            hand-rolled tx), migrate.ts (idempotent ALTERs + ontology sync for stale databases, run on open)
  seed/     alex.ts, alex-ingest.ts (sub-branches, inbox, reward rules, streak), alex-marketplace.ts, population.ts
            (tiers/quotas), marketplace.ts (bulk campaign), reset.ts
  services/ completeness, timeline, cohort (single-pass preview), estimate, campaign + state machines, consent,
            governance, simulate (contributions, study advance), dataset, variables (request another variable), ledger;
            classify (rules + Claude), ingest (queue, uploads, review, filing, variants, rewards), quicklog,
            appleHealth (export.xml parser), checkin, rewards, onboarding, permissions (vault mode), audit (hash
            chain, Merkle anchors, verify)
  routes/   participant.ts (sole importer of the vault), buyer.ts (identity guard + k-floor), demo.ts
client/     React 19 + Vite 8; components/ (radial signature, concept tree, funnel, heatmap, timeline, QuickLog,
            UploadDropzone, IngestQueue + ReviewBox, ConceptPicker, TypedViews…), participant/ (incl. Onboarding)
            and buyer/ screens; mobile-first shell (top bar + bottom nav ≤ 900 px)
tests/      vitest unit + API tests (fixtures/apple-health-sample.xml); e2e/ Playwright
docs/       branching-decision-tree.md, audit-chain-rewards-vault.md, storage-and-blockchain.md
```

**The personal health graph.** A participant has four synchronized views over one event store: profile, timeline, expandable data graph, and consent/economic ledger. Every datum is a row in `observation` with the universal envelope: participant, concept, value/unit, timestamp or validity interval, source and acquisition method, provenance class and rank, verification, the original artifact, and a lineage link from derived rows (recognised foods, monthly trajectories) back to raw ones (the meal photo, the device reading).

**Ontology.** `shared/ontology.ts` is the canonical concept tree (nine domains → groups → leaves, e.g. `physiology.strength.grip_strength`). A dimension exists for everyone even where a participant has no data; empty nodes are future measurements. Each leaf carries a completeness weight, a minimum span, freshness, collection method, compensation, and whether buyers can fund it (`enrichable`). Requesting a variable that does not exist yet inserts a concept row.

**Node state.** A leaf is *verified* when it has data of provenance rank ≥ 2 spanning at least its minimum, fresh enough; *partial* when data exists but a test fails (e.g. self-report only); otherwise *missing*. Overlays mark *opportunity* (an open paid offer lists the leaf) and *demand* (an active campaign collects it). Group and domain percentages are weighted means, as-of a date, so "+6 % this month" is a real comparison.

**Identity.** Legal name, email, phone and date of birth live in `data/vault.sqlite`, opened only by the participant routes. Buyer responses pass an identity guard that rejects any direct or quasi-identifier key; buyers see participants only as study- or dataset-scoped hashed pseudonyms, with age bands and country, and aggregates under 20 render as "<20".

**Money.** Card amounts are net to the participant. One function computes gross = net / 0.9 and the 90/10 split. Every license and every verified contribution is an append-only ledger row. A license is created only when the participant accepts an offer; never at campaign launch.

**Requirements.** A campaign variable has a *historical* requirement (data already spanning ≥ N days at provenance ≥ rank) and/or a *protocol* requirement (a verified protocol collection of ≥ N days). The cohort funnel uses only the historical branch, so a 14-day protocol never satisfies "BP ≥ 12 months"; study completion accepts either. That keeps the funnel stable while completions move the study and dataset views.

**Ingestion & branching (the notes' "sub-branching is the secret sauce").** Data enters through three doors besides the simulated connectors: a **quick log** (text, or a voice transcript from the Web Speech API), a **file / folder upload** (the browser fingerprints each file and posts only name, size, MIME type, SHA-256 and a short text sample; bytes never leave the device) and the **daily check-in**. Every input runs through the decision tree in `shared/branching.ts`, documented step by step in [docs/branching-decision-tree.md](docs/branching-decision-tree.md): data types are finite (`valueKind`: continuous, float, boolean, text, updatable one-time fact, categorical, file, photo); files route by MIME / extension / name (DICOM → imaging, VCF → genomics, `export.xml` → the Apple Health importer, CSV / JSON headers → the matching device variable, a photo whose name says meal / lunch / dinner → food log, a PDF mentioning a panel → labs, else encounter document); text is normalised, negation and time ("this morning", "last night", "at 8pm") and number + unit (120/80, 72 bpm, 180 lb, 7 h, 6.1 mmol/L) are extracted, and leaves are scored by synonym hits. Type rules then apply: a continuous leaf without a reading asks "What was the reading?"; a categorical leaf resolves its follow-up attribute from the text or asks ("I smoked a cigarette" → "What brand?"); an answer that is not an existing option **creates a sub-branch** (`behavior.tobacco.cigarettes.brand.marlboro`, a weight-0 `variant` concept under the leaf) and the next "another marlboro" files on it without asking; continuous data is bucketed by context (heart rate during a run is stored with `context: exercise` and also files an exercise session). Confidence ≥ 0.6 auto-files, below that the item waits in the **ingestion inbox** with the best alternatives (Accept / File under… / New branch… / Discard); a proposed *new* concept always waits for a person; after 200 accepted items on a leaf its threshold relaxes to 0.5 (the notes' "after ~200–300 examples"). Two classifiers produce the same `Proposal` shape: the deterministic **rules** engine always runs, and **Claude** (`@anthropic-ai/sdk`, `messages.parse` with the ontology as a cached system prompt and a zod output schema) is layered on top when a credential is configured, its answers validated against the ontology (an invented slug falls back to the rules). Enable it locally with `ANTHROPIC_API_KEY=… npm run dev` and on Vercel under *Settings → Environment Variables* (`ANTHROPIC_API_KEY`, optionally `CLASSIFIER_MODEL`); `CLASSIFIER=rules` forces the rules and `/api/demo/state` reports which one is active (the inbox header and each proposal name it). Each observation keeps `classification_json` ({classifier, confidence, ingestItemId}), so a node shows "N classified by rules · confidence 83 %" and the buyer's dataset provenance tab shows the classifier-filed share per variable.

**Rewards & check-in.** A `reward_rule` pays a fixed amount per filed item on a concept, with an optional daily cap, funded either by a campaign (named on the ledger row, e.g. *$1 per food photo — funded by Metabolic Monitoring Study*) or by the platform ($0.25 per BP reading, capped at $1/day). The payment is an ordinary `contribution_payment` ledger row through `postLedger` (gross = net / 0.9, 90/10 split) written in the same transaction as the observation, so Earnings shows it immediately, grouped per day with the other micro rewards. The **daily check-in** asks a few questions for leaves not yet logged today (adherence, mood, bedtime, exercise, caffeine, cigarettes, BP, weight); answers are parsed deterministically (never through the API) and filed like a quick log, including sub-branch creation ("yoga" → exercise › activity › yoga). The **streak** counts consecutive days ending today with at least one filed item or a completed check-in.

**Vault mode (the notes' "use it purely as a vault").** `PUT /api/participant/permissions { vaultOnly: true }` keeps everything stored, organised and verified but takes the participant out of the market: the opportunities list is empty with a reason, accepting an offer is refused (403), no reward rows are written, the cohort engine's recontact predicate excludes them (B1 "Available participants" and every recontact-based figure drop by one), and licenses already in term run to their end date. Home swaps the earnings / opportunity tiles for "Logged today" / "Vault mode". The toggle is an audit event. The seeded population has no vault-only participants, so the headline numbers stay exact.

**Onboarding.** `/p/onboarding` walks identity (read from the vault, confirmed, never written) → consent (red-lines, recontact, commercial use, per-category sharing) → mode (earn from research or vault only) → done, which stamps `participant.onboarded_at`. Every `/p/*` screen is gated on it; *Restart onboarding* on Profile clears the stamp. The current step is derived from the audit chain (each step is an `onboarding_*` event), so it survives a serverless cold start without a new table.

**Tamper-evident audit log.** Every governance and economic write — ledger rows, consent grants, license create / revoke, withdrawals, category deletes, source disconnects, permission changes including the vault toggle, review decisions that create a branch, onboarding steps — appends an `audit_event` row **in the same transaction** as the write. Each event's hash is `sha256(prev_hash | canonical JSON of {kind, refTable, refId, payload, at})`, the first `prev_hash` is `genesis`, and `POST /api/participant/audit/verify` re-hashes the whole chain (ok, or the first broken event id). Once a day a Merkle root of that day's hashes is written to `audit_anchor` with status *simulated*: production would publish that 32-byte root to a public chain — the data itself never goes on-chain. Earnings shows the chain head, Verify, the events and the anchors. [docs/audit-chain-rewards-vault.md](docs/audit-chain-rewards-vault.md) documents the implementation; [docs/storage-and-blockchain.md](docs/storage-and-blockchain.md) is the research note behind the decision (why encrypted patient data on a public chain is a permanent liability, what anchoring costs, what the founders actually want from "mint it on-chain").

**Apple Health import.** Live sync needs a native app, so the card on Data Sources imports the Health app's `export.xml` instead: the file is read in the browser and posted as text (≤ 25 MB in the demo), a streaming regex parser maps `HKQuantityTypeIdentifier` records (heart rate, resting heart rate, HRV, steps, body mass, blood pressure pairs, glucose, dietary energy, oxygen saturation) and `SleepAnalysis` to leaves with `connected_device` provenance, one artifact row records the import, and re-importing the same file skips duplicates by (concept, timestamp, value). `tests/fixtures/apple-health-sample.xml` is a 22-record sample.

**Governance.** Consent is visible and revocable, with the one limit from the brief: completed research cannot be undone. Revoking a license is forward-only (the member drops out of the next dataset version, ledger rows stay). Disconnecting a source or deleting a category soft-deletes observations and rebuilds coverage. Eleven uses are red-lined for every participant, from one list in `shared/ontology.ts` (`PROHIBITED_USES`): advertising, insurance underwriting, employment screening, law enforcement or immigration, re-identification, resale to data brokers, credit decisions, housing decisions, political targeting, litigation against participants, and gambling or other targeting of behavioural vulnerability. An organisation declaring one of them sees zero counts and cannot create campaigns, and a single campaign tagged with one is refused.

## The loop, as the code runs it

1. **Buyer** defines a cohort (B2); every filter re-runs a single-pass evaluation over a temp table of the base population (funnel, missing-data matrix, coverage heatmap, bars; < 300 ms at full scale, cached by criteria hash + write version).
2. The **missing-data matrix** (B4) enumerates groups of participants lacking exactly one subset of the enrichable variables and estimates how many are recruitable (recontact opt-in, no category exclusion, no red-line conflict, no open offer).
3. **Expand cohort** (B6) turns a target N into contacts / expected acceptances / completions and four cost lines, using the constants in `shared/pricing.ts`.
4. **Launch** inserts an `offered` opportunity per contacted participant. Ready-now members get a reuse-only offer (license fee for existing data); others get collection tasks. Each variable carries a mode: **Reuse existing** (license the data everyone already holds), **Collect if missing** (collect only from participants who lack it; license it — and pay the reuse fee — for the rest), **Collect for all** (re-measure everyone under the protocol; nothing held counts). A member's offer therefore prices the variables they must collect at the collection comp and everything reused at the reuse fee; a ready-now member under the default modes (EHR reuse + exome / BP / food log collect-if-missing) gets a reuse-only offer whose fee covers all four.
5. **Participant** reviews the consent panel (what they receive, what they do not, term, no future reuse, recontact only through the platform), accepts; the reuse license, its per-concept lines and the ledger row are written; contributions are created.
6. **Sync data** simulates the protocol (BP cuff 14 days, meal photos, CGM, grip dynamometer, microbiome kit, surveys), writes raw and derived observations with artifacts, verifies, pays, rebuilds coverage. The node flips to verified; the study counters and the dataset version move.
7. **Request additional variable** (B8) previews eligibility and cost for any concept, including a new one, creates a child campaign, offers it, and notifies participants who asked to be told ("Notify me"). Then steps 5–6 repeat.

`POST /api/buyer/studies/:id/advance {days}` moves the non-Alex population through the same state machines deterministically, so a demo can fast-forward a study.

## Demo walkthrough

See [DEMO.md](DEMO.md) for the click-by-click script that the end-to-end tests also run: Part 1 the participant at rest, Part 2 the buyer finds, fills and runs, **Part 3 — logging, uploads, vault** (`e2e/notes.spec.ts` + `e2e/stage2.spec.ts`: "I smoked a cigarette" → "What brand?" → a new sub-branch; a knee MRI and a lunch photo uploaded, the photo paid $1; a text the rules cannot place reviewed into a new branch; the Apple Health import; vault mode on and off; onboarding restarted; the audit chain verified), then Part 4 / 5 (`e2e/loop.spec.ts`): default cohort → funnel → gaps → expand with the **default modes** → proposal → launch → the participant's **reuse-only offer** (paid at accept) → the buyer requests gut microbiome → the participant accepts, syncs, revokes → the buyer's study and dataset move → Reset demo. It also says what changes if you set a mode to *Collect for all* instead (no reuse-only offer can exist; the participant gets a collection task instead).

## Deploy to Vercel

The repo ships a Vercel Build Output pipeline (`npm run build:vercel`, declared in `vercel.json`): the Vite client becomes static files, the whole API is bundled by esbuild into one serverless function, and the synthetic databases are generated **at build time** and shipped inside the function. On a cold start the function copies them to `/tmp` and works there.

1. On vercel.com choose **Add New → Project** and import `Manuga1/theone`.
2. Framework preset **Other**. The build command comes from `vercel.json`; leave Output Directory empty. Node.js 22.x (the default for new projects; see Settings → General if the build complains about `node:sqlite`).
3. **Deploy.** The first build takes about a minute (the seed is ~15 s of it).
4. Production deploys from `main`. Feature work happens on a branch and is fast-forwarded into `main` once CI is green.
5. Set `DEMO_ADMIN_TOKEN` under *Settings → Environment Variables*. Without it, Reset demo and Advance 7 days are refused for everyone on the hosted site.

The hosted demo always classifies by rules, so no typed text is sent to a model provider. `HOSTED_CLASSIFIER=claude` together with `ANTHROPIC_API_KEY` lifts that; do not set it before a data-processing agreement is in place and the consent and privacy notice disclose it.

Hosted caveats: every serverless instance has its own copy of the data, so what you change (accepting an offer, launching a campaign) lives on the instance that served you and is gone when it is recycled. **Reset demo** (admin mode, with the token) reseeds that instance (≈ 15 s, inside the 60 s function limit). The footer reads "Hosted demo" in this mode. Run live demos from a laptop (`npm run dev`) so nothing resets mid-call. Build-time knobs: `SEED_SCALE=0.2` for a smaller function and faster cold starts, `SEED_DISABLED=1` for a schema-only deployment. For a persistent multi-user deployment run `npm start` on an ordinary server where `data/` is a real disk.

## Go-to-market kit

The founders' plan for taking Padma to market lives in [docs/gtm/](docs/gtm/README.md): the plan itself, the alignment-call agenda, permission and outreach emails, the interview guide, the offer and pricing note, the registry notice, legal drafts for review, the dry-run and recontact-test protocols, the deck outline, the name check, and `targets.csv` (100 leads from ClinicalTrials.gov, PubMed and company research, ranked by track and priority).

**Public site.** `/` (what Padma is, two paths), `/researchers` (offers without prices, the money rule, one link into the demo), `/join` (the registry, no prices, no link into the demo), `/privacy` (the registry notice), `/protocols` and `/protocols/:slug` (three printable protocol sheets with a watermark and no population numbers). Every public page states that Padma is a student project with no enrolled participants yet, and that it is not affiliated with or endorsed by Vanderbilt.

**Demo honesty.** Every demo screen, at every width, shows "Simulated data. Not real people. Do not enter real health information." Every dollar figure in the participant demo is labelled illustrative. The quick log, upload, Apple Health import and check-in say they are demo-only.

**Build-time settings (Vercel → Settings → Environment Variables).** All optional; unset values show an honest "opens soon" state.

| Variable | Effect |
|---|---|
| `VITE_REGISTRY_FORM_URL` | Embeds the registry sign-up form on `/join` |
| `VITE_PILOT_FORM_URL` | Embeds the pilot-enquiry form on `/researchers` |
| `VITE_CONTACT_EMAIL` | Email fallback for both forms and the deletion contact on `/privacy` |
| `VITE_FOUNDERS` | Comma-separated founder names shown on `/privacy` |
| `DEMO_ADMIN_TOKEN` | Unlocks Reset demo and Advance 7 days on the hosted site via `?admin=<token>` |
| `HOSTED_CLASSIFIER` | Leave unset. `claude` sends typed demo text to a model provider |

The product name and the honest status wording live in one file, `shared/brand.ts`; change `BRAND.name` there if the name changes (see `docs/gtm/name-check.md`).

## Deviations from the mockups (deliberate, documented)

- **Missing-data matrix side cells.** The deck's 829 / 1,403 / 917 cannot coexist with its own sequential funnel; the computed values are 1,529 / 697 / 571 (exome-only 622 matches).
- **Coverage bars** count any data for a variable, including data the running campaign has already collected, so BP and Diet read higher than the deck's pre-enrichment snapshot. The bars move as a campaign progresses, which is the point.
- **Estimated after enrichment** is derived (≈ 2,417–2,648) rather than typed (2,300–2,600).
- **B6 cost lines** come out of `shared/pricing.ts` and the per-variable comps as ≈ $346k / $94k / $42k / $89k (total ≈ $571k) against the deck's $318k / $94k / $42k / $86k: the contact / acceptance / completion triple (4,850 / 2,920 / 2,560) and "6–8 weeks" match exactly, the compensation line is ≈ 9 % higher because the per-task comps are the ones the participant cards show. The estimate prices collection comps plus the reuse fees of *Reuse existing* variables; the reuse fees paid for *Collect if missing* variables a member already holds are charged at accept but not forecast (≈ +$46k at full scale).
- **"Up to $1,180"** on the home tile is computed from the actual cards ($1,855); the deck's number does not add up.
- Alex gains a 2024 type 2 diabetes diagnosis (HbA1c 7.2) so he matches the default cohort and the metabolic study.
- The swimlane shows the trailing six months (the deck labels Jan–Jun 2025, before Alex's BP cuff existed).
- The "request another variable" example uses gut microbiome rather than grip strength, so the rest-state screens still show grip strength as an open opportunity as the deck does.
- Red-line uses are fixed on for every participant; the brief allows participants to set them.
- **Notes (2026-11-10).** Patient data is stored as an append-only ledger with a hash chain and *simulated* daily Merkle anchors rather than minted on-chain (see docs/storage-and-blockchain.md). Classifier confidence is `best / (best + ½ · runner-up + ½)`, so one clean synonym hit scores 0.67 and a tie 0.5; a known free value found in text ("yerba mate") proposes the sub-branch for review, while an explicit follow-up answer or a predefined option creates it immediately. Participant-created branches are weight 0 and not enrichable, so completeness and buyer counts never move. Apple Health daily sums bucket on the UTC date; a night's sleep is attributed to the day it ends. Files are never stored — the model keeps metadata and a fingerprint only; `maxFileBytes` is 2 GiB (MRI / CT as the upper bound). The one global audit chain is verified end to end; anchors are immutable and not re-verified against recomputed roots.

## Boundaries (intentionally out of scope)

Diagnostic recommendations, disease-risk scoring, automated discovery, biobank logistics, real integrations (Apple Health is a file import; Siri / Alexa voice logging is the browser's Web Speech API with a text fallback), on-chain storage, crypto or token economics (the audit anchors are simulated; publishing a root to a public chain is a one-function change documented in docs/storage-and-blockchain.md), live data auctions, individualized data-valuation algorithms, and the "personalized health signature" future concept. The 90/10 split and the reward amounts ($1 per food photo) are hypotheses carried as constants, not validated economics.
