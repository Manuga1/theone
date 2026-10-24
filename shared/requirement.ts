// Variable requirement semantics for campaigns.
//  - historical: the participant already holds data spanning >= minSpanDays with provenance >= minProvRank
//  - protocol:   the participant completed a verified protocol collection covering >= durationDays
// The cohort funnel (B3) evaluates the historical branch only; study completion (B4/B7/B8) accepts either.
export type HistoricalRequirement = { minSpanDays: number; minProvRank: number };
export type ProtocolRequirement = {
  method: 'device' | 'protocol' | 'survey' | 'photo' | 'upload' | 'kit';
  durationDays: number;
  trials?: number;
  device?: string;
  minProvRank: number;
};
export type VariableMode = 'reuse' | 'collect_if_missing' | 'collect_all';
export type CampaignVariable = {
  conceptSlug: string;
  mode: VariableMode;
  requirement: { historical?: HistoricalRequirement; protocol?: ProtocolRequirement };
  compCents: number;
  deviceCostCents: number;
};

export type CoverageLike = { spanDays: number; bestProvRank: number; protocolDays: number; nObs: number } | null | undefined;

export function satisfiesHistorical(cov: CoverageLike, req: HistoricalRequirement): boolean {
  if (!cov || cov.nObs <= 0) return false;
  return cov.spanDays >= req.minSpanDays && cov.bestProvRank >= req.minProvRank;
}
export function satisfiesProtocol(cov: CoverageLike, req: ProtocolRequirement): boolean {
  if (!cov) return false;
  return cov.protocolDays >= req.durationDays;
}
export function satisfiesVariable(cov: CoverageLike, v: CampaignVariable): boolean {
  const h = v.requirement.historical ? satisfiesHistorical(cov, v.requirement.historical) : false;
  const p = v.requirement.protocol ? satisfiesProtocol(cov, v.requirement.protocol) : false;
  if (!v.requirement.historical && !v.requirement.protocol) return !!cov && cov.nObs > 0;
  return h || p;
}
