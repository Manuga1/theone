// Pure estimate functions over shared/pricing.ts. For the default B2 cohort at target 2,500 the headline triple is
// contacts 4,850 / accepted 2,920 / completed 2,560 and the cost lines read ≈ $318k / $94k / $42k / $86k, 6–8 weeks.
import { PRICING } from '@shared/pricing';
import type { CampaignVariable } from '@shared/requirement';
import type { CostLine, Estimate } from '@shared/api-types';
import { fromNet } from './ledger';

export type GroupInput = { key: string; label: string; slugs: string[]; eligible: number; recruitable: number };

/** Expected completers if every recruitable member of every group were contacted (B4 "estimated complete cohort after enrichment"). */
export function estimatedAfter(readyNow: number, groups: GroupInput[]): { low: number; high: number; point: number } {
  let add = 0;
  for (const g of groups) {
    const k = g.slugs.length;
    if (k === 0) continue;
    add += g.recruitable * PRICING.ACCEPT * Math.pow(PRICING.MULTI, k - 1) * Math.pow(PRICING.COMPLETE, k);
  }
  const point = Math.round(readyNow + add);
  return { low: Math.round(readyNow + add * 0.94), high: Math.round(readyNow + add * 1.06), point };
}

export function contactsForTarget(targetN: number, pool: number): number {
  const needed = Math.ceil((targetN * PRICING.BUFFER) / (PRICING.ACCEPT * PRICING.COMPLETE));
  return Math.max(0, Math.min(pool, needed));
}

/** Largest-remainder allocation of `total` across `weights` (sums exactly to total). */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (w / sum) * total);
  const out = raw.map((r) => Math.floor(r));
  let rem = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; rem > 0 && k < order.length; k++, rem--) out[order[k].i]++;
  return out;
}

export type EstimateInput = {
  targetN: number;
  readyNow: number;
  /** Groups keyed by the set of variables that must be COLLECTED for their members (slugs ⊆ collect variables). */
  groups: GroupInput[];
  variables: CampaignVariable[];
};

export function buildEstimate(input: EstimateInput): Estimate {
  const { targetN, variables } = input;
  const groups = input.groups.filter((g) => g.slugs.length > 0 && g.recruitable > 0);
  const pool = groups.reduce((a, g) => a + g.recruitable, 0);
  const contacts = contactsForTarget(targetN, pool);
  const accepted = Math.round(contacts * PRICING.ACCEPT);
  const completed = Math.round(accepted * PRICING.COMPLETE);

  const weights = groups.map((g) => g.recruitable);
  const contactsG = allocate(contacts, weights);
  const acceptedG = allocate(accepted, weights);
  const completedG = allocate(completed, weights);

  const byslug = new Map(variables.map((v) => [v.conceptSlug, v]));
  const reuseComp = variables.filter((v) => v.mode === 'reuse').reduce((a, v) => a + v.compCents, 0);
  let participantComp = 0;
  let devices = 0;
  groups.forEach((g, i) => {
    const comp = g.slugs.reduce((a, s) => a + (byslug.get(s)?.compCents ?? 0), 0) + reuseComp;
    const dev = g.slugs.reduce((a, s) => a + (byslug.get(s)?.deviceCostCents ?? 0), 0);
    participantComp += completedG[i] * comp;
    devices += acceptedG[i] * dev;
  });
  const prep = completed * PRICING.PREP_PER_COMPLETER_CENTS;
  const platformShare = fromNet(participantComp).platform;
  const platform = contacts * PRICING.RECRUIT_PER_CONTACT_CENTS + PRICING.CAMPAIGN_FIXED_CENTS + platformShare;

  const costLines: CostLine[] = [
    { key: 'participant_comp', label: 'Participant compensation', cents: participantComp },
    { key: 'devices_testing', label: 'Devices / testing', cents: devices },
    { key: 'data_preparation', label: 'Data preparation', cents: prep },
    { key: 'platform_recruitment', label: 'Platform & recruitment', cents: platform },
  ];
  const weeksLow = PRICING.BASE_WEEKS + Math.ceil(contacts / PRICING.CONTACTS_PER_WEEK);
  return {
    targetN, pool, contacts, accepted, completed, costLines,
    totalCents: costLines.reduce((a, l) => a + l.cents, 0),
    weeksLow, weeksHigh: weeksLow + 2,
    groups: groups.map((g, i) => ({ label: g.label, recruitable: g.recruitable, contacts: contactsG[i], accepted: acceptedG[i], completed: completedG[i] })),
  };
}
