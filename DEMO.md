# Demo walkthrough (click-by-click)

The script below is what `npm run test:e2e` drives in Chromium against the full seed, so it stays green as the code
moves: `e2e/screens.spec.ts` captures every screen at rest (desktop and a 390 px phone pass), `e2e/notes.spec.ts` and
`e2e/stage2.spec.ts` run Part 3, `e2e/loop.spec.ts` runs Parts 4–5. Start with `npm run dev` (seeds `data/` on the first
run, ≈ 15 s) and open <http://localhost:5173>. Every number named here is computed from `data/graph.sqlite`; none is typed
into the client. On a phone-width window the participant app shows a top bar and a bottom nav instead of the sidebar.

Fixed clock: today is **2026-10-24**. Every demo screen carries a banner: "Simulated data. Not real people. Do not enter
real health information." Say so out loud in the first sentence of any demo. The header has the persona switch
(participant ⇄ buyer) and the buyer organisation selector. **Reset demo** and **Advance 7 days** appear only in admin
mode: open the page with `?admin` locally, or `?admin=<DEMO_ADMIN_TOKEN>` on the hosted site. Run live demos from a
laptop with `npm run dev`; the hosted demo can reset between server instances. For a 10-minute buyer version of this
script, see `docs/gtm/demo-script-10min.md`.

## Part 1 — the participant at rest (Alex)

1. **P1 Home** (`/p`): the **Quick log** box (text or the mic), the badges (**1 to review** — the inbox, **1 filed
   today**, a 5-day streak), four tiles (completeness 74 %, verified sources 12, lifetime earnings **$2,842.17**, open
   opportunities "up to $…"), the radial signature, the **Daily check-in** card (4 questions for leaves not logged today),
   "Logging rewards today", "What changed".
2. **P2 Signature**: the concept tree — ✓ verified, ◐ partial, ○ missing; a data-type glyph per leaf; *Opportunity* pills
   on CGM and Grip strength; `$` where research is paying for a variable. Open **Behavior**: *Caffeine* carries a
   sub-branch count (the seeded **espresso** sub-branch) and "6 hours ago". Click **Blood Pressure** → **P3** (1,482
   readings over 14 months, Verified, Data lineage tab); Caffeine → the sub-branch breakdown and "7 classified by rules".
3. **P5 Sources**: the upload dropzone (files, a folder, the camera), the **Ingestion inbox** — All 4 / Needs review 1 /
   Auto-filed 3, "classified by rules" (or Claude when a key is set), the knee-MRI follow-up, the lunch photo and "two
   espressos this morning" auto-filed, "had a yerba mate after lunch" waiting because it proposes a new sub-branch — the
   integration cards with health, and an **Apple Health (export.xml)** card with *Import export.xml*; *Missing
   dimensions* lists Gut microbiome with **Notify me** already set.
4. **P6 Opportunities**: Available 4 / In progress 1 / Past 5. **P8 Earnings**: seven licenses + five contribution
   payments = $2,842.17; **Revoke** on any active license; the **Logging rewards** card (three rules: $1 per food photo
   funded by the Metabolic Monitoring Study, $0.25 per BP reading capped at $1/day by the platform, $5 per weekly survey
   funded by the Wearable Sleep Study; 5-day streak); the **Tamper-evident log** card (head hash, **Verify**, 16,944
   events, one simulated Merkle anchor per past day). **Permissions**: the *Vault only* switch, off. **Profile**:
   *Restart onboarding*.

## Part 2 — the buyer finds, fills and runs

Switch persona → **View as buyer** (Example BioPharma).

5. **B2 Cohort builder** (`/b/cohorts/new`): the default criteria (age 40–65, US, T2D + hypertension, HbA1c > 7, exome,
   EHR ≥ 3 y, BP ≥ 12 mo, nutrition ≥ 30 d) preview **611 ready now** out of 128,420. Name it, **Save cohort**.
6. **B3 Funnel** (128,420 → 18,422 → 8,912 → 6,820 → 3,408 → 2,140 → 611) → **Expand Cohort**.
7. **B4 Where are the gaps?**: the missing-data matrix (nutrition only 1,529 · BP only 697 · exome only 622 · …) and the
   estimated cohort after enrichment → **Expand Cohort**.
8. **B6 Expand**: target 2,500 → **4,850 contacts / 2,920 accept / 2,560 complete, 6–8 weeks**, four cost lines.
   Each variable has a mode picker: EHR is **Reuse existing** (no protocol), exome / blood pressure / food log default to
   **Collect if missing** = *collect only from participants who lack it; reuse (and pay the fee) for the rest*.
   **Leave the defaults** for the recorded script and click **Create collection campaign**.
9. **Proposal**: variables with mode, requirement, comp and device cost → **Launch pilot**.
10. **B7 Study**: *Invited 5,420 (4,850 contacts + 570 reuse-only)* and *Accepted 113* right away — the 113 are
    ready-now members who pre-authorised reuse-only licenses (each got a license and a ledger row through the same
    accept path a person uses). Coverage bars read 100 % for all four variables over the started members: nothing was
    collected yet, everything they hold was licensed. Launch minted **no** license for anyone else.
11. **Request additional variable** → pick **Gut microbiome** (kit, 1 day) → the live estimate re-runs → **Request
    variable**. The study now lists a child campaign *Gut microbiome collection* and Alex, who asked to be notified, is
    among the invited.

## Part 3 — logging, uploads, vault

Switch persona → **View as participant** (`e2e/notes.spec.ts` and `e2e/stage2.spec.ts`; the order below is the one the
tests run, every step restores what it changed except the logged data, which **Reset demo** clears).

12. **Quick log a cigarette** (`/p`): type *I smoked a cigarette* — the preview line already says *Will be filed under
    Behavior › Tobacco › Cigarettes* — and press Enter. The leaf clears the threshold but its brand is missing, so the box
    asks **What brand?** ("a new brand creates its own sub-branch"). Answer *Marlboro* → toast *Filed under Behavior ›
    Tobacco › Cigarettes › marlboro (new branch)*. Log *another marlboro after dinner* → filed on the same sub-branch, no
    question asked. **Signature → Behavior**: *Cigarettes* now carries a sub-branch count and "just now"; click it → the
    node shows the **marlboro** sub-branch with a *new* badge and "2 classified by rules".
13. **Upload** (`/p/sources`): drop `knee_mri.dcm` and `lunch.jpg` on the dropzone (or *Choose files* / *Upload a
    folder* / *Take a photo*). Only name, size, type and a SHA-256 leave the browser. Toast: *2 files received: 2 filed
    automatically · +$1.00 reward*. The inbox lists the MRI as **Auto-filed → Imaging › MRI › MRI (musculoskeletal)** at
    90 % and the photo as **Food log** at 85 % with **$1.00**.
14. **Earnings**: lifetime earnings rose by exactly $1.00; *Licensed uses* notes "+$1.00 logging today"; the Logging
    rewards card shows *Food log · 1 · $1.00* against the Metabolic Monitoring Study; the ledger has a **Logging rewards ·
    1 item** day row — expand it: *Logging reward: Food log (per food photo)*, gross $1.11, platform fee $0.11 (the same
    90/10 split as a license).
15. **Review** (`/p`): log *temperature 38.5 C* — no synonym matches → toast *Sent to your inbox for review*; the Home
    badge reads **2 to review**. **Sources → Needs review (2)**: click the row → "No branch matched" → **New branch…**:
    name *Body temperature*, value kind *Continuous series*, unit *°C*, search *Vitals* and pick the **group** *Clinical ›
    Vitals & preventive* (a group parent creates a new variable; a variable parent creates a sub-branch of it) → **Create
    branch** → toast *new branch Clinical › Vitals & preventive › Body temperature*; the item moves to **Accepted**.
    **Signature → Clinical** shows *Body temperature* with a *new* badge, and *body temperature 37.2 °C* on the Quick log
    now files there without review.
16. **Apple Health** (`/p/sources`): on the Apple Health card click **Import export.xml** and pick an export (the repo's
    `tests/fixtures/apple-health-sample.xml` has 22 records) → toast *Apple Health: N of 22 records imported · Heart Rate …*,
    the card connects, an `export.xml` item sits in the inbox as auto-filed. Import the same file again: duplicates are
    skipped.
17. **Vault mode** (`/p/permissions`): switch **Vault only** on → toast, pill *On*. **Opportunities** shows the vault
    empty state instead of cards; **Home** shows the *Vault mode* badge and swaps the earnings / opportunity tiles for
    *Logged today* / *Vault mode*; Earnings → Logging rewards is disabled with the reason; as a buyer, B1's *Available
    participants* would read 128,419. Switch it back off → the four cards return. Each toggle is an audit event.
18. **Onboarding** (`/p/profile`): **Restart onboarding** → `/p/onboarding`; every `/p/*` screen now redirects there.
    Confirm identity (read from the vault, never written) → consent (red-lines, recontact, commercial use, categories) →
    mode (*Earn from research* or *Vault only*) → **Finish and open my health asset** → Home; Profile reads *completed*.
19. **Audit** (`/p/earnings`): **Verify** on the Tamper-evident log → *Chain intact: N events re-hashed from genesis*,
    status pill *intact*, the **Daily anchors** table (day, Merkle root, events, *simulated* — production would publish
    the root to a public chain; no patient data is ever on-chain).

## Part 4 — the participant closes the loop

**Opportunities**.

20. Two new cards sit at the top of *Available*:
    - **"<cohort name> — enrichment campaign"** — the launched campaign's **reuse-only offer**: *Reuses your EHR
      history, Exome, Blood Pressure, Food log*, no tasks. Alex is ready-now, so every variable is licensed, not
      collected: the fee is the EHR reuse fee plus the reuse fees of the three held collect-if-missing variables
      ($12 + $20 + $14 + $8.25 = **$54.25**). **I'm interested** → **Review consent** → **Accept** → the opportunity is
      *paid* immediately: a new Research License with four license lines and a $54.25 ledger row.
    - **Gut microbiome collection** — one kit task ($90). **I'm interested** → **Review consent** (what the sponsor
      receives / never receives, 12-month term, no future reuse, recontact only through the platform) → **Accept** → the
      reuse license row appears in Earnings; the task is *Pending*.
21. On the microbiome task click **Sync data** → *Verified*, "All tasks verified"; **Earnings** rose by exactly the task's
    net ($90.00) and P2 / P3 now show Gut microbiome as Verified.
22. **Earnings** → **Revoke** the microbiome license: the ledger row stays (marked *Revoked*), active licenses drop by one;
    the completed research is not undone (forward-only).

## Part 5 — the buyer sees it

Switch persona → **View as buyer** → the study.

23. **B7**: the child campaign shows Completed 1 / Quality 1 (rendered "<20" under the k-floor); **Open dataset** → **B8**
    carries a *Microbiome* row; tabs Missingness / Provenance / Longitudinal / Ontology; **Analyze in workspace**.
24. **Reset demo** in the header (admin mode): wipes `data/`, reseeds in ≈ 15 s, returns to the home page; P8 is back at $2,842.17.

## If you set a mode to "Collect for all" instead

*Collect for all* re-measures everyone under the protocol, including the 611 ready-now members, so the ready-now set
of the campaign is empty and **no reuse-only offer exists** (B7 shows *Accepted 0* at launch). Alex then gets a
collection offer from the launched campaign instead — e.g. with blood pressure on *Collect for all*: a 14-day BP task
($110) plus the reuse fees of EHR, exome and food log — and it is paid after **Sync data** on the task, not at accept.
Held data never counts as present for a *Collect for all* variable on B7 / B8; only verified protocol contributions do.
