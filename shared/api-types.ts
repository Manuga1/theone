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

export type TreeNode = TreeNodeExtras & {
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
  // --- additive (backend core): collection defaults so the buyer UI can build campaign variables from the tree ---
  /** explicit weight within the parent (children sum to 1) */
  weight?: number;
  /** default participant compensation (net cents) for collecting this leaf */
  compCents?: number;
  /** default device / test cost (cents) per collection */
  deviceCostCents?: number;
  /** additive: license (reuse) fee in net cents when a campaign reuses existing data for this leaf */
  reuseCompCents?: number;
  /** the platform has a collection protocol for this leaf */
  enrichable?: boolean;
  /** span required for "verified" */
  minSpanDays?: number;
  collectionMethod?: string | null;
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

export type ParticipantHome = HomeExtras & {
  participant: { pseudonym: string; firstName: string; age: number };
  completeness: { pct: number; deltaMonth: number };
  verifiedSources: number;
  lifetimeEarningsCents: number;
  licensedUses: number;
  opportunities: { count: number; maxCents: number };
  ring: RingNode[];
  whatChanged: ActivityItem[];
  /** additive: true when no detailed participant exists (schema-only database) */
  empty?: boolean;
};

export type ParticipantSignature = {
  domains: TreeNode[];
  legend: { key: NodeState | 'opportunity' | 'demand'; label: string }[];
};

export type SeriesPoint = { t: string; values: Record<string, number> };

export type NodeDetail = NodeTypedViews & {
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

export type SourceCard = SourceCardExtras & {
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
  /** additive (vault mode): set when the marketplace is switched off for this participant — items are then empty */
  disabledReason?: string | null;
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
export type ParticipantLedger = LedgerExtras & {
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
  /** vault mode: no opportunities, no licensing, no rewards; the participant uses the graph purely as a vault */
  vaultOnly?: boolean;
  note: string;
};
export type PermissionsUpdate = Partial<Pick<ParticipantPermissions, 'recontactOptIn' | 'commercialOk' | 'preauthorizeReuseOnly' | 'vaultOnly'>> & {
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
  /** additive: what the bars measure (share of the cohort base with ANY data, including data collected by running campaigns) */
  barsNote?: string;
  consent: { blocked: boolean; reason: string | null };
  timingMs: number;
};

export type SavedCohort = { id: number; name: string; criteria: CohortCriteria; createdAt: string; orgId: number };
/** additive: GET /buyer/cohorts/:id returns the saved cohort together with its (cached) preview */
export type SavedCohortDetail = SavedCohort & { preview: CohortPreview };
/** additive: GET /buyer/cohorts returns this */
export type SavedCohortList = { cohorts: SavedCohort[] };
/** additive: POST /buyer/cohorts body */
export type CohortCreate = { name: string; criteria: CohortCriteria };

export type CostLine = { key: 'participant_comp' | 'devices_testing' | 'data_preparation' | 'platform_recruitment'; label: string; cents: number };
export type Estimate = {
  targetN: number;
  pool: number;
  /** collection contacts (members with ≥ 1 variable to collect) */
  contacts: number;
  /** additive: ready-now members offered a reuse-only license at launch (set on the stored estimate after launch) */
  reuseOnlyOffered?: number;
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
  /** `counters` on StudyDetail/StudySummary are the ROOT campaign's; each campaign (root and variable-request children) carries its own here (additive) */
  campaigns: { id: number; name: string; status: CampaignStatus; parentCampaignId: number | null; counters: StudyCounters }[];
  /** per-variable coverage; `started` is the denominator of the campaign that collects/reuses the variable */
  coverage: { slug: string; label: string; pct: number; verified: number; started: number; campaignId?: number }[];
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
  /** additive: the tab this payload was built for (`?tab=`), or undefined when every tab is included */
  tab?: DatasetTab;
  description: string;
  rowLevelN: number;
  summaryOnlyN: number;
  variables: DatasetVariable[];
  documentation: { title: string; body: string }[];
  /** `classified` (additive): share of the variable's observations among dataset members that the ingestion classifier filed, with their mean confidence */
  provenance: { slug: string; label: string; classes: { cls: ProvenanceClass; pct: number }[]; classified?: { pct: number; meanConfidence: number | null; classifier: ClassifierName | null } }[];
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
  /** true on a hosted (serverless) deployment: state lives on the serving instance and may reset */
  hosted?: boolean;
  /** which classifier files uploads and quick logs: 'claude' when an Anthropic credential is configured, else 'rules' */
  classifier?: ClassifierName;
  /** true when reset / advance need the admin token header (hosted deployments) */
  adminRequired?: boolean;
};
export type Health = { ok: boolean; ready: boolean; seeded: boolean };
export type Ok = { ok: true; writeVersion: number };
export type ApiError = { error: string; code?: string };

// ---------- additive (backend loop): list wrappers and mutation results ----------
/** GET /buyer/studies */
export type StudyList = { studies: StudySummary[] };
/** GET /buyer/campaigns */
export type CampaignList = { campaigns: Campaign[] };
/** GET /buyer/datasets */
export type DatasetList = { datasets: DatasetSummary[] };
/** POST /buyer/studies/:id/advance body */
export type AdvanceRequest = { days: number };
/** POST /buyer/studies/:id/advance result: how many opportunities changed state during the simulated days */
export type AdvanceResult = Ok & { days: number; totalDays: number; transitions: Record<string, number>; completions: number; counters: StudyCounters; datasetId: number | null; datasetVersion: number | null };
/** POST /buyer/studies/:id/recontact result */
export type RecontactResult = Ok & { replaced: number; offered: number; poolExhausted: boolean; counters: StudyCounters };
/** POST /buyer/studies/:id/variables result */
export type VariableRequestResult = Ok & { campaign: Campaign; conceptSlug: string; isNewConcept: boolean; offered: number; watchersNotified: number };
/** POST /buyer/datasets/:id/refresh result */
export type DatasetRefreshResult = Ok & { datasetId: number; version: number; memberCount: number; dropped: number; added: number };
/** POST /buyer/datasets/:id/export-request body + result */
export type ExportRequestInput = { variables?: string[] };
export type ExportRequestResult = Ok & { id: number; status: string; variables: string[] };
/** POST /participant/opportunities/:id/accept result */
export type AcceptResult = Ok & { enrollmentId: number; licenseId: number; licenseNumber: string; contributionIds: number[] };
/** POST /participant/contributions/:id/simulate result */
export type SimulateResult = Ok & { contributionId: number; status: 'verified'; observationCount: number; artifactCount: number; paidCents: number; opportunityStatus: OpportunityStatus; opportunityComplete: boolean };
/** DELETE /participant/categories/:domain result */
export type CategoryDeleteResult = Ok & { domain: string; observationsDeleted: number; excluded: boolean };
/** POST /demo/reset body + result */
export type DemoResetInput = { scale?: number; schemaOnly?: boolean };
export type DemoResetResult = Ok & { seeded: boolean; participants: number; ms: number };

// =====================================================================================================
// Ingestion, quick log, branching, rewards, vault mode, onboarding, audit chain (added for the notes of 2026-11-10)
// =====================================================================================================

/** How a leaf's values behave. one_time = updatable fact (age, family history): updates append, old rows keep valid_to. */
export type ValueKind = 'continuous' | 'float' | 'boolean' | 'text' | 'one_time' | 'categorical' | 'file' | 'photo';
export type IngestKind = 'upload' | 'quicklog' | 'photo' | 'voice' | 'apple_health' | 'checkin';
export type IngestStatus = 'queued' | 'auto_filed' | 'needs_review' | 'accepted' | 'discarded';
export type ClassifierName = 'rules' | 'claude';

export type NewConceptProposal = { name: string; parentSlug: string; valueKind: ValueKind; unit?: string | null; isVariantOf?: string | null };
export type FollowUp = { attribute: string; question: string; options?: string[]; createsSubBranch: boolean };
export type Extracted = {
  valueNum?: number | null;
  valueText?: string | null;
  valueBool?: boolean | null;
  unit?: string | null;
  observedAt?: string | null;
  attributes?: Record<string, string>;
  context?: 'rest' | 'exercise' | 'sleep' | null;
};
export type Proposal = {
  conceptSlug: string | null;
  conceptName: string | null;
  path: string[];
  newConcept: NewConceptProposal | null;
  confidence: number;
  rationale: string;
  extracted: Extracted;
  followUp: FollowUp | null;
  classifier: ClassifierName;
  alternatives: { conceptSlug: string; conceptName: string; confidence: number }[];
};

export type IngestItem = {
  id: number;
  kind: IngestKind;
  status: IngestStatus;
  filename: string | null;
  bytes: number | null;
  mime: string | null;
  text: string | null;
  proposal: Proposal | null;
  reviewReason: string | null;
  conceptSlug: string | null;
  conceptName: string | null;
  observationId: number | null;
  observationCount: number;
  rewardCents: number;
  createdAt: string;
  relative: string;
};
export type IngestQueue = {
  items: IngestItem[];
  counts: Record<IngestStatus, number>;
  classifier: ClassifierName;
  maxFileBytes: number;
  acceptedTypes: string[];
  reviewThreshold: number;
};
export type UploadFileInput = { name: string; bytes: number; mime: string; sha256?: string | null; textSample?: string | null; lastModified?: string | null };
export type UploadResult = { items: IngestItem[]; autoFiled: number; needsReview: number; rejected: { name: string; reason: string }[]; rewardCents: number };
export type ReviewAction =
  | { action: 'accept' }
  | { action: 'move'; conceptSlug: string }
  | { action: 'create_branch'; newConcept: NewConceptProposal }
  | { action: 'discard' };
export type ReviewResult = { item: IngestItem; createdConcept: { slug: string; name: string; path: string[] } | null; rewardCents: number };

export type QuickLogInput = { text: string; via?: 'text' | 'voice'; pendingId?: number | null; answer?: string | null };
export type QuickLogResult = {
  status: 'filed' | 'follow_up' | 'needs_review';
  item: IngestItem;
  followUp: FollowUp | null;
  filedAs: { conceptSlug: string; conceptName: string; path: string[]; valueLabel: string; newBranch: boolean; observedAt: string } | null;
  rewardCents: number;
  message: string;
};

export type RewardRule = {
  id: number;
  conceptSlug: string;
  conceptName: string;
  cents: number;
  perUnitLabel: string;
  dailyCapCents: number | null;
  fundedBy: { kind: 'campaign' | 'platform'; name: string; studyId: number | null };
  today: { count: number; cents: number };
};
export type LoggingRewards = {
  enabled: boolean;
  disabledReason: string | null;
  rules: RewardRule[];
  todayCents: number;
  weekCents: number;
  streakDays: number;
};
export type CheckInPrompt = { id: string; conceptSlug: string; conceptName: string; question: string; valueKind: ValueKind; options?: string[]; unit?: string | null };
export type CheckIn = { date: string; done: boolean; prompts: CheckInPrompt[]; streakDays: number; rewardCents: number };
export type CheckInInput = { answers: { id: string; value: string | number | boolean | null }[] };
export type CheckInResult = { filed: number; rewardCents: number; streakDays: number; items: IngestItem[] };

export type OnboardingStep = 'identity' | 'consent' | 'mode' | 'done';
export type OnboardingState = {
  completed: boolean;
  step: OnboardingStep;
  identity: { status: 'unverified' | 'pending' | 'verified'; legalName: string; email: string; dob: string };
  consent: { recontactOptIn: boolean; commercialOk: boolean; excludedCategories: string[]; prohibitedUses: string[] };
  vaultOnly: boolean;
};
export type OnboardingInput =
  | { step: 'identity'; confirm: true }
  | { step: 'consent'; recontactOptIn: boolean; commercialOk: boolean; excludedCategories: string[] }
  | { step: 'mode'; vaultOnly: boolean }
  | { step: 'done' }
  | { step: 'restart' };

export type AuditEvent = {
  id: number;
  at: string;
  kind: string;
  summary: string;
  refTable: string | null;
  refId: number | null;
  hash: string;
  prevHash: string;
};
export type AuditAnchor = { date: string; root: string; events: number; status: 'simulated' | 'published'; note: string };
export type AuditVerify = { ok: boolean; events: number; headHash: string | null; brokenAt: number | null; verifiedAt: string };
export type AuditLog = { events: AuditEvent[]; total: number; headHash: string | null; anchors: AuditAnchor[]; verify: AuditVerify; explanation: string };

export type AppleHealthImportResult = { records: number; imported: number; skipped: number; byConcept: { conceptSlug: string; conceptName: string; n: number }[]; artifactId: number | null; item: IngestItem };

/** Additive fields on existing types (all optional so older callers keep compiling). */
export type NodeHistoryRow = { id: number; observedAt: string; validFrom: string | null; validTo: string | null; valueLabel: string; provenance: string; verification: string; current: boolean };
export type NodeVariant = { slug: string; name: string; nObs: number; lastAt: string | null; createdAt: string; isNew: boolean };
export type NodeTypedViews = {
  valueKind?: ValueKind;
  history?: NodeHistoryRow[];
  textLog?: { id: number; observedAt: string; text: string; attributes: Record<string, string> }[];
  booleanStrip?: { date: string; value: boolean | null }[];
  variants?: NodeVariant[];
  classified?: { n: number; meanConfidence: number | null; classifier: ClassifierName | null };
  lastLoggedAt?: string | null;
  lastLoggedRelative?: string | null;
};
export type TreeNodeExtras = { valueKind?: ValueKind; isNew?: boolean; lastLoggedAt?: string | null; lastLoggedRelative?: string | null; variantCount?: number };
export type HomeExtras = {
  vaultOnly?: boolean;
  checkIn?: { done: boolean; promptCount: number; streakDays: number };
  rewardsToday?: { cents: number; count: number };
  inbox?: { needsReview: number; autoFiledToday: number };
  onboardingCompleted?: boolean;
};
export type LedgerExtras = { rewardsToday?: number; audit?: { headHash: string | null; ok: boolean; events: number }; groups?: { date: string; label: string; cents: number; count: number; entryIds: number[] }[] };
export type SourceCardExtras = { kindGroup?: 'records' | 'labs' | 'wearable' | 'genomics' | 'imaging' | 'nutrition' | 'device' | 'survey' | 'import'; health?: 'ok' | 'needs_attention' | 'never_synced'; errorText?: string | null; importFormats?: string[] };
