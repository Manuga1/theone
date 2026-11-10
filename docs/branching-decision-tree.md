# Branching decision tree — where new data goes

The notes of 2026-11-10 asked for "the full decision tree covering all data types with sub-branching rules": the system
should know where to place new data automatically ("I smoked a cigarette" → "what brand?"; a new brand creates a new
sub-branch; heart rate during a run is bucketed under exercise, not resting vitals), with an LLM layer for validation
and a review queue for genuinely new data points. This document is the tree as implemented. The rules are data + pure
functions in `shared/branching.ts` (unit-tested in `tests/unit/branching.test.ts`, 40+ phrases and file names); the
server's classifier (`server/services/classify.ts`) runs them for every upload and quick log and, when an Anthropic
credential is configured, layers Claude on top using the same ontology and the same output contract.

```
input
├── file upload ───────────────────────► 1. file router (MIME / extension / name / text sample)
├── quick log, voice transcript ───────► 2. text pipeline
└── check-in answer ───────────────────► 2. text pipeline (stage 2)
                                           │
                                           ▼
                                   3. type rules (by the leaf's valueKind)
                                           │
                                           ▼
                                   4. confidence policy ──► auto_filed | follow_up | needs_review
                                           │
                                           ▼
                                   5. filing (variants, one_time versions, context side-effects, rewards hook)
                                           │
                                           ▼
                                   6. review queue (accept / move / create branch / discard)
```

## 0. Data types are finite: `valueKind`

Every leaf of the ontology (`shared/ontology.ts`) declares how its values behave. This is the "finite set of data
types" from the notes; it drives both ingestion and rendering (P3 node detail picks its renderer from it).

| valueKind | meaning | storage | examples |
|---|---|---|---|
| `continuous` | repeated numeric readings over time | `value_num` + unit, `attributes.context` when a context rule applies | heart rate, BP, weight, sleep, steps, glucose, bedtime |
| `float` | a numeric measurement taken occasionally | `value_num` + unit | HbA1c, lipid panel, grip strength, VO2 max |
| `boolean` | yes/no per day | `value_num` 1/0, text verbatim | medications taken today |
| `text` | free text, stored verbatim | `value_text` | food log entry, symptom note, mood note |
| `one_time` | an updatable fact; **updates append**, the previous row's `valid_to` closes, nothing is overwritten | `value_text`/`value_num`, `valid_from`, `valid_to` | age, sex, family history, medication list, dietary pattern, occupation |
| `categorical` | a value with a follow-up attribute that forms **sub-branches** | observation filed on the variant concept, `attributes.<attribute>` | cigarettes (brand), caffeine (drink), exercise session (activity), daily mood (score) |
| `file` | a file artifact (metadata only; bytes are never stored) | artifact row + a text observation | MRI, VCF, lab PDF, clinical document |
| `photo` | a photo that a model later derives values from | artifact row + text observation (photo_derived) | meal photos |

Each leaf also carries `synonyms` (rule-classifier keywords), optional `followUps` (the question to ask, options, aliases,
known free values, `createsSubBranch`) and an optional `contextRule` (continuous leaves bucketed by context).

Leaves added for the notes' examples (all weight 0, so completeness and the seeded cohort counts are unchanged):
`behavior.tobacco.cigarettes` (categorical › brand), `behavior.nutrition.caffeine` (categorical › drink),
`behavior.exercise.session` (categorical › activity), `behavior.mood.daily_mood` (categorical, score 1–5),
`behavior.sleep.bedtime_log` (continuous), `clinical.medications.adherence_today` (boolean),
`family.history.conditions` (one_time), `clinical.encounters.document` (file). `physiology.metabolic.glucose` reads as
continuous.

## 1. File router (`routeFile`)

Files are **metadata only**: name, size, MIME, sha256 and an optional text sample. Max size 2 GiB (MRI / CT studies are
the upper bound); larger files and executables are rejected with a reason. Rules, in order:

| signal | route | provenance | confidence |
|---|---|---|---|
| `export.xml` / name contains apple + health + export (xml or zip) | **Apple Health importer** (`POST /import/apple-health`) | connected_device | — |
| `.dcm .dicom .nii .nii.gz`, DICOM MIME, or name/sample says MRI / CT / x-ray / DICOM / scan / DEXA | `imaging.*`: a body-region or modality keyword picks the leaf (knee/shoulder/spine → MRI musculoskeletal; brain/head → MRI brain; chest/x-ray/CT → chest X-ray; retina → retinal scan; DEXA → DEXA) | clinical_source | 0.9 when one leaf wins, else **needs review: "which modality / body region?"** with the imaging leaves as alternatives |
| `.vcf` / `.vcf.gz` | `biology.genomics.exome`; a name saying **genome** (not exome) proposes a new leaf *Genome* under Genomics → review | clinical_source | 0.9 / 0.7 (new concept → review) |
| `.csv` / `.json` with a recognisable header (systolic, hrv, heart_rate, steps, sleep, cgm/dexcom, glucose, weight/body_mass, spo2, kcal) | the matching leaf | connected_device | 0.9; no recognisable header → review |
| `image/*` | name/caption with meal, lunch, dinner, breakfast, food, snack, … → `behavior.nutrition.food_log` | photo_derived | 0.85; otherwise **needs review: "what is this photo of?"** (food log / retinal scan / document as alternatives) |
| `application/pdf` with lab wording (lab, result, panel, HbA1c, LDL, cholesterol, glucose, reference range, Quest, LabCorp) | the lab leaf whose synonyms match best (HbA1c / lipid panel / metabolic panel / CBC) | clinical_source | 0.9; several panels tie → review "which panel?" |
| other PDF | `clinical.encounters.document` | clinical_source | 0.7 |
| `.txt` / `text/*` | the text pipeline over the sample | self_report | as classified |
| anything else | needs review: "unrecognised file type — where should it go?" | — | 0.4 |

Examples: `knee-mri-followup-2026-10-18.zip` (388 MB) → Imaging › MRI › MRI (musculoskeletal), auto-filed, a `dicom`
artifact row with the sha256 and size. `scan.dcm` → review, alternatives listed. `exome.vcf.gz` → Exome.
`alex-genome.vcf` → review with a *Genome* proposal. `lunch-2026-10-23.jpg` → Food log (photo-derived).
`IMG_0042.jpg` → review. `quest-results.pdf` with "Lipid panel LDL 128" → Lipid panel. `referral-letter.pdf` →
Clinical document.

## 2. Text pipeline (`classifyText`)

1. **Normalise**: lower-case, number words → digits ("two espressos" → "2 espressos"), thousands separators removed
   ("10,000 steps"), "a cigarette" → "1 cigarette".
2. **Negation**: didn't / did not / no / not / never / skipped / without / forgot / missed / none.
3. **Time** (relative to the fixed demo clock, 2026-10-24 14:00Z): "this morning" 08:00, "last night" previous day
   22:00, "yesterday" 12:00, "this afternoon" 15:00, "tonight" 20:00, "before breakfast" 07:30, "after lunch" 13:30,
   "after dinner" 20:00, "before bed" 22:30, "N days ago", clock times ("at 8pm", "11:30pm", "07:45"). A clock time later
   than now rolls back one day ("went to bed at 11:30pm" logged at 14:00 → last night). Default: now.
4. **Number + unit**: `120/80` or `135 over 88` → systolic/diastolic mmHg; `72 bpm`; `180 lb` → 81.6 kg; `82 kg`;
   `6.1 mmol/L` → 110 mg/dL; `110 mg/dL`; `7 h` / `7 hours`; `10,000 steps`, `10k steps`; `42 ms`; `45 min`; `95 %`;
   `430 kcal`; `5 km`; counts (`2 espressos`, `3 beers`, `1 cigarette`); `4/5` scores; else a bare number. The original
   value and unit are kept in `attributes.raw` when converted.
5. **Score every leaf**: +1 per synonym hit (+0.5 per extra word of a phrase, so "heart rate" > "hr"), +1 per existing
   variant value ("espresso"), +1 per known free value ("marlboro"), +0.5 per option alias ("latte"); a BP pair gives
   +2 to mmHg leaves; a unit that fits the leaf gives +1.5 (specific units such as bpm / kg / mg/dL / steps / ms even
   without a keyword); a bare number gives +0.5 to a numeric leaf that already matched; a unit that does not fit a
   numeric leaf costs −0.5. **A quick log is a self-report**, so record-, lab- and derivation-fed concepts (EHR, labs,
   clinic blood pressure) score −0.5: "120/80" files as home blood pressure, not clinic blood pressure.
6. **Confidence** = best / (best + ½·runner-up + ½), capped at 0.98: one clean hit → 0.67, a tie → 0.5, a keyword plus
   a fitting unit → ≥ 0.8. The three runners-up are returned as alternatives for the review screen.

## 3. Type rules (`classifyText`, `applyAnswer`)

| valueKind | rule |
|---|---|
| continuous / float | needs a value; without one → follow-up `{ attribute: "value", question: "What was the reading (unit)?" }`. Negated ("didn't weigh myself") → stored as *none*. A context rule (heart rate) stores `attributes.context` ∈ rest / exercise / sleep from the wording (run/workout/gym/… → exercise; sleeping/asleep/overnight → sleep) and, for exercise, **also files an exercise session** (`behavior.exercise.session`, its activity resolved from the same text). Bedtime takes the clock time as its value (23.5 h). |
| boolean | true unless negated ("took my meds" → Yes, "skipped my metformin" → No). |
| text / photo / file | stored verbatim. |
| one_time | appends a new version with `valid_from`; the previous open row's `valid_to` closes. The node's History tab shows every version. |
| categorical | resolve the follow-up attribute from the text: an **existing variant** ("espresso") → filed on that sub-branch; an **option or alias** ("latte" → coffee, "ran" → run, "feeling great" → mood 5) → filed on that option's sub-branch, created on first use; a **known free value** that has no sub-branch yet ("yerba mate", "marlboro") → proposes `newConcept { isVariantOf }` → review; nothing resolved → **ask the follow-up** ("What brand?"). Negated → count 0, no follow-up. |

**Follow-up round trip** (`POST /log` → `status: "follow_up"` + `item.id` → `POST /log { pendingId, answer }`): the answer
is matched against options/aliases and existing variants; anything else is taken as a new value and **creates the
sub-branch immediately** — the participant said so. Example: "I smoked a cigarette" → "What brand?" → "Marlboro" →
`behavior.tobacco.cigarettes.brand.marlboro` is created and the observation is filed on it; "another marlboro after
dinner" the next day files on it without asking.

Sub-branches ("variants") are concept rows with `level = 'variant'`, `parent_id` = the leaf, weight 0, not enrichable,
slug `<leaf>.<attribute>.<value-slug>`. Coverage rolls variant observations into the leaf (completeness ignores variants;
the leaf still carries the score); the leaf's node detail shows the variant breakdown and the tree shows a variant count.

## 4. Confidence policy (`decide`, `thresholdFor`)

- confidence ≥ **0.6** (`reviewThreshold`) → `auto_filed`; below → `needs_review` with the alternatives.
- a proposal that creates a **new concept or sub-branch from free text** always goes to review; an unmatched input
  (confidence 0) goes to review.
- a follow-up is only asked when the leaf itself is accepted (confidence ≥ threshold); an uncertain leaf is reviewed
  first.
- **relaxation after examples**: once a leaf has ≥ 200 accepted items (`auto_filed` or `accepted` queue rows) its
  threshold drops to 0.5 — the notes' "flag genuinely new data points for manual review after ~200–300 examples".
- Claude (when configured) answers the same Proposal; its slug must exist in the ontology, its new-concept parent must
  be a real group or leaf, otherwise the rules' answer stands. Any API or auth error falls back to the rules and the
  item records `classifier: "rules"`. Tests always run with `CLASSIFIER=rules`.

## 5. Filing (`server/services/ingest.ts`)

- every filed observation carries `classification_json = { classifier, confidence, ingestItemId }` (the node detail
  shows "classified by rules/Claude · mean confidence").
- provenance: quick log / voice / check-in → self_report; photo → photo_derived; imaging / genomics / lab / document
  uploads → clinical_source; CSV / JSON device exports and Apple Health → connected_device.
- source attribution: quick logs → "Manual entry"; uploads → the matching connected source (imaging, genomics,
  nutrition, lab) else a generic "Uploads" source; Apple Health → an "Apple Health (export.xml)" source.
- files get an artifact row (`dicom`, `vcf`, `photo`, `ehr_doc`, `device_raw`, `file`) with name, sha256 and size —
  bytes are never stored.
- the rewards hook (`grantReward`) pays an active `reward_rule` for the leaf through `postLedger` unless the participant
  is vault-only; stage 2 seeds the rules and the UI.

## 6. Review queue (`POST /ingest/:id/review`)

| action | effect |
|---|---|
| `accept` | file as proposed; a proposal that carries `newConcept` is accepted as `create_branch` |
| `move { conceptSlug }` | file on another leaf (or directly on a variant) |
| `create_branch { newConcept }` | `isVariantOf` set → create the sub-branch under that leaf and file there; otherwise create a new weight-0 leaf under the given group (valueKind, unit) and file there; the new leaf is immediately a quick-log target |
| `discard` | mark discarded; nothing is filed |

Only `needs_review` (or pending) items can be reviewed; others answer 409.

## 7. Apple Health export

Apple Health needs a native app for live sync, so the participant exports `export.xml` and imports it
(`POST /import/apple-health`, ≤ 25 MB, JSON `{ xml }` or raw XML). A regex/streaming parser maps `<Record>` types:
HeartRate / RestingHeartRate → heart rate; HeartRateVariabilitySDNN → HRV; StepCount → steps (summed per UTC day);
BodyMass → weight (lb → kg); BloodPressureSystolic + Diastolic paired by start time → blood pressure; BloodGlucose →
glucose (mmol/L → mg/dL); DietaryEnergyConsumed → food log kcal (summed per day); OxygenSaturation → overnight SpO2;
SleepAnalysis *Asleep* segments → sleep duration per night (InBed is ignored). One artifact row per import; duplicates
are skipped by (concept, observed_at, value) within the file and against the graph, so re-importing the same export adds
nothing.

## Worked examples

| input | result |
|---|---|
| "I smoked a cigarette" | Cigarettes (0.88) → follow-up *What brand?* → "Marlboro" → new sub-branch `cigarettes › brand › marlboro`, filed, "new sub-branch created" |
| "smoked 2 Marlboros after dinner" (no sub-branch yet) | Cigarettes, brand = marlboro, 20:00 → proposes the sub-branch → **review** |
| "didn't smoke today" | Cigarettes, negated → count 0, no follow-up |
| "BP 120/80 this morning" | Blood Pressure (home), 120/80 mmHg at 08:00 — clinic BP is the alternative |
| "heart rate hit 160 during my run" | Heart Rate 160 bpm, context = exercise **and** Exercise session › run (+1 related) |
| "resting hr 58 while sleeping" | Heart Rate 58 bpm, context = sleep |
| "ran 5k this morning" | Exercise session › run, distance_km 5, 08:00 |
| "weight 180 lb" | Weight 81.6 kg, raw "180 lb" |
| "glucose 6.1 mmol/L before breakfast" | Glucose 110 mg/dL at 07:30 |
| "had two espressos this morning" | Caffeine › espresso ×2 (existing sub-branch) |
| "had a yerba mate after lunch" | Caffeine, proposes sub-branch *Yerba Mate* → review; accept creates `caffeine › drink › yerba_mate` |
| "took my meds" / "skipped my metformin" | Medications taken today: Yes / No |
| "mood 4/5", "feeling great" | Daily mood 4 / 5 |
| "went to bed at 11:30pm" | Bedtime 23.5 h on the previous night |
| "my father had a heart attack at 68" | Family conditions (one_time): a new version, the previous one keeps `valid_to` |
| "weight" | Weight → follow-up *What was the reading (kg)?* → "183 lb" → 83 kg |
| "temperature 38.5 C" | no leaf → review → *create branch* "Body temperature" under Vitals (continuous, °C); the next "body temperature 37.2 °C" files there |
| `knee-mri-followup-2026-10-18.zip` | Imaging › MRI (musculoskeletal), dicom artifact, clinical_source |
| `lunch-2026-10-23.jpg` | Food log, photo-derived |
| `export.xml` (Apple Health) | 22 records → 13 observations across 7 leaves; re-import skips 13 |
| `labs.pdf` "HbA1c 7.4 % result" | HbA1c |

## Determinism and limits

Everything above is deterministic under the fixed clock (`shared/clock.ts`); the rule classifier never calls the
network. Known limits of the rules: no spelling correction, English only, units must be written (a bare "72" after
"heart rate" works, "seventy-two" does not), and sub-branch values come from the follow-up vocabulary or an explicit
answer — the Claude layer is what generalises beyond the keyword lists.
