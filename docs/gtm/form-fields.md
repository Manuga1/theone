# The two hosted forms: fields, set-up, settings and test

Two forms, each writing to its own restricted sheet. The site embeds them from two web addresses you set in Vercel. Padma's own software stores no answers.

Time needed: about 15 minutes per form, plus 10 minutes for the settings and the test.

**No health fields. Not one.** Do not add a question about conditions, medicines, diagnoses, weight, pregnancy, mental health or which disease someone wants to help with. Even "which conditions interest you" counts as health information in some states.

## Before you start

1. Create one account for Padma with a form service that can embed a form in a web page and write answers to a spreadsheet (Google Forms with Google Sheets works; so do Tally or Typeform with a linked sheet). Use a new account made for Padma, or the Padma domain mailbox once it exists. Do not use a university or VUMC account.
2. Switch on two-factor sign-in for that account before you create anything.
3. Decide the two named people who may open the registry sheet (from `founders-one-page.md`). Each uses their own account with two-factor sign-in. Never share a password.

---

## Form 1: registry sign-up

**Form title:** Join the Padma registry

**Form description** (paste this):

> Padma is a student project. It keeps a list of adults who are willing to be invited to research studies. This form takes about two minutes. It asks for contact details only. Please do not tell us anything about your health.

Then paste the "Before you join" terms from `registry-notice.md`, section 2.

| # | Question | Type | Required | Options, exactly | Helper text |
|---|---|---|---|---|---|
| 1 | Your name | Short text | Yes | | First and last name |
| 2 | Your email address | Email | Yes | | We use this only to write to you about the registry and about studies that might fit you |
| 3 | Your age band | Single choice | Yes | `18` · `19–20` · `21–29` · `30–39` · `40–49` · `50–59` · `60–69` · `70 or older` | You must be 18 or older (19 or older in Alabama and Nebraska, 21 or older in Mississippi) |
| 4 | The state you live in | Dropdown | Yes | The 50 states and `District of Columbia`, in alphabetical order | Your home state. US residents only |
| 5 | The state you would be in during a study | Dropdown | Yes | The same list, plus `Not sure yet` | Students and people who travel: where will you be for the next few months? |
| 6 | Devices you own | Multiple choice | Yes | `iPhone` · `Android phone` · `Apple Watch` · `Fitbit` · `Oura ring` · `Garmin watch` · `Another fitness tracker or smartwatch` · `None of these` | Tick all that apply. This only tells us which studies could fit you |
| 7 | Kinds of study you would consider | Multiple choice | Yes | `Online surveys` · `A short daily check-in for one or two weeks` · `Taking photos of meals for one or two weeks` · `Sharing data from a wearable I already own` · `A video or phone interview` · `Using a device that the research team sends me` · `An in-person visit near where I live` | Tick all that apply. You decide again for each study |
| 8 | I am old enough to join in my state, and I live in the United States | Checkbox | Yes | One box | |
| 9 | I have read the registry privacy notice and agree to be emailed by Padma about research studies I might join | Checkbox | Yes | One box | Link the words "registry privacy notice" to `/privacy` on the live site |

**Confirmation message** (paste this):

> Thank you. You are on the Padma registry. Joining does not put you in a study, and nothing is guaranteed. To leave, email [contact email] and we will delete your details within 7 days.

Settings for this form:

- Do not collect anything the questions do not ask for. Switch off sign-in requirements, location capture and any "collect IP address" or tracking option.
- Do not add a free-text "anything else?" box. People use it to describe their health.
- Do not list medical devices (glucose monitors, blood-pressure cuffs, sleep-apnoea machines) under question 6. Owning one says something about a person's health.
- One response per person is fine but not needed.
- No confirmation email with the answers in it.

**Columns you add to the sheet yourselves** (not on the form):

| Column | Values | Why |
|---|---|---|
| `known_to_founders` | `yes` / `no` | The target is at least 40 sign-ups from strangers. Each founder marks the people they know, once a week |
| `age_rule_ok` | `yes` / `removed` | See the weekly check below |
| `check_in_sent` | date | For the recontact test (`recontact-test.md`) |
| `check_in_answered` | date or blank | For the recontact test |

**Weekly check (Mondays, the registry-sheet owner):**

1. Remove any row where the state is Alabama or Nebraska and the age band is `18`.
2. Remove any row where the state is Mississippi and the age band is `18` or `19–20`.
3. Email each removed person one line saying why. Then delete the row.
4. Open the sharing settings. Confirm exactly two people have access.
5. Count sign-ups, sign-ups aged 30 or older, and strangers. Write the three numbers in the tracker notes. The target by Friday 11 December is 150, at least 60 aged 30 or older, at least 40 strangers.

---

## Form 2: pilot enquiry

**Form title:** Talk to Padma about a pilot

**Form description** (paste this):

> Padma is a student project in pilot stage. It has no enrolled participants yet. Tell us a little about your study and we will reply by email to arrange a 20-minute call. Please do not include information about any individual person.

| # | Question | Type | Required | Options, exactly | Helper text |
|---|---|---|---|---|---|
| 1 | Your name | Short text | Yes | | |
| 2 | Work email | Email | Yes | | |
| 3 | Organisation | Short text | Yes | | Company, university or institute |
| 4 | Your role | Short text | Yes | | For example: principal investigator, study coordinator, founder, clinical lead |
| 5 | Type of organisation | Single choice | Yes | `Company` · `University or academic medical centre` · `Non-profit or foundation` · `Other` | |
| 6 | What would you like help with? | Multiple choice | Yes | `Sending our approved study notice to people who opted in` · `A small pilot group on a simple 14-day protocol` · `A design-partner pilot with a weekly call` · `One more measurement from participants we already have` · `Not sure yet` | Tick all that apply |
| 7 | In a sentence or two, what do you want to measure? | Long text | Yes | | Measures and schedule only. Nothing about individual people |
| 8 | Roughly how many participants? | Single choice | No | `10 or fewer` · `11–25` · `26–50` · `More than 50` · `Not sure` | |
| 9 | When would you like to start? | Single choice | No | `Within 1 month` · `1–3 months` · `3–6 months` · `Later, or just exploring` | |
| 10 | Ethics cover for this work | Single choice | Yes | `We hold an approved protocol` · `Our protocol is in review` · `Our counsel treats this as product feedback, not research` · `None yet` · `Not sure` | We can only work under your approved protocol, or under your counsel's written view |
| 11 | Would you want the option to contact the same participants again later? | Single choice | No | `Yes` · `Maybe` · `No` | |
| 12 | Anything else we should know? | Long text | No | | Please do not include information about any individual person |

**Confirmation message** (paste this):

> Thank you. We will reply by email to arrange a call. Padma is a student project in pilot stage and has no enrolled participants yet.

Notes:

- The form shows no prices. Do not add any.
- Do not ask for a budget on the form. Ask on the call.
- When an enquiry arrives, add a row to the outreach tracker the same day with `source` = `pilot form`.
- If the enquiry is from a university lab, reply offering a call. Send no price until the ethics office has answered.

---

## Set-up steps (for each form)

1. Sign in to the Padma form account. Confirm two-factor sign-in is on.
2. Create the form. Enter the title, the description, and the questions in the order above, with the options typed exactly.
3. Link the form to a new spreadsheet. Name it `Padma registry` or `Padma pilot enquiries`.
4. Open the sheet's sharing settings. Set access to "restricted". Add only the second named person, by their own account. Turn off "anyone with the link" and turn off the option that lets editors change sharing.
5. In the form settings, switch off sign-in requirements and any option that records more than the answers.
6. Get the form's embed address. In Google Forms this is Send, then the `<>` tab: copy only the web address inside `src="..."`. It starts with `https://`.
7. Open that address in a private browser window. The form should load without asking you to sign in.

## Settings in Vercel

Project → Settings → Environment Variables → Production. After changing any value that starts with `VITE_`, redeploy: those values are read when the site is built, not when it runs.

| Name | Value | What it does | If unset |
|---|---|---|---|
| `VITE_REGISTRY_FORM_URL` | The embed address of form 1 (`https://…`) | Shows the registry form on `/join` | `/join` offers sign-up by email if a contact address is set, otherwise says "Sign-ups open soon." |
| `VITE_PILOT_FORM_URL` | The embed address of form 2 (`https://…`) | Shows the pilot enquiry form on `/researchers` | `/researchers` offers email if a contact address is set, otherwise says "Pilot enquiries open soon." |
| `VITE_CONTACT_EMAIL` | The contact and deletion address on the Padma domain | Shown on `/privacy` and used for the email fallback | The notice asks people to reply to any Padma email instead |
| `VITE_FOUNDERS` | Both founders' full names, separated by a comma: `First Last, First Last` | Names the two people in the notice | The pages say "run by its two student founders" |
| `DEMO_ADMIN_TOKEN` | A long random string. Not a `VITE_` value. Never put it in a page, an email or the repo | Lets you use Reset and Advance on the hosted demo by opening the site once with `?admin=<the token>` | Reset and Advance are refused on the hosted site |

Notes:

- Names and the contact address live only in these settings. Do not type them into the code.
- Use an address on the Padma domain for `VITE_CONTACT_EMAIL`. Not a vanderbilt.edu or VUMC address.
- Set `VITE_FOUNDERS` before the registry opens. The notice promises "named people".
- To make a token, use a password manager's generator: 32 characters or more.

## Five-step test after deploy

Do this on Monday 16 November, on the live site, before sending the first registry message. One of you submits; the other confirms.

1. **Phone, `/join`.** Open the live site on a phone. The page loads, the status line is visible, and the registry form appears inside the page. Submit it once with your own details.
2. **Phone, `/researchers`.** The pilot form appears. Submit it once with the organisation name `TEST`.
3. **Sheets.** The other founder opens both sheets from their own account and sees both rows. Then deletes both test rows. Check the sharing settings show exactly two people.
4. **Notice and contact.** Open `/privacy`. Both founders' names appear, and the contact address is right. Send an email to that address from a personal account and confirm it arrives.
5. **Demo controls and print.** Open `/b` without `?admin`: there is no Reset, Admin, Analytics or Advance control, and the simulated-data banner shows. Then open `/protocols`, print one sheet to PDF, and check the watermark "Illustration. Padma has no enrolled participants yet." is on the page and no population count appears.

If any step fails, do not open the registry. Tell me what you saw.
