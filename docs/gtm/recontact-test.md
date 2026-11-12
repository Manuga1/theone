# The recontact test: do registry members answer when asked again?

Padma's thesis is that buyers pay more for people they can go back to. That is only worth anything if people do answer when asked again. This test measures it, for free, with no health information.

**The test:** 30 days after a person signs up, email them a two-minute, non-health task. Count how many complete it within 7 days.

**Target:** half respond within 7 days.

## Before you start

- The joining terms must already say that Padma may send an occasional short check-in (see `registry-notice.md`, section 2). If the form went live without that line, add it and only test people who joined after it.
- The research-ethics office has been asked whether this check-in is routine upkeep or research (`questions-for-counsel.md`, part 2, question 9). If they say it needs review, wait.
- Send from the Padma domain mailbox. Never from a university or VUMC address.
- No payment or prize for answering. The test is whether people respond without one.

## The task

A third hosted form, called "Padma registry check-in", writing to its own restricted sheet. The person's email address and four questions, about two minutes. Nothing about health.

| # | Question | Type | Options |
|---|---|---|---|
| 1 | Your email address | Email | So we can match your answer to your sign-up |
| 2 | Which state will you be in for most of the next three months? | Dropdown | The 50 states, `District of Columbia`, `Not sure yet` |
| 3 | Do you still own the devices you told us about? | Single choice | `Yes, the same` · `I have something new` · `I no longer have one` |
| 4 | Which days are best for a study invitation to reach you? | Multiple choice | `Weekdays` · `Weekends` · `No preference` |
| 5 | Do you want to stay on the registry? | Single choice | `Yes` · `No, please delete my details` |

Anyone who answers "No, please delete my details" is deleted within 7 days and counts as a response.

Do not add a question about health, a study, or pay.

## The email

Send one email per person, or use a mail-merge that sends individually. **Never put members in "To" or "CC" together.** One email only: no reminder during the 7 days.

**Subject:** A two-minute check-in from Padma

```text
Hi [First name],

You joined the Padma registry about a month ago. Thank you.

Could you take two minutes to answer four short questions? They keep your details up to date, so we only send invitations that could fit you. None of them is about your health.

[link to the check-in form]

This is not a study invitation, and there is no payment for answering. If you would like to leave the registry, tick the last box or reply to this email, and we will delete your details within 7 days.

[Your name]
Padma
[Postal address]
Padma is a student project, not affiliated with or endorsed by Vanderbilt University or Vanderbilt University Medical Center.
```

## When to send

Each person is tested once, at 30 days after their sign-up. Send in weekly batches on Mondays at about 10am Central: each batch is everyone who reached 30 days during the previous week.

| Batch | Send date | Covers sign-ups from |
|---|---|---|
| 1 | Mon 21 Dec | 16–21 Nov |
| 2 | Mon 28 Dec | 22–28 Nov |
| 3 | Mon 4 Jan | 29 Nov – 5 Dec |
| 4 | Mon 11 Jan | 6–12 Dec |

Batches 1 and 2 fall in the holidays. Send them anyway and record the result as it is. Do not move the dates to get a better number. Report holiday batches and January batches side by side.

## How to measure

In the registry sheet, fill in two columns for each person: `check_in_sent` (date and time) and `check_in_answered` (date and time from the form, or blank).

**Who counts (the denominator):** every member who was sent the email, except:

- the two founders and any test rows;
- anyone who asked to be deleted before the send date;
- addresses that bounced. Count bounces separately.

**What counts as a response (the numerator):** a completed check-in form, or a reply asking to leave, within 7 days (168 hours) of the send time. A reply that says "got it" without the form does not count.

**The number:** responses ÷ members sent, per batch and overall.

Also break it down, because buyers will ask:

| Group | Sent | Responded in 7 days | Rate |
|---|---|---|---|
| All | | | |
| Aged 30 or older | | | |
| Under 30 | | | |
| Strangers (`known_to_founders` = no) | | | |
| Known to a founder | | | |
| Batches 1–2 (holidays) | | | |
| Batches 3–4 (January) | | | |

After day 7 you may send one reminder. Record what it adds in a separate column. It does not count towards the test.

## How to read the result

The plan sets one line: half respond within 7 days. The bands below are a suggested reading, not a rule from the plan.

| Result within 7 days | Reading | What to do |
|---|---|---|
| 50% or more | Pass. Members can be reached again a month later | Say so in buyer conversations, with the exact figures: "[x] of [y] members answered a check-in within 7 days." Never round up |
| 30–49% | Weak. Reachable, but not reliably | Look at who did not answer. Test a different day or subject line on the next batch, and say you changed it |
| Under 30% | Fail. A contact list is not a recontactable population | Do not sell the recontact line on the registry's strength. Rethink how people join and what keeps them engaged |

Read these three things before trusting the headline:

1. **Strangers versus people you know.** Friends answer friends. The stranger rate is the one that says something about a real registry. If fewer than 20 strangers were sent the email, say the sample is too small to judge.
2. **Aged 30 or older.** These are the people the labs need.
3. **Size.** With fewer than 50 people sent, treat the result as a first reading, not a finding.

## What you may and may not say afterwards

| You may say | You may not say |
|---|---|
| "[x] of [y] registry members answered a two-minute check-in within 7 days, 30 days after joining." | "Our members are highly engaged." |
| "This was a non-health check-in with no payment." | "[x]% of our participants complete follow-up measurements." |
| "It tells us about answering an email, not about completing a study task." | Any rate without the two numbers behind it |

This test covers supply only. Demand is tested in interviews and price on every quote: see `interview-guide.md`.

## Record

| Batch | Send date | Sent | Bounced | Responded in 7 days | Rate | Asked to leave | Notes |
|---|---|---|---|---|---|---|---|
| 1 | | | | | | | |
| 2 | | | | | | | |
| 3 | | | | | | | |
| 4 | | | | | | | |
