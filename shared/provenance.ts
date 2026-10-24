// Verification is provenance, not a truth claim: direct clinical/device data ranks above self-report.
export const PROVENANCE_CLASSES = ['clinical_source', 'connected_device', 'protocol_measurement', 'photo_derived', 'self_report'] as const;
export type ProvenanceClass = (typeof PROVENANCE_CLASSES)[number];

export const PROVENANCE_RANK: Record<ProvenanceClass, number> = {
  clinical_source: 4,
  connected_device: 3,
  protocol_measurement: 3,
  photo_derived: 2,
  self_report: 1,
};

export const PROVENANCE_LABEL: Record<ProvenanceClass, string> = {
  clinical_source: 'Clinical source',
  connected_device: 'Connected device',
  protocol_measurement: 'Protocol measurement',
  photo_derived: 'Photo-derived',
  self_report: 'Self-report',
};

export function provenanceRank(c: ProvenanceClass): number {
  return PROVENANCE_RANK[c];
}
