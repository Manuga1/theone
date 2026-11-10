# Audit chain, logging rewards, check-in, vault mode, onboarding

Backend stage 2 of the 2026-11-10 founder notes (Maanas + Akash). Everything here is implemented in `server/services/{audit,rewards,checkin,onboarding,permissions}.ts` and wired into the existing economic/governance writers; the contract is the bottom section of `shared/api-types.ts`. The storage/blockchain research note (why we hash-chain and anchor instead of writing anything on-chain) is the separate `docs/storage-and-blockchain.md`; this file documents what the model actually does.

## 1. The audit chain (`audit_event`, `audit_anchor`)

The notes asked for patient data "stored as a ledger: updates append, old records preserved" and floated minting compressed data on-chain. The model keeps the *data* in the graph (observations already append: `one_time` facts close `valid_to`, nothing is overwritten) and makes the *governance and economic history* tamper-evident:

| Write | Where it is appended | `kind` |
|---|---|---|
| every ledger row (license fee, contribution payment, logging reward) | `ledger.postLedger()` — the only writer of `ledger_entry` | `ledger_license_fee`, `ledger_contribution_payment` |
| consent grant + license minted at accept (and by the bulk simulation) | `consent.enroll()` | `consent_granted`, `license_created` |
| withdraw / revoke | `governance.ts` | `enrollment_withdrawn`, `enrollment_revoked`, `license_revoked` |
| category delete | `governance.deleteCategory()` | `category_deleted` |
| source disconnect | `sources.disconnectSource()` | `source_disconnected` |
| permissions change; vault toggle | `permissions.updatePermissions()` | `permissions_changed`, `vault_mode_changed` |
| a branch created from review, a quick log or a check-in answer (variant or new leaf) | `ingest.auditBranch()` | `branch_created` |
| onboarding steps | `onboarding.ts` | `onboarding_identity` / `_consent` / `_mode` / `_completed` / `_restarted` |

Rules:

- The event is inserted **inside the same transaction** as the write it describes (`db.tx`): either both commit or neither.
- `hash = sha256(prev_hash + '|' + canonicalJson({ kind, refTable, refId, payload, at }))`; keys are sorted recursively; the first `prev_hash` is the literal `genesis`. One global chain (ids are the order).
- `POST /participant/audit/verify` recomputes every hash from genesis and reports `brokenAt` = the first row whose `prev_hash` or `hash` does not match (editing a payload, or deleting a row, breaks there). The ledger page shows the head hash and the verification result; `GET /participant/audit` returns the participant's own events (newest first), the global head, the anchors and a fresh verification.
- **Anchors**: for every past day with events, `audit_anchor` holds the Merkle root of that day's hashes (pairwise sha256, odd leaf duplicated), `status = 'simulated'`, with a note that production would publish that root — only the root — to a public chain. Today's root is anchored at the end of the day; anchors are never rewritten. The seed builds the chain for every seeded ledger row, grant, license and sub-branch deterministically (full scale: 16,944 events, 91 anchors, verify ≈ 0.3 s).

## 2. Logging rewards (`reward_rule`)

"The incentive must exceed the activation energy — e.g. earn $1 per food photo." A `reward_rule` names a leaf, the cents per filed item, an optional daily cap and who funds it (`campaign` + study, or `platform`). When an ingest item is filed on that leaf (quick log, voice, upload, photo, check-in answer, review accept), `ingest.grantReward()` posts a `contribution_payment` ledger row through `postLedger` (90/10 via `fromNet`, so a 25¢ reward is a 28¢ gross row) with the memo `Logging reward: <leaf> (<per unit>) — funded by <study | the platform>`, respecting the daily cap (`Σ reward_cents` of today's items on that leaf) and never in vault mode. The ledger read groups reward rows per day (`LedgerExtras.groups`) and reports `rewardsToday`.

Seeded for Alex: $1 per food photo (Metabolic Monitoring Study), $0.25 per BP reading capped at $1/day (platform), $5 per weekly survey (Wearable Sleep Study). No reward rows are seeded, so lifetime earnings stay exactly $2,842.17.

`GET /participant/rewards` → rules with today's count/cents, today/week totals, the streak. **Streak** = consecutive days ending today with ≥ 1 filed item or a completed check-in; a day with no activity yet does not break a streak that ran up to yesterday. Seeded: check-ins 10-20 … 10-23 + today's filed quick log → 5.

## 3. Daily check-in (`checkin_day`)

`GET /participant/checkin` asks for the daily leaves (`DAILY_PROMPTS` in `checkin.ts`: medications taken, mood 1–5, bedtime, exercise, caffeine, cigarettes, home BP, weight) that have **no observation today** (leaf or its sub-branches). Each prompt carries the leaf's `valueKind`, options (boolean → yes/no; categorical → the follow-up options + `none`) and unit. `POST /participant/checkin { answers }` files each answer as an ingest item of kind `checkin` through the same `fileItem` as a quick log — so an answer and a voice log land in the same branch, earn the same reward and may create the same sub-branch (answering "yoga" to the exercise prompt creates `behavior.exercise.session.activity.yoga`). Answers are parsed deterministically (no classifier): booleans, scores, `23:15` → 23.25 h, `182 lb` → 82.6 kg, `120/80`; `no`/`none` on a categorical files a "none" row, on a numeric leaf files nothing. The day row is upserted (`done = 1`, reward cents accumulated, answers kept).

## 4. Vault mode (`consent_setting.vault_only`)

"Users can opt to use it purely as a vault, no data selling." `PUT /participant/permissions { vaultOnly: true }`:

- `GET /opportunities` → empty with `disabledReason`; the home tile reads 0 offers; accept → **403** (the vault check sits in `consentCheck`, so the bulk simulation respects it too).
- `grantReward()` returns 0; `GET /rewards` reports `enabled: false` + reason.
- Buyer side: the cohort engine's consent predicate treats a vault-only participant as not recontactable (`VAULT_AWARE_RECONTACT` in `cohort.ts`, also in the `requireRecontact` funnel filter); B1 tiles and variable-request watcher notifications exclude them. The seeded population has none, so every seeded count is unchanged.
- The toggle appends `vault_mode_changed` (only on an actual change) and an activity row. Data, past licenses and the ledger are untouched — vault mode is forward-only, like every other governance control.

## 5. Onboarding (`participant.onboarded_at`)

Steps identity → consent → mode → done. The only durable flag is `onboarded_at`; the current step is derived from the last `onboarding_*` audit event since the last restart (identity confirmed → consent; consent chosen → mode; mode chosen → done screen). `consent` writes the permissions (`updatePermissions`, itself audited); `mode` sets vault mode; `done` stamps `onboarded_at`; `restart` clears it (data, consents and licenses untouched) — the client gates `/p/*` on `HomeExtras.onboardingCompleted`. Identity is read from the vault by the route (the only vault importer) and passed into the service; it is never written by onboarding.

## 6. Other additive read-side fields

- `HomeExtras.checkIn { done, promptCount, streakDays }`, `HomeExtras.rewardsToday { cents, count }`.
- `LedgerExtras { rewardsToday, audit: { headHash, ok, events }, groups[] }`.
- `SourceCardExtras { kindGroup, health, errorText, importFormats }`: `health` is `never_synced` (available / never synced), `needs_attention` (disconnected, or a continuous source — records, labs, wearable, nutrition, device — with no sync for > 30 days), else `ok`. A seeded, available **Apple Health** card offers `export.xml`; the first import connects it.
- Buyer: `Dataset.provenance[].classified { pct, meanConfidence, classifier }` = share of the dataset members' observations of that variable filed by the ingestion classifier; `GET /buyer/ontology` marks leaves created in the last 30 days `isNew`.
