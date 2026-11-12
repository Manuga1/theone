# Founders' dry run: 14 days on yourselves

You are about to price a 14-day protocol that neither of you has ever done. Do it on yourselves first. You will learn where it is annoying, how many minutes of support it takes, and what the files really look like. You will also end up with one real sample dataset and a one-page report to show a buyer, in place of simulated screens.

This is two people's own data, shared by choice. It is not a study. Never present it as evidence about anyone else.

## Dates

| Day | Date | What |
|---|---|---|
| Day 0 | Fri 20 Nov | Set-up, baseline questionnaire (after the Gate A review) |
| Days 1–14 | Sat 21 Nov – Fri 4 Dec | Daily protocol |
| Day 15 | Sat 5 Dec | Exit questionnaire, exports |
| Report | Sun 6 Dec | Sample dataset and one-page report finished |

The plan places the dry run in the Thanksgiving window (21–29 November). Fourteen days run five days past it. If you want the report in hand for the proposal week (30 November – 4 December), start on Tuesday 17 November instead and move every date four days earlier.

## The protocol

Follow the "Lifestyle 14" protocol sheet on the site (`/protocols`), exactly as a participant would:

1. **Day 0.** Read a one-page description of the protocol as if you were new to it. Answer a baseline questionnaire. Confirm your wearable is recording.
2. **Days 1–14.**
   - A daily check-in of about two minutes. Use the same five questions every day, for example: hours slept; how rested you feel (1–5); stress (1–5); cups of coffee or tea; anything unusual about today (yes/no, one line).
   - Three meal photos a day. No faces, no other people. Location data off or stripped.
   - Wear your own wearable as usual: steps, sleep and heart rate.
3. **Missed day.** Your "supporter" sends one reminder the next morning. One only.
4. **Day 15.** Exit questionnaire: what was hard, what you would change, whether you would do it again, whether you would agree to be asked again in three months.

Use devices you already own. No glucose monitors, no blood-pressure cuffs: devices wait for a second pilot.

For questionnaires, write your own ten questions, or use a published one only if its licence lets you. Do not copy a questionnaire you have no right to use.

## Roles

Each of you plays two parts:

- **Participant** for your own 14 days.
- **Supporter** for the other founder: you send the reminder, answer their questions, check each morning that yesterday's data arrived, and build their files at the end.

The supporter never comments on what the data means. You are testing logistics, not health.

## Where the data goes

- **Not into the Padma software.** The demo runs on simulated data and must not hold real health information. The site banner says so, and it applies to you.
- **Not into a university or VUMC account.**
- Use one private folder per founder in a personal account with two-factor sign-in. Share it only with the other founder.
- From your phone's health app or the wearable's app, export only the three named data types (steps, sleep, heart rate). Do not export the full archive: it contains far more than the protocol needs.
- Keep meal photos in the private folder. They do not go in the sample dataset.

## What to log

Three logs, kept in one spreadsheet with three tabs. Fill them in every day; memory is useless here.

### 1. Protocol log (the participant fills in)

| Column | Example |
|---|---|
| `date` | 2026-11-21 |
| `day` | 1 |
| `check_in_done` | yes |
| `check_in_seconds` | 95 |
| `meal_photos` | 3 |
| `wearable_worn_day` | yes |
| `wearable_worn_night` | no |
| `reminder_needed` | no |
| `note` | forgot lunch photo, took it late |

### 2. Support time log (the supporter fills in)

Time every task with your phone's stopwatch. Round up to the minute. Log it the moment you finish.

| Column | Example |
|---|---|
| `date` | 2026-11-22 |
| `for_whom` | F2 |
| `task` | one of: `setup`, `daily_check`, `reminder`, `question`, `export_help`, `file_building`, `cleaning`, `report` |
| `minutes` | 4 |
| `what_happened` | sleep data missing, asked F2 to open the app and sync |

At the end, add up: minutes per participant per day, minutes of set-up, minutes to build the files. These three numbers decide whether the Offer B fee makes sense.

### 3. Friction log (both fill in)

Anything that slowed you down, confused you or made you want to quit.

| Column | Example |
|---|---|
| `date` | 2026-11-24 |
| `who` | participant / supporter |
| `step` | meal photo |
| `what_went_wrong` | eating with family, awkward to photograph the table |
| `minutes_lost` | 3 |
| `how_bad` | 1 = irritating, 2 = lost data, 3 = would make a participant quit |
| `fix_idea` | allow a photo of your own plate only |

Write down frictions you would be embarrassed to admit. Those are the ones real participants will have.

## The sample dataset

Build it on Day 15. It should look like the deliverable on the protocol sheet.

| File | One row per | Columns |
|---|---|---|
| `checkin.csv` | participant per day | `code`, `day`, the five check-in answers |
| `meals.csv` | participant per day | `code`, `day`, `photos_taken`, time of each photo (hour only) |
| `wearable_daily.csv` | participant per day | `code`, `day`, `steps`, `sleep_minutes`, `resting_heart_rate`, `source_device` |
| `questionnaires.csv` | participant per questionnaire | `code`, `which` (baseline / exit), one column per question |
| `data_dictionary.csv` | column | file, column, meaning, unit, how it was collected |
| `completion.csv` | participant per measure | `code`, `measure`, `days_expected`, `days_received` |

Rules:

- Use the codes `F1` and `F2`, not names. Say plainly in the report that these are the two founders.
- Use day numbers (1–14), not calendar dates.
- Leave out anything either of you does not want a stranger to see. You each have a veto over your own rows.
- No meal photos in the dataset.

## The one-page report

One page, written on Sunday 6 December. Headings:

1. **What this is.** "A dry run of the Lifestyle 14 protocol by Padma's two founders on themselves, [dates]. Two people. Not a study."
2. **What was collected.** The measures, in one line each.
3. **Completion.** For each measure: days received out of days expected, for F1 and F2.
4. **Support time.** Minutes per participant per day; minutes of set-up; minutes to build the files.
5. **What broke.** The five worst frictions and what you changed.
6. **What we would change before a real pilot.** Three to five points.
7. **What a buyer would receive.** The file list, with a few sample rows.

Put this line at the top and the bottom: "Sample from the founders' own data. Two people. Padma has no enrolled participants yet."

## How to use it

- Show the report and the sample files on a call, when a buyer asks what they would receive. Send them only when both of you agree, for that buyer.
- Use the support minutes to check the Offer B fee: hours per completer, against $150–$300. If the hours do not fit, say so in `offer-and-pricing.md` and change the fee before the next quote.
- Use the friction log to fix the protocol sheet wording. Tell me what to change on the site.
- Do not describe the dry run as a pilot, a study or a result.

## If only one of you can do it

One founder does the protocol; the other is the supporter. You lose the comparison between two people but keep the support timing and the sample files. Say "one person" in the report.
