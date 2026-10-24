-- Health graph schema. STRICT tables, integer cents, ISO text dates. No direct identifiers live here (see vault-schema.sql).
-- Applied idempotently by server/db/migrate.ts.

CREATE TABLE IF NOT EXISTS participant (
  id INTEGER PRIMARY KEY,
  pseudonym TEXT NOT NULL UNIQUE,
  sex TEXT NOT NULL,
  birth_year INTEGER NOT NULL,
  country TEXT NOT NULL,
  region TEXT,
  enrolled_at TEXT NOT NULL,
  is_detailed INTEGER NOT NULL DEFAULT 0,
  tier INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS ix_participant_demo ON participant(country, birth_year, sex);
CREATE INDEX IF NOT EXISTS ix_participant_detailed ON participant(is_detailed);

CREATE TABLE IF NOT EXISTS concept (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  parent_id INTEGER REFERENCES concept(id),
  name TEXT NOT NULL,
  level TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 0,
  unit TEXT,
  data_type TEXT,
  min_span_days INTEGER NOT NULL DEFAULT 0,
  freshness_days INTEGER,
  collection_method TEXT,
  enrichable INTEGER NOT NULL DEFAULT 0,
  comp_cents INTEGER NOT NULL DEFAULT 0,
  device_cost_cents INTEGER NOT NULL DEFAULT 0,
  reuse_comp_cents INTEGER NOT NULL DEFAULT 0,
  in_ring INTEGER NOT NULL DEFAULT 0,
  in_list INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS ix_concept_parent ON concept(parent_id, sort_order);

CREATE TABLE IF NOT EXISTS source (
  id INTEGER PRIMARY KEY,
  participant_id INTEGER NOT NULL REFERENCES participant(id),
  kind TEXT NOT NULL,
  vendor TEXT NOT NULL,
  label TEXT NOT NULL,
  action_label TEXT NOT NULL DEFAULT 'Connect',
  status TEXT NOT NULL DEFAULT 'available',
  connected_at TEXT,
  last_sync_at TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS ix_source_participant ON source(participant_id, status);

CREATE TABLE IF NOT EXISTS artifact (
  id INTEGER PRIMARY KEY,
  participant_id INTEGER NOT NULL REFERENCES participant(id),
  source_id INTEGER REFERENCES source(id),
  kind TEXT NOT NULL,
  uri TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0,
  captured_at TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS ix_artifact_participant ON artifact(participant_id, kind);

CREATE TABLE IF NOT EXISTS observation (
  id INTEGER PRIMARY KEY,
  participant_id INTEGER NOT NULL REFERENCES participant(id),
  concept_id INTEGER NOT NULL REFERENCES concept(id),
  value_num REAL,
  value_text TEXT,
  value_json TEXT,
  unit TEXT,
  observed_at TEXT NOT NULL,
  valid_from TEXT,
  valid_to TEXT,
  source_id INTEGER REFERENCES source(id),
  method TEXT,
  provenance_class TEXT NOT NULL,
  provenance_rank INTEGER NOT NULL,
  verification TEXT NOT NULL DEFAULT 'unverified',
  confidence REAL,
  artifact_id INTEGER REFERENCES artifact(id),
  derived_from_id INTEGER REFERENCES observation(id),
  derivation TEXT,
  contribution_id INTEGER,
  deleted_at TEXT,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS ix_observation_pco ON observation(participant_id, concept_id, observed_at);
CREATE INDEX IF NOT EXISTS ix_observation_source ON observation(source_id);

CREATE TABLE IF NOT EXISTS event (
  id INTEGER PRIMARY KEY,
  participant_id INTEGER NOT NULL REFERENCES participant(id),
  occurred_at TEXT NOT NULL,
  kind TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  concept_id INTEGER REFERENCES concept(id),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS ix_event_participant ON event(participant_id, occurred_at);

CREATE TABLE IF NOT EXISTS condition (
  id INTEGER PRIMARY KEY,
  participant_id INTEGER NOT NULL REFERENCES participant(id),
  concept_id INTEGER NOT NULL REFERENCES concept(id),
  onset_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  provenance_class TEXT NOT NULL DEFAULT 'clinical_source',
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS ix_condition_pc ON condition(participant_id, concept_id);
CREATE INDEX IF NOT EXISTS ix_condition_concept ON condition(concept_id);

CREATE TABLE IF NOT EXISTS participant_coverage (
  participant_id INTEGER NOT NULL REFERENCES participant(id),
  concept_id INTEGER NOT NULL REFERENCES concept(id),
  first_at TEXT NOT NULL,
  last_at TEXT NOT NULL,
  span_days INTEGER NOT NULL DEFAULT 0,
  n_obs INTEGER NOT NULL DEFAULT 0,
  best_prov_rank INTEGER NOT NULL DEFAULT 0,
  verified_n INTEGER NOT NULL DEFAULT 0,
  self_report_n INTEGER NOT NULL DEFAULT 0,
  last_value_num REAL,
  protocol_days INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (participant_id, concept_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ix_coverage_concept ON participant_coverage(concept_id, span_days, best_prov_rank);

CREATE TABLE IF NOT EXISTS consent_setting (
  participant_id INTEGER PRIMARY KEY REFERENCES participant(id),
  prohibited_uses_json TEXT NOT NULL,
  excluded_categories_json TEXT NOT NULL DEFAULT '[]',
  recontact_opt_in INTEGER NOT NULL DEFAULT 1,
  commercial_ok INTEGER NOT NULL DEFAULT 1,
  preauthorize_reuse_only INTEGER NOT NULL DEFAULT 0,
  willing_device INTEGER NOT NULL DEFAULT 1,
  willing_protocol INTEGER NOT NULL DEFAULT 1,
  willing_survey INTEGER NOT NULL DEFAULT 1,
  willing_connect INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS ix_consent_recontact ON consent_setting(recontact_opt_in);

CREATE TABLE IF NOT EXISTS demand_watch (
  id INTEGER PRIMARY KEY,
  participant_id INTEGER NOT NULL REFERENCES participant(id),
  concept_id INTEGER NOT NULL REFERENCES concept(id),
  created_at TEXT NOT NULL,
  UNIQUE (participant_id, concept_id)
) STRICT;

CREATE TABLE IF NOT EXISTS buyer_org (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  declared_uses_json TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS cohort_definition (
  id INTEGER PRIMARY KEY,
  buyer_org_id INTEGER NOT NULL REFERENCES buyer_org(id),
  name TEXT NOT NULL,
  criteria_json TEXT NOT NULL,
  criteria_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS ix_cohort_org ON cohort_definition(buyer_org_id);

CREATE TABLE IF NOT EXISTS study (
  id INTEGER PRIMARY KEY,
  buyer_org_id INTEGER NOT NULL REFERENCES buyer_org(id),
  cohort_definition_id INTEGER REFERENCES cohort_definition(id),
  name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  use_tags_json TEXT NOT NULL DEFAULT '[]',
  license_term_months INTEGER NOT NULL DEFAULT 12,
  target_n INTEGER NOT NULL DEFAULT 0,
  salt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  advanced_days INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS ix_study_org ON study(buyer_org_id, status);

CREATE TABLE IF NOT EXISTS campaign (
  id INTEGER PRIMARY KEY,
  study_id INTEGER NOT NULL REFERENCES study(id),
  parent_campaign_id INTEGER REFERENCES campaign(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  target_complete_n INTEGER NOT NULL DEFAULT 0,
  eligible_n INTEGER NOT NULL DEFAULT 0,
  variables_json TEXT NOT NULL DEFAULT '[]',
  estimate_json TEXT,
  launched_at TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS ix_campaign_study ON campaign(study_id, status);

CREATE TABLE IF NOT EXISTS opportunity (
  id INTEGER PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaign(id),
  participant_id INTEGER NOT NULL REFERENCES participant(id),
  status TEXT NOT NULL DEFAULT 'offered',
  missing_concepts_json TEXT NOT NULL DEFAULT '[]',
  comp_max_cents INTEGER NOT NULL DEFAULT 0,
  offered_at TEXT NOT NULL,
  viewed_at TEXT,
  reviewed_at TEXT,
  responded_at TEXT,
  completed_at TEXT,
  replaced_by_id INTEGER REFERENCES opportunity(id),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS ix_opportunity_participant ON opportunity(participant_id, status);
CREATE INDEX IF NOT EXISTS ix_opportunity_campaign ON opportunity(campaign_id, status);

CREATE TABLE IF NOT EXISTS consent_grant (
  id INTEGER PRIMARY KEY,
  participant_id INTEGER NOT NULL REFERENCES participant(id),
  study_id INTEGER NOT NULL REFERENCES study(id),
  opportunity_id INTEGER REFERENCES opportunity(id),
  scope_concepts_json TEXT NOT NULL DEFAULT '[]',
  withheld_json TEXT NOT NULL DEFAULT '["identity"]',
  purpose TEXT NOT NULL,
  term_months INTEGER NOT NULL DEFAULT 12,
  reuse_allowed INTEGER NOT NULL DEFAULT 0,
  recontact_via_platform INTEGER NOT NULL DEFAULT 1,
  granted_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS ix_grant_participant ON consent_grant(participant_id, study_id);

CREATE TABLE IF NOT EXISTS enrollment (
  id INTEGER PRIMARY KEY,
  participant_id INTEGER NOT NULL REFERENCES participant(id),
  study_id INTEGER NOT NULL REFERENCES study(id),
  campaign_id INTEGER REFERENCES campaign(id),
  opportunity_id INTEGER REFERENCES opportunity(id),
  consent_grant_id INTEGER REFERENCES consent_grant(id),
  status TEXT NOT NULL DEFAULT 'active',
  enrolled_at TEXT NOT NULL,
  completed_at TEXT,
  withdrawn_at TEXT,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS ix_enrollment_participant ON enrollment(participant_id, status);
CREATE INDEX IF NOT EXISTS ix_enrollment_study ON enrollment(study_id, status);

CREATE TABLE IF NOT EXISTS contribution (
  id INTEGER PRIMARY KEY,
  opportunity_id INTEGER NOT NULL REFERENCES opportunity(id),
  participant_id INTEGER NOT NULL REFERENCES participant(id),
  concept_id INTEGER NOT NULL REFERENCES concept(id),
  status TEXT NOT NULL DEFAULT 'pending',
  method TEXT NOT NULL DEFAULT 'protocol',
  duration_days INTEGER NOT NULL DEFAULT 1,
  comp_cents INTEGER NOT NULL DEFAULT 0,
  artifact_id INTEGER REFERENCES artifact(id),
  observation_count INTEGER NOT NULL DEFAULT 0,
  submitted_at TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS ix_contribution_opportunity ON contribution(opportunity_id, status);
CREATE INDEX IF NOT EXISTS ix_contribution_participant ON contribution(participant_id, status);

CREATE TABLE IF NOT EXISTS license (
  id INTEGER PRIMARY KEY,
  number INTEGER NOT NULL UNIQUE,
  study_id INTEGER NOT NULL REFERENCES study(id),
  buyer_org_id INTEGER NOT NULL REFERENCES buyer_org(id),
  participant_id INTEGER NOT NULL REFERENCES participant(id),
  consent_grant_id INTEGER REFERENCES consent_grant(id),
  enrollment_id INTEGER REFERENCES enrollment(id),
  scope_concepts_json TEXT NOT NULL DEFAULT '[]',
  purpose TEXT NOT NULL,
  term_start TEXT NOT NULL,
  term_end TEXT NOT NULL,
  gross_cents INTEGER NOT NULL,
  participant_cents INTEGER NOT NULL,
  platform_cents INTEGER NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS ix_license_participant ON license(participant_id, term_end);
CREATE INDEX IF NOT EXISTS ix_license_study ON license(study_id);

CREATE TABLE IF NOT EXISTS license_line (
  id INTEGER PRIMARY KEY,
  license_id INTEGER NOT NULL REFERENCES license(id),
  concept_id INTEGER NOT NULL REFERENCES concept(id),
  cents INTEGER NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS ix_license_line ON license_line(license_id);
CREATE INDEX IF NOT EXISTS ix_license_line_concept ON license_line(concept_id);

CREATE TABLE IF NOT EXISTS ledger_entry (
  id INTEGER PRIMARY KEY,
  participant_id INTEGER NOT NULL REFERENCES participant(id),
  kind TEXT NOT NULL,
  study_id INTEGER REFERENCES study(id),
  license_id INTEGER REFERENCES license(id),
  contribution_id INTEGER REFERENCES contribution(id),
  gross_cents INTEGER NOT NULL,
  participant_cents INTEGER NOT NULL,
  platform_cents INTEGER NOT NULL,
  occurred_at TEXT NOT NULL,
  memo TEXT,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS ix_ledger_participant ON ledger_entry(participant_id, occurred_at);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY,
  participant_id INTEGER REFERENCES participant(id),
  buyer_org_id INTEGER REFERENCES buyer_org(id),
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  amount_cents INTEGER,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS ix_activity_participant ON activity(participant_id, occurred_at);
CREATE INDEX IF NOT EXISTS ix_activity_org ON activity(buyer_org_id, occurred_at);

CREATE TABLE IF NOT EXISTS dataset (
  id INTEGER PRIMARY KEY,
  study_id INTEGER NOT NULL REFERENCES study(id),
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'current',
  description TEXT,
  salt TEXT NOT NULL DEFAULT '',
  variables_json TEXT NOT NULL DEFAULT '[]',
  built_at TEXT NOT NULL,
  member_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS ix_dataset_study ON dataset(study_id, version);

CREATE TABLE IF NOT EXISTS dataset_member (
  id INTEGER PRIMARY KEY,
  dataset_id INTEGER NOT NULL REFERENCES dataset(id),
  participant_id INTEGER NOT NULL REFERENCES participant(id),
  member_pseudonym TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'row_level',
  added_at TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS ix_dataset_member ON dataset_member(dataset_id, participant_id);

CREATE TABLE IF NOT EXISTS export_request (
  id INTEGER PRIMARY KEY,
  dataset_id INTEGER NOT NULL REFERENCES dataset(id),
  buyer_org_id INTEGER NOT NULL REFERENCES buyer_org(id),
  status TEXT NOT NULL DEFAULT 'requested',
  variables_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
) STRICT;
