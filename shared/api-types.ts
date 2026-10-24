// Response/request contracts for every endpoint. Both the server (routes) and the client (hooks) import from here.
// Money is always integer cents. Dates are ISO strings (YYYY-MM-DD or full timestamp). Percentages are 0–100 numbers.

import type { CohortCriteria } from './criteria';
import type { CampaignVariable } from './requirement';
import type { ProvenanceClass } from './provenance';

export const PERSONA_HEADER = 'x-demo-persona';
export type Persona = 'participant' | `buyer:${number}`;

// ---------- shared ----------
export type NodeState = 'verified' | 'partial' | 'missing';
export type LeafOverlay = { opportunity: boolean; demand: boolean; opportunityId?: number };

export type TreeNode = {
  slug: string;
  name: string;
  level: 'domain' | 'group' | 'leaf';
  /** completeness 0–100 for domain/group; for leaves 100/50/0 by state */
  pct: number;
  state: NodeState;
  overlay: LeafOverlay;
  dataType?: 'structured' | 'time_series' | 'file' | 'dicom';
  unit?: string | null;
  inRing: boolean;
  inList: boolean;
  children: TreeNode[];
};

export type ActivityItem = {
  id: number;
  kind: string;
  text: string;
  occurredAt: string;
  relative: string;
  amountCents?: number | null;
};

export type TimelineEvent = {
  id: number;
  date: string;
  kind: string;
  category: 'clinical' | 'labs' | 'medications' | 'imaging' | 'devices' | 'genomics' | 'research' | 'lifestyle' | 'other';
  title: string;
  detail?: string | null;
  conceptSlug?: string | null;
};

export type LineageStep = { key: string; label: string; detail?: string };

// ---------- participant ----------
export type RingNode = { slug: string; name: string; pct: number };

export type ParticipantHome = {
  participant: { pseudonym: string; firstName: string; age: number };
  completeness: { pct: number; deltaMonth: number };
  verifiedSources: number;
  lifetimeEarningsCents: number;
  licensedUses: number;
  opportunities: { count: number; maxCents: number };
  ring: RingNode[];
  whatChanged: ActivityItem[];
};

export type ParticipantSignature = {
  domains: TreeNode[];
  legend: { key: NodeState | 'opportunity' | 'demand'; label: string }[];
};

export type SeriesPoint = { t: string; values: Record<string, number> };

export type NodeDetail = {
  slug: string;
  name: string;
  path: string[];
  state: NodeState;
  overlay: LeafOverlay;
  unit: string | null;
  summary: {
    spanDays: number;
    spanLabel: string;
    nObs: number;
    sourceLabel: string | null;
    sourceKind: string | null;
    acquisition: string | null;
    provenanceClass: ProvenanceClass | null;
    verification: string;
    lastSyncAt: string | null;
    lastSyncRelative: string | null;
    firstAt: string | null;
    lastAt: string | null;
  };
  series: { keys: { key: string; label: string; color?: string }[]; points: SeriesPoint[]; window: { from: string; to: string } };
  lineage: LineageStep[];
  rawVsDerived: { rawCount: number; derivedCount: number; artifactCount: number; note: string };
  research: {
    licenses: number;
    earningsCents: number;
    requestedBy: number;
    lines: { licenseNumber: string; studyName: string; orgName: string; cents: number; date: string }[];
  };
  events: TimelineEvent[];
};

export type SwimlanePoint = { date: string; kind: 'dot' | 'bar'; value?: number; barUntil?: string };
export type ParticipantTimeline = {
  categories: { key: TimelineEvent['category'] | 'all'; label: string; n: number }[];
  events: TimelineEvent[];
  swimlane: {
    window: { from: string; to: string };
    months: string[];
    lanes: { key: string; label: string; color: string; points: SwimlanePoint[] }[];
  };
};

export type SourceCard = {
  id: number;
  kind: string;
  label: string;
  vendor: string;
  actionLabel: string;
  status: 'available' | 'connected' | 'disconnected';
  verified: boolean;
  connectedAt: string | null;
  lastSyncAt: string | null;
  lastSyncRelative: string | null;
};
export type MissingDimension = {
  slug: string;
  name: string;
  state: NodeState;
  action: 'see_opportunities' | 'notify' | 'watching' | 'add_data';
  opportunityId?: number | null;
};
export type ParticipantSources = { sources: SourceCard[]; missing: MissingDimension[] };

export type OpportunityTab = 'available' | 'in_progress' | 'past';
export type OpportunityStatus =
  | 'offered' | 'viewed' | 'reviewed' | 'accepted' | 'declined' | 'in_progress' | 'submitted' | 'verified' | 'rejected' | 'paid'
  | 'expired' | 'withdrawn' | 'replaced';

export type ContributionItem = {
  id: number;
  conceptSlug: string;
  name: string;
  method: string;
  durationDays: number;
  status: 'pending' | 'submitted' | 'verified' | 'rejected';
  compCents: number;
  observationCount: number;
};

export type OpportunityCard = {
  id: number;
  status: OpportunityStatus;
  tab: OpportunityTab;
  title: string;
  sponsor: string;
  sponsorType: 'pharma' | 'biotech' | 'academic' | 'other';
  purpose: string;
  compCents: number;
  compIsMax: boolean;
  requirements: string[];
  reused: string[];
  likelyMatch: boolean;
  campaignId: number;
  studyId: number;
  enrollmentId: number | null;
  offeredAt: string;
  completedAt: string | null;
  contributions: ContributionItem[];
};
export type ParticipantOpportunities = {
  counts: Record<OpportunityTab, number>;
  items: OpportunityCard[];
};
export type OpportunityDetail = OpportunityCard & {
  reviewed: boolean;
  consent: {
    organization: string;
    purpose: string;
    receive: string[];
    doNotReceive: string[];
    licenseTermMonths: number;
    futureReuse: boolean;
    recontact: 'platform_only';
    compCents: number;
    perTask: { conceptSlug: string; name: string; compCents: number; method: string; durationDays: number }[];
    reusedCompCents: number;
  };
};

export type LedgerRow = {
  id: number;
  date: string;
  kind: 'license_fee' | 'contribution_payment';
  title: string;
  dataIncluded: string[];
  studyName: string;
  orgName: string;
  purpose: string;
  licenseId: number | null;
  licenseNumber: string | null;
  termStart: string | null;
  termEnd: string | null;
  licenseStatus: 'active' | 'expired' | 'revoked' | null;
  grossCents: number;
  participantCents: number;
  platformCents: number;
  canRevoke: boolean;
};
export type ParticipantLedger = {
  lifetimeEarningsCents: number;
  activeLicenses: number;
  licensedUses: number;
  entries: LedgerRow[];
  split: { participant: number; platform: number };
};

export type ParticipantPermissions = {
  prohibitedUses: { key: string; label: string; fixed: true }[];
  categories: { slug: string; name: string; excluded: boolean }[];
  recontactOptIn: boolean;
  commercialOk: boolean;
  preauthorizeReuseOnly: boolean;
  note: string;
};
export type PermissionsUpdate = Partial<Pick<ParticipantPermissions, 'recontactOptIn' | 'commercialOk' | 'preauthorizeReuseOnly'>> & {
  excludedCategories?: string[];
};

export type ParticipantProfile = {
  pseudonym: string;
  legalName: string;
  email: string;
  phone: string;
  dob: string;
  age: number;
  sex: string;
  country: string;
  region: string;
  enrolledAt: string;
  verificationStatus: string;
  identityNote: string;
};

export type SelfReportInput = { value: number | string; unit?: string; note?: string };

// ---------- buyer ----------
export type BuyerHome = {
  org: { id: number; name: string; type: string; declaredUses: string[] };
  tiles: { availableParticipants: number; longitudinalProfiles: number; genomicsAvailable: number; recontactable: number };
  activity: ActivityItem[];
  counts: { studies: number; datasets: number; campaigns: number };
};

export type SearchResult = { type: 'concept' | 'cohort' | 'study' | 'dataset'; id: number | string; label: string; sub: string; href: string };
export type BuyerSearch = { results: SearchResult[] };

export type FunnelStage = { key: string; label: string; n: number };
export type MissingGroup = { key: string; label: string; conceptSlugs: string[]; eligible: number; recruitable: number };
export type HeatCell = 'complete' | 'partial' | 'missing';
export type CohortPreview = {
  total: number;
  funnel: FunnelStage[];
  readyNow: number;
  matrix: {
    groups: MissingGroup[];
    notRecruitable: { label: string; n: number }[];
    estimatedAfter: { low: number; high: number; point: number };
  };
  heatmap: {
    columns: { slug: string; label: string }[];
    rows: { label: string; n: number; cells: HeatCell[] }[];
  };
  bars: { slug: string; label: string; pct: number }[];
  consent: { blocked: boolean; reason: string | null };
  timingMs: number;
};

export type SavedCohort = { id: number; name: string; criteria: CohortCriteria; createdAt: string; orgId: number };

export type CostLine = { key: 'participant_comp' | 'devices_testing' | 'data_preparation' | 'platform_recruitment'; label: string; cents: number };
export type Estimate = {
  targetN: number;
  pool: number;
  contacts: number;
  accepted: number;
  completed: number;
  costLines: CostLine[];
  totalCents: number;
  weeksLow: number;
  weeksHigh: number;
  groups: { label: string; recruitable: number; contacts: number; accepted: number; completed: number }[];
};
export type EstimateRequest = {
  cohortId?: number;
  criteria?: CohortCriteria;
  targetN: number;
  variables: CampaignVariable[];
};

export type CampaignStatus = 'draft' | 'proposal_requested' | 'active' | 'closed';
export type Campaign = {
  id: number;
  studyId: number;
  parentCampaignId: number | null;
  name: string;
  status: CampaignStatus;
  targetN: number;
  variables: (CampaignVariable & { name: string })[];
  estimate: Estimate;
  cohortId: number | null;
  licenseTermMonths: number;
  createdAt: string;
  launchedAt: string | null;
  counters: StudyCounters | null;
};
export type CampaignCreate = {
  cohortId: number;
  name: string;
  purpose: string;
  targetN: number;
  variables: CampaignVariable[];
  licenseTermMonths: number;
  useTags: string[];
};

export type StudyCounters = {
  eligible: number;
  invited: number;
  accepted: number;
  started: number;
  completed: number;
  qualityAccepted: number;
  needReplacement: number;
};
export type StudySummary = {
  id: number;
  name: string;
  orgName: string;
  purpose: string;
  status: 'draft' | 'active' | 'completed' | 'closed';
  targetN: number;
  counters: StudyCounters;
  datasetId: number | null;
  updatedAt: string;
};
export type StudyDetail = StudySummary & {
  cohortId: number | null;
  cohortSummary: string;
  campaigns: { id: number; name: string; status: CampaignStatus; parentCampaignId: number | null }[];
  coverage: { slug: string; label: string; pct: number; verified: number; started: number }[];
  licenseTermMonths: number;
  replacementNote: string;
  lastAdvancedDays: number;
};
export type StudyParticipants = {
  n: number;
  floored: boolean;
  columns: { slug: string; label: string }[];
  rows: { memberPseudonym: string; ageBand: string; country: string; status: string; variables: Record<string, 'complete' | 'pending' | 'missing'> }[];
};

export type DatasetTab = 'variables' | 'documentation' | 'provenance' | 'missingness' | 'longitudinal' | 'ontology';
export type DatasetVariable = { slug: string; label: string; type: 'Structured' | 'Time series' | 'File/variants' | 'DICOM'; missingPct: number; n: number };
export type DatasetSummary = { id: number; studyId: number; studyName: string; version: number; builtAt: string; memberCount: number; status: 'current' | 'superseded' };
export type Dataset = DatasetSummary & {
  description: string;
  rowLevelN: number;
  summaryOnlyN: number;
  variables: DatasetVariable[];
  documentation: { title: string; body: string }[];
  provenance: { slug: string; label: string; classes: { cls: ProvenanceClass; pct: number }[] }[];
  missingness: { slug: string; label: string; missingPct: number; byGroup: { label: string; missingPct: number }[] }[];
  longitudinal: { slug: string; label: string; buckets: { label: string; n: number }[] }[];
  ontology: TreeNode[];
  exportRequests: { id: number; status: string; createdAt: string; variables: string[] }[];
};
export type Workspace = {
  datasetId: number;
  rowLevelN: number;
  summaryOnlyN: number;
  variables: { slug: string; label: string; n: number; mean: number | null; sd: number | null; min: number | null; max: number | null; unit: string | null }[];
};

export type VariablePreviewQuery = { concept: string; durationDays: number; minProvRank: number; targetN: number; compCents?: number };
export type VariablePreview = {
  conceptSlug: string;
  conceptName: string;
  isNewConcept: boolean;
  missingN: number;
  recruitableN: number;
  estimate: Estimate;
};
export type VariableRequest = {
  concept: string | { name: string; parentSlug: string; unit?: string; method: string; minSpanDays?: number };
  protocol: { method: string; durationDays: number; trials?: number; device?: string };
  minProvRank: number;
  targetN: number;
  compCents: number;
};

export type OntologyResponse = { domains: TreeNode[]; conceptCount: number };

// ---------- demo ----------
export type DemoState = {
  ready: boolean;
  seeded: boolean;
  persona: Persona;
  orgs: { id: number; name: string; type: string; declaredUses: string[] }[];
  writeVersion: number;
  today: string;
  now: string;
  participantPseudonym: string | null;
};
export type Health = { ok: boolean; ready: boolean; seeded: boolean };
export type Ok = { ok: true; writeVersion: number };
export type ApiError = { error: string; code?: string };
