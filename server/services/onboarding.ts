// Onboarding (identity → consent → mode → done). The only durable state is participant.onboarded_at; the step a
// participant is on is derived from the audit chain (every step appends an onboarding_* event), so a restart is itself
// an audited governance write and no extra table is needed. Identity comes from the vault, read by the route (the only
// vault importer) and passed in.
import { nowIso } from '@shared/clock';
import type { OnboardingInput, OnboardingState, OnboardingStep } from '@shared/api-types';
import { graph } from '../db/graph';
import type { Db } from '../db/driver';
import { badRequest } from '../errors';
import { logActivity } from './activity';
import { appendAudit } from './audit';
import { readPermissions, updatePermissions } from './permissions';

export type IdentityView = { legalName: string; email: string; dob: string; verificationStatus: string };
const NO_IDENTITY: IdentityView = { legalName: '', email: '', dob: '', verificationStatus: 'unverified' };
const NEXT: Record<string, OnboardingStep> = { onboarding_identity: 'consent', onboarding_consent: 'mode', onboarding_mode: 'done' };

function completedAt(participantId: number, db: Db): string | null {
  if (!db.tableExists('participant')) return null;
  return db.get<{ o: string | null }>('SELECT onboarded_at AS o FROM participant WHERE id = ?', participantId)?.o ?? null;
}
/** The step after the last onboarding event since the last restart; 'identity' when none. */
export function currentStep(participantId: number, db: Db): OnboardingStep {
  if (completedAt(participantId, db)) return 'done';
  if (!db.tableExists('audit_event')) return 'identity';
  const last = db.get<{ kind: string }>("SELECT kind FROM audit_event WHERE participant_id = ? AND kind LIKE 'onboarding_%' ORDER BY id DESC LIMIT 1", participantId)?.kind;
  if (!last || last === 'onboarding_restarted' || last === 'onboarding_completed') return 'identity';
  return NEXT[last] ?? 'identity';
}

export function onboardingState(participantId: number, identity: IdentityView | undefined, db: Db = graph()): OnboardingState {
  const id = identity ?? NO_IDENTITY;
  const p = readPermissions(participantId, db);
  const status: OnboardingState['identity']['status'] = id.verificationStatus === 'verified' ? 'verified' : id.verificationStatus === 'pending' ? 'pending' : 'unverified';
  return {
    completed: !!completedAt(participantId, db),
    step: currentStep(participantId, db),
    identity: { status, legalName: id.legalName, email: id.email, dob: id.dob },
    consent: { recontactOptIn: p.recontactOptIn, commercialOk: p.commercialOk, excludedCategories: p.categories.filter((c) => c.excluded).map((c) => c.slug), prohibitedUses: p.prohibitedUses.map((u) => u.key) },
    vaultOnly: !!p.vaultOnly,
  };
}

export function advanceOnboarding(participantId: number, input: OnboardingInput, identity: IdentityView | undefined, db: Db = graph()): OnboardingState {
  const step = (input as { step?: string } | null)?.step;
  const now = nowIso();
  db.tx(() => {
    switch (step) {
      case 'identity': {
        if ((input as { confirm?: unknown }).confirm !== true) throw badRequest('identity step needs { confirm: true }');
        appendAudit(db, { participantId, kind: 'onboarding_identity', refTable: 'participant', refId: participantId, at: now, summary: 'Onboarding: identity confirmed (kept in the vault; never shared with researchers)', payload: { verificationStatus: identity?.verificationStatus ?? 'unverified' } });
        break;
      }
      case 'consent': {
        const i = input as Extract<OnboardingInput, { step: 'consent' }>;
        updatePermissions(participantId, { recontactOptIn: !!i.recontactOptIn, commercialOk: !!i.commercialOk, excludedCategories: Array.isArray(i.excludedCategories) ? i.excludedCategories.map(String) : [] }, db);
        appendAudit(db, { participantId, kind: 'onboarding_consent', refTable: 'consent_setting', refId: participantId, at: now, summary: 'Onboarding: consent settings chosen (red-lines fixed)', payload: { recontactOptIn: !!i.recontactOptIn, commercialOk: !!i.commercialOk, excludedCategories: i.excludedCategories ?? [] } });
        break;
      }
      case 'mode': {
        const i = input as Extract<OnboardingInput, { step: 'mode' }>;
        updatePermissions(participantId, { vaultOnly: !!i.vaultOnly }, db);
        appendAudit(db, { participantId, kind: 'onboarding_mode', refTable: 'consent_setting', refId: participantId, at: now, summary: `Onboarding: ${i.vaultOnly ? 'vault mode (private vault, no research use)' : 'earning mode (opportunities, licenses, logging rewards)'} chosen`, payload: { vaultOnly: !!i.vaultOnly } });
        break;
      }
      case 'done': {
        if (!completedAt(participantId, db)) {
          db.run('UPDATE participant SET onboarded_at = ? WHERE id = ?', now, participantId);
          appendAudit(db, { participantId, kind: 'onboarding_completed', refTable: 'participant', refId: participantId, at: now, summary: 'Onboarding completed', payload: { onboardedAt: now } });
          logActivity(db, { participantId, kind: 'onboarding', text: 'Onboarding completed — your graph is ready', occurredAt: now });
        }
        break;
      }
      case 'restart': {
        db.run('UPDATE participant SET onboarded_at = NULL WHERE id = ?', participantId);
        appendAudit(db, { participantId, kind: 'onboarding_restarted', refTable: 'participant', refId: participantId, at: now, summary: 'Onboarding restarted (data, consents and licenses untouched)', payload: {} });
        break;
      }
      default:
        throw badRequest("step must be one of 'identity' | 'consent' | 'mode' | 'done' | 'restart'");
    }
  });
  return onboardingState(participantId, identity, db);
}
