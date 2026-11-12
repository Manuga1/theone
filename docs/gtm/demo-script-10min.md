# Ten-minute demo script

Use this only when a buyer asks to see software. It is not part of a first call. The day-4 sales asset is the one-page proposal, not the demo.

## Before the call

- **Run it from a laptop** (`npm run dev`, then open `http://localhost:5173`). The hosted demo can reset between clicks.
- Open the buyer side (`/b`). Do not add `?admin` to the address: Reset, Admin, Analytics and Advance stay hidden.
- Check that the banner shows at the top: "Simulated data. Not real people. Do not enter real health information."
- Close every other tab. Share the browser window only.
- Have `pilot-scope-one-page.md` open in another window for the end.
- **Do not record the call, and do not send screenshots, PDFs or exports afterwards.** A simulated number that leaves the site loses its banner.

## The opening sentence (say it before you click anything)

> "Before I show you anything: every number on these screens is simulated. None of it describes real people. Padma has no enrolled participants yet. What you are about to see is a working model of where we want to get to, not what we have today."

Say it again whenever a number comes up that they react to: "That figure is simulated."

## Rules while you click

- Never read a number aloud as if it were a count of people. Say "the simulated funnel narrows here" and point.
- Never say "our participants", "our population" or "patients".
- The organisations in the selector are examples, not customers. Say so.
- Dollar figures on screen are illustrative. They are not prices and not offers.
- If they ask "how many people do you really have?", answer: "None enrolled. We have a registry of [real number from the sheet] adults who agreed to be invited to studies, and it holds contact details only."

## The ten minutes

| Minute | Screen | What to do | What to say |
|---|---|---|---|
| 0–1 | Any | Opening sentence. Point at the banner | The opening sentence, word for word |
| 1–3 | Cohort builder (`/b/cohorts/new`) | Change one or two criteria and let the funnel update | "A research team describes who they need. In the model, the answer comes back in seconds. Today that question takes a lab weeks. The numbers here are simulated" |
| 3–5 | Gaps (`/b/cohorts/:id/missing`), after saving the cohort | Show the missing-data matrix | "This is the idea we care about most. People who almost fit are not lost. They are missing one measurement, and they could be asked for it" |
| 5–7 | Expand (`/b/cohorts/:id/expand`) | Show the mode for each variable: reuse, collect if missing, collect for all | "Filling a gap becomes a plan with steps and a timeline. The cost lines on this screen are illustrative, not a quote" |
| 7–8 | Proposal, then launch, then the study page | Launch the example study. Do not use "Advance" | "People who already hold the data and agreed in advance are counted at once. Everyone else has to be asked, and says yes or no" |
| 8–9 | Request a variable (`/b/studies/:id/request-variable`) | Add one new variable to the running study | "This is recontact: going back to the same people for one more measurement. Whether buyers pay more for that is the question our whole project is testing" |
| 9–10 | Organisation selector, back on the cohort builder | Switch to the advertising example organisation and show every count drop to zero | "Some uses are banned outright: advertising, insurance underwriting, employment, credit, housing and others. A buyer with a banned use sees nothing" |

If you have one minute spare, show the dataset workspace (`/b/datasets/:id/workspace`): results in a controlled view, small groups hidden, exports only on approval.

## Screens to skip

| Skip | Why |
|---|---|
| Analytics and Admin | Thin, and they show development details |
| Campaigns list | Adds nothing in ten minutes |
| "Advance 7 days" | It openly fast-forwards a fake clock. Hidden without `?admin` |
| Reset demo | Takes about 15 seconds and wipes the session. Hidden without `?admin` |
| The participant side (`/p`), unless asked | It shows earnings figures. They are labelled "illustrative, not an offer", but they distract a buyer and invite questions about income |
| Quick log and upload | Marked demo-only. Never type or upload anything real |

If they ask to see the participant side, show only the consent review on an opportunity (what a sponsor receives and never receives, the term, how to revoke) and the permissions screen. Say: "Every dollar figure here is illustrative."

## What to say about what exists today

Say this at the end, plainly:

> "Here is what is real today. One: a registry of adults who have agreed to be invited to studies. It holds contact details only. Two: a small service. We send your approved study notice to the people who opted in, do the study-specific recruiting, and report what happened. Your study runs under your own approved protocol, in your own tools, and you pay participants directly. Three: this software, which is a working model on simulated data. It has no accounts and no real data, and it will not hold any until it has been rebuilt for that."

Then:

> "A first pilot gives you [10 participants on one protocol / 15 to 25 completers]. It gives us a reference and the chance to learn. Would it help if I sent a one-page proposal?"

If they are at a university: "I can send a proposal once the ethics office has answered our questions."

## Questions you will get

| Question | Answer |
|---|---|
| "Is any of this data real?" | "No. All of it is simulated." |
| "Can I get access to the demo?" | "Yes, the simulated demo is on our site, with the same banner. Please do not enter anything real into it." |
| "Can you send me that screen?" | "I would rather not: the numbers are simulated and I do not want them travelling without that label. I can send the one-page proposal and the protocol sheet." |
| "When will the platform be live?" | "Not until a pilot is signed and it has been rebuilt for real data. The first pilots do not depend on it." |
| "Where does the data sit in a pilot?" | "In your tools, under your protocol. We hold the registry and the counts in our reports." |
| "What does it cost?" | Startup: "It is on the one-page proposal. Shall I send it?" University: "I can quote once the ethics office has answered." |
| "Who else uses it?" | "Nobody yet. You would be among the first." |
| "Is it HIPAA compliant?" | "We do not make that claim. Today we hold contact details and no health information. In a pilot, study data stays in your systems." |

## After the call

- Log it in the tracker: who, what they asked to see, what they asked for next.
- Send the thank-you from `outreach-templates.md` (section D) the same day.
- Send nothing that contains a number from the screens.
