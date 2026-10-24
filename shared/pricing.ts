// All marketplace estimate constants in one place (tuned so the B6 mockup triple 4,850 / 2,920 / 2,560 is derived).
export const PRICING = {
  ACCEPT: 0.602,            // P(accept | contacted)
  COMPLETE: 0.8767,         // P(complete | accepted)
  MULTI: 0.5,               // acceptance penalty factor per additional missing variable
  BUFFER: 1.0238,           // over-recruitment buffer on target N
  PREP_PER_COMPLETER_CENTS: 1640,
  RECRUIT_PER_CONTACT_CENTS: 500,
  CAMPAIGN_FIXED_CENTS: 2_650_000,
  CONTACTS_PER_WEEK: 2500,
  BASE_WEEKS: 4,
  PARTICIPANT_SHARE: 0.9,   // 90/10 split hypothesis from the founder brief
} as const;

export const SPLIT = { participant: 0.9, platform: 0.1 } as const;
