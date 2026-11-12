# Plan: Take Padma to market — a 4-day launch and a 90-day path to a first paid pilot

## Context

**What exists.** `Manuga1/theone` is a working model on synthetic data, live at `theone-snowy.vercel.app`. No real participants, no real data, no logins, no durable database, no company, no lawyer.

**What you asked for.** In 3–4 days: outreach to labs and buyers live, participants signing up. In 30–60 days: a first paid pilot. Include who to talk to.

**What I read.** The repo; your brief, architecture summary and mockups; your Granola notes of Nov 2 and Nov 9; Akash's emails and his Nov 10 ontology and architecture documents. Then fresh research: buyers and prices, US and Tennessee law, Vanderbilt rules and resources, a lead list from ClinicalTrials.gov and PubMed. An independent reviewer attacked the first draft; its six blocking findings are fixed below.

**Your decisions.** Both sides live by day 4. Recruit broadly, collect narrowly. First participants: students, friends, family. Records, labs, genomics and imaging deferred. Under $500. Tennessee, Vanderbilt. Name: Padma. I build the kit in this repo.

**Team.** Maanas and Akash, part-time. Srijan is no longer involved, so there is no engineer besides me; all building happens in this repo.

## Four things to know first

1. **Day 4 means in market, not selling data.** Interview requests out, registry open, permissions requested. Nobody can deliver real data in 4 days.
2. **Money arrives later than you hoped.** A funded startup can sign between mid-January and mid-February. A university cannot pay a new student-owned vendor before March. A paid pilot inside 60 days is possible only with a startup that already has ethics cover.
3. **Pilot 1 gives you no data you can reuse.** Data collected under a lab's approval belongs to that study. Pilot 1 buys a paying reference, operating experience and a tested recruiting channel. A reusable, recontactable dataset needs Padma's own protocol reviewed by an independent ethics board (about $2,000–$6,000), which is the step after.
4. **Say "research participants", not "patients".** "Patient data" in an email to a lab gets forwarded to the privacy office.

## Before anything is sent (Thu–Fri)

**One 45-minute call, the two of you.**
- Akash's emails come from a VUMC account and mention a surgery rotation. Confirm his hours and call slots. He uses no VUMC account, clinical access or clinical contacts for Padma.
- Agree or object, line by line, to the corrections below. The pharma-scale mockup claims ("100% consent verified", "FDA Part 11 grade", "CLIA/CAP", lifetime earnings) never leave the team.
- One page between you: roles and weekly hours; provisional ownership split; the code, registry list, domain and name belong to the future company; what happens if someone leaves; how time divides with DiffEx.

**Three permission emails, sent Friday.**
- **Research-ethics office (Vanderbilt HRPP):** does a contact-only registry run by students need a determination; may a lab pay an outside student-owned recruiter, and how; what must the lab's amendment contain.
- **Dean of Students and your Wond'ry programme leads:** may a student venture recruit through campus channels, and by which route; may the page say "Vanderbilt students"; may discovery-interview requests go from a vanderbilt.edu address.
- **A department administrator:** small-purchase limit, supplier onboarding time, rules on buying from a student-owned business.

**Name check.** "Padma" is an existing brand in health products. I will search the trademark register and the web first and report what I find. Buy the domain only after that; if it conflicts, add a distinguishing second word.

## Corrections to ideas in your notes

- **Gambling, behaviour-tracking and litigation buyers** (Nov 2 call). Akash's spec already requires permitted-use screening and bans advertising, underwriting, employment and resale. I will add these two uses to the banned list so the statement is true.
- **"We can run your study" at ~$250K.** First deals for a team with no cohort are small, likely four figures.
- **Participants in other countries.** Defer.
- **90/10 vs 80/20 vs cost-deducted.** Akash's spec says service fees sit outside the licensing split. Use the money rule below.
- **Waitlist shelved for reputational risk.** The registry is that waitlist. Reopen it only if you both agree: contact details only, no income language, no link to earnings screens, personal contacts first.

## Strategy and how the thesis gets tested

Open a registry of adults willing to be invited to paid studies. Sell small, fast recruiting and collection services against it. Treat every conversation as a test of whether buyers pay more for people they can go back to.

- **Demand, by interview:** when did you last go back to the same participants, what did it cost, what would you have paid.
- **Supply, free and measurable:** 30 days after sign-up, email every registry member a two-minute non-health task. Target: half respond within 7 days.
- **Price:** recontact is an optional line on every quote. One of the first three buyers buying it is a pass. A second buyer paying to re-measure people recruited for someone else is a strong pass.

## The offer

Every figure is untested. The first five interviews are for learning the real number.

| Offer | Buyer | What they get | Starting fee | Ethics cover |
|---|---|---|---|---|
| **A. Referral campaign** | Academic labs | The lab's approved study notice sent to registry members who opted in to that kind of study; a referral report. Padma does not screen, consent or see study data | Flat $500–$1,500 per study | Lab files a minor amendment naming Padma as a recruitment source |
| **B. Pilot cohort** | Startups first; labs later | 15–25 completers on a simple protocol: surveys, logs, the participant's own wearable | $150–$300 per completer, service fee only | Buyer's approved protocol |
| **C. Design partner** | Funded startups | 10 participants, one protocol, weekly call | $2,500–$5,000 fixed | Only where the startup holds an approved protocol or its counsel treats the work as product feedback. Otherwise add ethics-review cost and four weeks |
| **D. Recontact operations** | Labs with a finished cohort | Reminders and logistics to get one more measurement from the lab's own participants | Ask in interviews only | Lab's protocol |
| **Recontact line** | Any | Optional, priced separately | $50–$150 per participant | Same protocol |

**Money rule.** Every quote shows two lines. Participant compensation and devices are paid and shipped by the buyer directly. Padma never holds participant money or buys devices. Padma invoices only its service fee, only through a company with a business bank account. Until those exist you sign nothing and accept no money; scopes go out as proposals.

**Devices** (CGM, cuffs) wait for a second pilot, supplied by the buyer under a protocol that covers safety and incidental findings.

## Who to talk to, in two tracks

- **Revenue track, from day 1:** about 30 funded metabolic, CGM, wearable, sleep and digital-health startups. Offer C. Sources: the small-company sponsors in my lead list, NIH SBIR awards, accelerator directories.
- **Discovery track:** Vanderbilt, VUMC and Meharry groups and recruitment staff. Goal: six interviews, the ethics-office answer, and one lab willing to trial Offer A free or at cost. VU and VUMC are separate legal entities with separate purchasing.
- **January wave:** outside labs whose recruiting studies want healthy or at-risk adults a student team can reach.
- **Interview only:** pharma evidence teams and health-AI data buyers.

Every Vanderbilt PI has ResearchMatch, the free volunteer registry VUMC runs. Ask each one what it does not give them. That answer is your product.

## The 4-day sprint (Thu Nov 12 → Mon Nov 16, plus Wed Nov 18)

About 12 hours each for Maanas and Akash. I take the research and build work an engineer would have done.

| Day | I build and research | Maanas | Akash |
|---|---|---|---|
| **Thu–Fri** | Name check. Brand, banner, hide admin controls, banned-uses list. Startup target list from SBIR awards, directories and the registry search | Alignment call. HRPP and Dean of Students emails. Disclose Padma to your PI in writing. 15 warm asks drafted. Buy the domain once the name clears and point it at Vercel (I give the steps) | Alignment call. Department-administrator email. 10 warm asks drafted |
| **Sat–Sun** | Landing, researcher and join pages; registry notice; protocol sheets; one-page scope; templates, interview guide; automated checks on desktop and phone sizes | Create the two hosted forms from my field list (15 minutes). Personalise 20 academic interview requests. Read the notice and landing copy aloud; correct them | Personalise 20 startup interview requests |
| **Mon Nov 16** | Fix what production shows | Send warm asks. Soft-launch the registry to personal contacts only. Open the live site on your phone and submit both forms once | Send startup requests. Confirm both test submissions reached the sheet |
| **Tue–Wed** | Deck, demo script | Tue 4:15pm Wond'ry session: ask for mentor time, legal office hours, micro-grants, the regional I-Corps course. Wed: send academic requests (metabolism PIs are at ObesityWeek until Nov 17; cite their abstracts) | Calls as they land |

- **Email rules.** Interview requests go from Maanas's vanderbilt.edu address and say he is a student doing discovery interviews. Anything that quotes a price goes from the Padma domain with an opt-out line. Nothing goes from a VUMC address. No price is quoted to a university lab until the ethics office answers.
- **If only half the hours appear:** do the alignment call, the three permission emails and the 25 warm asks. Nothing else.

**Done on day 4:** site live with honest copy; forms working; 25 warm asks and 20 startup requests sent; three permission emails out; registry open to personal contacts.

## Days 5–90

Calendar: Thanksgiving break Nov 21–29; last class Dec 10; exams Dec 11–19; spring term starts Jan 11.

| Window | Focus | Gate |
|---|---|---|
| **Nov 17–20** | Calls; chase permissions; academic requests out Wed | **A, Fri Nov 20:** permissions answered or chased twice; 4 calls done or booked; 25 warm and 40 cold requests sent; 40 sign-ups |
| **Nov 21–29** | Startup and expert calls. Recruit relatives and family friends. **Founders' dry run:** both of you do the 14-day protocol on yourselves, time the support work, produce one real sample dataset and one-page report | — |
| **Nov 30–Dec 4** | Second wave; Dec 3 Nashville Entrepreneur Day; written proposal to the best prospect | **B, Fri Dec 4:** 8 buyer interviews logged, 3 of them startups; 1 prospect who named a study, a budget and a purchasing route. None: change segment before January |
| **Dec 5–Jan 10** | If B passed: first legal conversation, choose the entity, form it in January, open the bank account. Recontact test email to the registry | — |
| **Jan 11–Mar** | Campus recruiting once permitted. Outside-lab wave. Run the pilot | **C:** startup scope signed with fee deposit by Fri Feb 12; university amendment filed and purchase order requested by Fri Mar 12 |
| **After C** | Apply grant or fee money to Padma's own protocol at an independent ethics board. That is when the data becomes yours to license | — |

## People to talk to

Confirm current roles before writing. Scripts go in `docs/gtm/interview-guide.md`.

**First asks, sent Friday (people who already know you)**
- Your Wond'ry IMPACT Uncover programme leads: introductions to faculty running free-living studies, legal office hours, micro-grants.
- Your Hult Prize mentor: two introductions to Nashville health-data operators.
- The two VUMC faculty you met in April about the UDN dataset: 20 minutes on how their groups obtain data and who decides.
- The Center for Entrepreneurship at Owen: Chancellor's Launch Grant dates; alumni founders in digital health.
- Your PI: disclosure, plus two names outside the lab.

**Vanderbilt, VUMC and Meharry (discovery)**

| Who | Why |
|---|---|
| Research-ethics office staff | First conversation. Everything else depends on it |
| Paul Harris's group: ResearchMatch, REDCap and MyCap, the Recruitment Innovation Center | How labs recruit today and where the gaps are |
| Shelagh Mulvaney, School of Nursing | Runs a diabetes mHealth study; Fitbit and CGM paper |
| Ashutosh Singhal, Meharry biomedical data science | Glucose forecasting on a 12-person public dataset |
| Siru Liu, VUMC biomedical informatics | Personal-health language models on wearable data |
| Lindsay Mayberry, VUMC | Emerging-adult diabetes trial using CGM |
| Angela Jefferson, Memory and Alzheimer's Center | Fitbit and hypertension feasibility work with 10 participants |
| VUMC Digital Health group | Runs a remote wearable study; buyer, partner or competitor |
| Diabetes Research and Training Center Friday seminars | Walk-in access to the people who run these studies |
| Bradley Malin; Ellen Wright Clayton; the biomedical ethics centre | What "de-identified" can honestly mean; consent design |
| Study coordinators in each group | They feel the recruiting pain and know who approves vendors |

**Startups and outside labs (from the registry search; full list with study IDs in `docs/gtm/targets.csv`)**

| Who | Why |
|---|---|
| KOS, Aktiia, Wearlinq, Aventyn, Olipop, Daily Nouri, Nutrition 21 | Each sponsors a validation study that needs real-world users |
| Kevin Ballard, Miami University (Ohio) | Wants healthy adults 18–40 for CGM and accelerometry |
| Emory diabetes-prevention chatbot study team | Wants at-risk adults 18–55 |
| Nestoras Mathioudakis and Gordon Gao, Johns Hopkins | CGM, watch and meal photos; excludes iPhone users and healthy adults |
| Hassan Ghasemzadeh, Arizona State; Samantha Kleinberg, Stevens | Publishing on 10–12 participants or on non-US cohorts |

**People who know real prices**
- One or two former staff of participant-data companies (Evidation, PicnicHealth and similar), found through alumni search.
- Two people who have sold health data in Nashville.
- Ten prospective participants, most of them over 30: would they do 14 days for $X, what worries them, would they allow recontact.

**Five questions for every buyer:** the last time you collected this kind of data, what did it cost per participant all-in; where did it break; which budget paid and who approved; have you paid an outside vendor and why that one; when did you last need one more measurement from the same people and what was it worth. For startups add: do you hold an approved protocol, or is this product feedback.

**Demand means:** they name a study and its budget, introduce whoever controls purchasing, or ask for a written proposal. "Send a deck" does not count.

## Participant registry

- **Collects:** name, email, age band, state of residence and state during a study, devices owned, study types they would consider. No health information.
- **Who:** the labs you want to serve mostly need adults over 35. Weight recruiting towards parents, relatives, university staff, community groups and local employers, not classmates.
- **Target by Dec 11:** 150 sign-ups, at least 60 aged 30+, at least 40 who are strangers to you. Members are leads, not a cohort; each pilot still needs its own recruiting.
- **Channels:** personal contacts first. Campus channels only after a written yes. Vanderbilt bans dorm flyering, door-to-door recruiting and commercial use of student-organisation lists.
- **The notice must say:** Padma is a student project run by named people, not yet a company, not affiliated with or endorsed by Vanderbilt or VUMC. What is collected and why. Each study has its own consent and stated pay; nothing is guaranteed. Details are never sold; a study team gets them only if you say yes to that study. No advertising trackers. Kept in a restricted sheet with two-factor sign-in, two named people. Deletion within 7 days by email. You will be told before details move to a company. US residents 18+ (19+ in Alabama and Nebraska, 21+ in Mississippi).

## Guardrails

- **Conflicts.** Neither of you sells to, or takes money from, your own lab, supervisor or anyone who grades you. No recruiting labmates or people you mentor. No recruiting through clinicians' patients or anyone met as a patient. No Padma work on lab time, equipment or data; work on a faculty-led project can belong to the university.
- **Company.** A Tennessee LLC costs about $700 in its first year. Form it after Gate B, not at signature; forming in January may delay the first annual fee by a year (confirm).
- **Tennessee's privacy act** does not cover a company this small. FTC rules do: true statements only, nothing shared without consent.
- **Never say:** a participant count you don't have, "earn $X", "HIPAA compliant", "anonymous", "unhackable", "Vanderbilt-backed".
- **Reputation** is protected by never letting a synthetic number leave the site in a document, not by a banner.

## What I will build

| Piece | Where |
|---|---|
| Brand name in one constant; favicon; titles | new `shared/brand.ts`, `client/index.html`, `client/src/components/Shell.tsx` |
| Banner on every screen and phone: "Simulated data. Not real people. Do not enter real health information." | `Shell.tsx` |
| Reset, Admin, Analytics, Advance hidden unless `?admin`; destructive endpoints need a token when hosted | `Shell.tsx`, `server/routes/demo.ts`, `server/routes/buyer.ts` |
| One banned-uses list, adding housing, political targeting, litigation against participants, gambling and behavioural-vulnerability targeting | `shared/ontology.ts` (`PROHIBITED_USES`), README |
| Every dollar figure in the participant demo labelled "illustrative, not an offer" | `client/src/participant/Home.tsx`, `Opportunities.tsx`, `Earnings.tsx` |
| Hosted build forced to the rules classifier; quick log and upload marked demo-only | `scripts/build-vercel.mjs`, `client/src/components/QuickLog.tsx`, upload dropzone |
| Public pages `/`, `/researchers`, `/join`, `/privacy`. `/join` does not link to the demo. One "Talk to us about a pilot" link | new `client/src/site/*`, `client/src/App.tsx` (today `/` redirects by persona) |
| Embedded hosted forms from configured URLs, with an email fallback when unset. No custom lead store | `client/src/site/Join.tsx`, `Researchers.tsx` |
| Three printable protocol sheets: measures, schedule, deliverable, timeline, fee, what the buyer provides. No population counts. Watermark: "Illustration. Padma has no enrolled participants yet." | new `client/src/site/Protocols.tsx`, print CSS |
| Tests and the stale README deploy note | new `e2e/public.spec.ts`, `e2e/screens.spec.ts`, README |

**Later, when a buyer asks to see software:** guided demo tour at `/demo` using the `DEMO.md` script.

**Changed from what you approved, and why:** no realistic sample organisation names, no printable pages with synthetic counts, no "request this cohort" button, no custom lead store. Each made the demo easier to mistake for a real population or added risk without helping a first sale.

## Documents I will write (`docs/gtm/`)

`plan.md`; `offer-and-pricing.md`; `permission-emails.md` (the three Friday emails); `outreach-templates.md` (interview requests for PIs, coordinators, startups and experts; warm asks; two follow-ups; opt-out line); `interview-guide.md`; `targets.csv` with the search queries to extend it; `registry-notice.md`; `pilot-scope-one-page.md`; `letter-of-intent.md`; `questions-for-counsel.md`; `founders-one-page.md`; `demo-script-10min.md`; a 6-slide deck. Legal drafts are marked "for legal review".

## Budget and funding

Domain about $12; mailbox on that domain about $7 a month; a postal address for the footer of priced emails. Company fees after Gate B. Ask now about Chancellor's Launch Grants (last cycle paid $10K to each of six student teams), Wond'ry micro-grants and the regional I-Corps course.

## Parked until a pilot is signed

- Reconcile the repo with Akash's ontology v0.1 and architecture spec: twelve domains, brand as an attribute on one event, provisional concepts with review, Postgres.
- Harden the app for real data: accounts, durable encrypted database, file storage, versioned consent, payouts.

## Assumptions to correct if wrong

Akash is a VUMC medical student. Your Wond'ry cohort can be used for Padma discovery. The Zeppos meeting has not happened; if it does, ask for a health-law and ethics-office introduction.

## Risks

- **No demand signal by Dec 4.** Gate B forces a change before January.
- **Ethics office or campus says no.** Offer A waits; the startup track continues.
- **Time.** Two people, exams and rotations. The half-hours fallback protects the essentials.
- **No engineer.** Hardening the app for real data has no owner but me. It stays parked until a pilot is signed, and a technical co-founder or contractor becomes a question at that point.
- **Hosted demo resets** between server instances. Run live demos from a laptop.

## Verification

- `npm run typecheck`, `CLASSIFIER=rules npm test`, `FULL=1 npm run test:full`, `npm run test:e2e`, `VERCEL=1 npm run build:vercel`.
- New tests: banner on every route at desktop and 390px; Reset and Admin hidden without `?admin`; destructive endpoints refuse without the token when hosted; public pages render with and without form URLs; no population count on any printable page; `/join` has no link into the demo.
- After deploy: submit both forms and see both rows in the sheet; open the site on a phone; print one protocol sheet and check the watermark.
