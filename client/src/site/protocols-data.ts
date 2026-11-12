// The three protocol sheets. Plain descriptions of what a pilot would measure and deliver: no population counts, no
// funnel numbers, no prices. Every sheet is printed with the "illustration" watermark from shared/brand.ts.
export type ProtocolSheet = {
  slug: string;
  title: string;
  /** one line under the title */
  summary: string;
  /** small label next to the title, e.g. "Second pilot only" */
  tag?: string;
  whoTakesPart: string[];
  measures: string[];
  schedule: { when: string; what: string }[];
  deliverable: string[];
  timeline: { when: string; what: string }[];
  buyerProvides: string[];
};

const DELIVERABLE_BASE = [
  'Data captured in your approved data-capture tool and exported as CSV files: one per measure, one row per participant per day or per reading',
  'A data dictionary: every column, its unit and how it was collected',
  'A completion report from Padma: who started, who finished, and missing days by measure',
  'Records carry study codes, not names or contact details',
];

const TIMELINE_BASE = [
  { when: 'Week 1', what: 'Scope agreed in writing; your amendment filed' },
  { when: 'After approval', what: 'Recruiting; we plan for two to four weeks' },
  { when: '14 days each', what: 'Collection, per participant' },
  { when: 'Then', what: 'Files and report within two weeks of the last participant finishing' },
];

const BUYER_BASE = [
  'Your approved protocol and consent form, naming Padma as a recruitment source',
  'Participant payments, paid by you directly to participants',
  'Any devices, bought and shipped by you',
  'A contact on your team for participant questions',
];

export const PROTOCOL_SHEETS: ProtocolSheet[] = [
  {
    slug: 'lifestyle-14',
    title: 'Lifestyle 14',
    summary: 'Fourteen days of everyday-life data from adults using their own phone and their own wearable.',
    whoTakesPart: [
      'Adults who meet the criteria in your protocol and own a compatible wearable',
      '15–25 completers per pilot',
      'Invited by Padma; consent is taken under your approved protocol',
    ],
    measures: [
      'Daily check-in, about two minutes, using your questions',
      'Three meal photos a day, with location data stripped and no faces',
      'From the participant’s own wearable: steps, sleep and heart rate',
      'Baseline and exit questionnaires',
    ],
    schedule: [
      { when: 'Day 0', what: 'Consent, baseline questionnaire, wearable connected' },
      { when: 'Days 1–14', what: 'Daily check-in, three meal photos, wearable worn as usual' },
      { when: 'Missed day', what: 'One reminder the next morning' },
      { when: 'Day 15', what: 'Exit questionnaire' },
    ],
    deliverable: DELIVERABLE_BASE,
    timeline: TIMELINE_BASE,
    buyerProvides: BUYER_BASE,
  },
  {
    slug: 'sleep-stress-14',
    title: 'Sleep and stress 14',
    summary: 'Fourteen nights of sleep data from the participant’s own wearable, next to short daily logs.',
    whoTakesPart: [
      'Adults who meet the criteria in your protocol and own a wearable that records sleep',
      '15–25 completers per pilot',
      'Invited by Padma; consent is taken under your approved protocol',
    ],
    measures: [
      'Sleep data from the participant’s own wearable: duration, bed and wake times, and stages where the device reports them',
      'Daily log, about two minutes: mood, stress, caffeine and alcohol',
      'Baseline and exit questionnaires, using the instruments named in your protocol',
    ],
    schedule: [
      { when: 'Day 0', what: 'Consent, baseline questionnaire, wearable connected' },
      { when: 'Days 1–14', what: 'Wearable worn overnight; daily log each evening' },
      { when: 'Missed day', what: 'One reminder the next morning' },
      { when: 'Day 15', what: 'Exit questionnaire' },
    ],
    deliverable: DELIVERABLE_BASE,
    timeline: TIMELINE_BASE,
    buyerProvides: BUYER_BASE,
  },
  {
    slug: 'home-bp-addon',
    title: 'Home blood pressure add-on',
    tag: 'Second pilot only',
    summary: 'Twice-daily home readings added to either 14-day sheet, once a first pilot has run.',
    whoTakesPart: [
      'Participants already taking part in a Lifestyle 14 or Sleep and stress 14 pilot',
      'Offered only for a second pilot with the same research team',
      'Consent for the readings is taken under your approved protocol',
    ],
    measures: [
      'Blood pressure and pulse, morning and evening, seated, on the cuff you supply',
      'Readings for 7 to 14 days, as your protocol sets',
      'Time of each reading and whether it was a repeat',
      'Padma does not interpret readings or give medical advice',
    ],
    schedule: [
      { when: 'Before start', what: 'Cuff delivered by you; set-up instructions from your protocol' },
      { when: 'Days 1–7 or 1–14', what: 'Two readings a day, morning and evening' },
      { when: 'Any day', what: 'A reading outside your limits is handled under your safety plan' },
      { when: 'Last day', what: 'Cuff returned or kept, as your protocol says' },
    ],
    deliverable: [
      'Readings captured in your approved data-capture tool, exported as CSV with date, time, systolic, diastolic and pulse',
      'A data dictionary, and the cuff model as recorded by you',
      'A completion report: readings expected and readings received, per participant',
      'Records carry study codes, not names or contact details',
    ],
    timeline: [
      { when: 'With the pilot', what: 'Scoped and approved together with the second pilot' },
      { when: '7–14 days each', what: 'Readings, per participant' },
      { when: 'Then', what: 'Files and report within two weeks of the last participant finishing' },
    ],
    buyerProvides: [
      'Validated upper-arm cuffs, bought and shipped by you',
      'A safety and incidental-findings plan: your limits, and who contacts the participant',
      'Your approved protocol and consent form covering home readings',
      'Participant payments, paid by you directly to participants',
    ],
  },
];

export function findSheet(slug: string | undefined): ProtocolSheet | undefined {
  return PROTOCOL_SHEETS.find((s) => s.slug === slug);
}
