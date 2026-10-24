# Demo walkthrough (click-by-click)

The script below is what `npm run test:e2e` (`e2e/loop.spec.ts`) drives in Chromium against the full seed, so it stays
green as the code moves. Start with `npm run dev` (seeds `data/` on the first run, ≈ 15 s) and open
<http://localhost:5173>. Every number named here is computed from `data/graph.sqlite`; none is typed into the client.

Fixed clock: today is **2026-10-24**. The header has the persona switch (participant ⇄ buyer), the buyer organisation
selector and **Reset demo** (wipes and reseeds in ≈ 15 s and returns you to the persona's home page).

## Part 1 — the participant at rest (Alex)

1. **P1 Home** (`/p`): four tiles (completeness, active licenses 4, lifetime earnings **$2,842.17**, open opportunities
   "up to $…"), the radial signature, "What changed".
2. **P2 Signature**: the concept tree — ✓ verified, ◐ partial, ○ missing; *Opportunity* pills on CGM and Grip strength;
   `$` where research is paying for a variable. Click **Blood Pressure** → **P3** (1,482 readings over 14 months,
   Verified, Data lineage tab).
3. **P5 Sources**: the eight connected sources; *Missing dimensions* lists Gut microbiome with **Notify me** already set.
4. **P6 Opportunities**: Available 4 / In progress 1 / Past 5. **P8 Earnings**: seven licenses + five contribution
   payments = $2,842.17; **Revoke** on any active license.

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

## Part 3 — the participant closes the loop

Switch persona → **View as participant** → **Opportunities**.

12. Two new cards sit at the top of *Available*:
    - **"<cohort name> — enrichment campaign"** — the launched campaign's **reuse-only offer**: *Reuses your EHR
      history, Exome, Blood Pressure, Food log*, no tasks. Alex is ready-now, so every variable is licensed, not
      collected: the fee is the EHR reuse fee plus the reuse fees of the three held collect-if-missing variables
      ($12 + $20 + $14 + $8.25 = **$54.25**). **I'm interested** → **Review consent** → **Accept** → the opportunity is
      *paid* immediately: a new Research License with four license lines and a $54.25 ledger row.
    - **Gut microbiome collection** — one kit task ($90). **I'm interested** → **Review consent** (what the sponsor
      receives / never receives, 12-month term, no future reuse, recontact only through the platform) → **Accept** → the
      reuse license row appears in Earnings; the task is *Pending*.
13. On the microbiome task click **Sync data** → *Verified*, "All tasks verified"; **Earnings** rose by exactly the task's
    net ($90.00) and P2 / P3 now show Gut microbiome as Verified.
14. **Earnings** → **Revoke** the microbiome license: the ledger row stays (marked *Revoked*), active licenses drop by one;
    the completed research is not undone (forward-only).

## Part 4 — the buyer sees it

Switch persona → **View as buyer** → the study.

15. **B7**: the child campaign shows Completed 1 / Quality 1 (rendered "<20" under the k-floor); **Open dataset** → **B8**
    carries a *Microbiome* row; tabs Missingness / Provenance / Longitudinal / Ontology; **Analyze in workspace**.
16. **Reset demo** in the header: wipes `data/`, reseeds in ≈ 15 s, returns to the home page; P8 is back at $2,842.17.

## If you set a mode to "Collect for all" instead

*Collect for all* re-measures everyone under the protocol, including the 611 ready-now members, so the ready-now set
of the campaign is empty and **no reuse-only offer exists** (B7 shows *Accepted 0* at launch). Alex then gets a
collection offer from the launched campaign instead — e.g. with blood pressure on *Collect for all*: a 14-day BP task
($110) plus the reuse fees of EHR, exome and food log — and it is paid after **Sync data** on the task, not at accept.
Held data never counts as present for a *Collect for all* variable on B7 / B8; only verified protocol contributions do.
