// Consent settings (red-lines fixed; category exclusions, recontact, commercial, pre-authorised reuse, vault mode editable).
// Every change appends an audit event in the same transaction; toggling vault mode gets its own event kind.
import { nowIso } from '@shared/clock';
import { PROHIBITED_USES, PROHIBITED_USE_KEYS } from '@shared/ontology';
import type { ParticipantPermissions, PermissionsUpdate } from '@shared/api-types';
import { graph } from '../db/graph';
import type { Db } from '../db/driver';
import { badRequest } from '../errors';
import { logActivity } from './activity';
import { appendAudit } from './audit';
import { domains } from './ontology';

type Row = { excluded_categories_json: string; recontact_opt_in: number; commercial_ok: number; preauthorize_reuse_only: number; vault_only: number };

const SELECT = 'SELECT excluded_categories_json, recontact_opt_in, commercial_ok, preauthorize_reuse_only, vault_only FROM consent_setting WHERE participant_id = ?';

export function readPermissions(participantId: number, db: Db = graph()): ParticipantPermissions {
  const r = db.tableExists('consent_setting') ? db.get<Row>(SELECT, participantId) : undefined;
  const excluded = new Set<string>(r ? (JSON.parse(r.excluded_categories_json) as string[]) : []);
  return {
    prohibitedUses: PROHIBITED_USES.map((p) => ({ key: p.key, label: p.label, fixed: true })),
    categories: domains(db).map((d) => ({ slug: d.slug, name: d.name, excluded: excluded.has(d.slug) })),
    recontactOptIn: !!(r?.recontact_opt_in ?? 1),
    commercialOk: !!(r?.commercial_ok ?? 1),
    preauthorizeReuseOnly: !!(r?.preauthorize_reuse_only ?? 0),
    vaultOnly: !!(r?.vault_only ?? 0),
    note: 'Red-lines are fixed for every participant in this model. Excluding a category blocks new licenses for it; existing licenses run to the end of their term. Vault mode keeps your graph private: no opportunities, no licenses, no logging rewards — your data is still yours to use.',
  };
}

export function updatePermissions(participantId: number, patch: PermissionsUpdate, db: Db = graph()): ParticipantPermissions {
  const valid = new Set(domains(db).map((d) => d.slug));
  if (patch.excludedCategories) for (const s of patch.excludedCategories) if (!valid.has(s)) throw badRequest(`unknown category ${s}`);
  const now = nowIso();
  db.tx(() => {
    const before = db.get<Row>(SELECT, participantId);
    if (!before) {
      db.run('INSERT INTO consent_setting (participant_id, prohibited_uses_json, excluded_categories_json, recontact_opt_in, commercial_ok, preauthorize_reuse_only, willing_device, willing_protocol, willing_survey, willing_connect, vault_only, updated_at, created_at) VALUES (?,?,?,?,?,?,1,1,1,1,0,?,?)',
        participantId, JSON.stringify(PROHIBITED_USE_KEYS), '[]', 1, 1, 0, now, now);
    }
    const changes: Record<string, unknown> = {};
    if (patch.excludedCategories) { db.run('UPDATE consent_setting SET excluded_categories_json = ?, updated_at = ? WHERE participant_id = ?', JSON.stringify(patch.excludedCategories), now, participantId); changes.excludedCategories = patch.excludedCategories; }
    if (patch.recontactOptIn !== undefined) { db.run('UPDATE consent_setting SET recontact_opt_in = ?, updated_at = ? WHERE participant_id = ?', patch.recontactOptIn ? 1 : 0, now, participantId); changes.recontactOptIn = !!patch.recontactOptIn; }
    if (patch.commercialOk !== undefined) { db.run('UPDATE consent_setting SET commercial_ok = ?, updated_at = ? WHERE participant_id = ?', patch.commercialOk ? 1 : 0, now, participantId); changes.commercialOk = !!patch.commercialOk; }
    if (patch.preauthorizeReuseOnly !== undefined) { db.run('UPDATE consent_setting SET preauthorize_reuse_only = ?, updated_at = ? WHERE participant_id = ?', patch.preauthorizeReuseOnly ? 1 : 0, now, participantId); changes.preauthorizeReuseOnly = !!patch.preauthorizeReuseOnly; }
    const vaultBefore = !!(before?.vault_only ?? 0);
    if (patch.vaultOnly !== undefined && !!patch.vaultOnly !== vaultBefore) {
      const on = !!patch.vaultOnly;
      db.run('UPDATE consent_setting SET vault_only = ?, updated_at = ? WHERE participant_id = ?', on ? 1 : 0, now, participantId);
      appendAudit(db, { participantId, kind: 'vault_mode_changed', refTable: 'consent_setting', refId: participantId, at: now, summary: on ? 'Vault mode switched ON — no opportunities, licenses or rewards; data kept as a private vault' : 'Vault mode switched OFF — opportunities, licensing and logging rewards resume', payload: { vaultOnly: on } });
      logActivity(db, { participantId, kind: 'vault_mode', text: on ? 'Vault mode on: your graph is private — no new opportunities, licenses or rewards' : 'Vault mode off: opportunities and logging rewards are back', occurredAt: now });
    }
    if (Object.keys(changes).length) appendAudit(db, { participantId, kind: 'permissions_changed', refTable: 'consent_setting', refId: participantId, at: now, summary: `Permissions changed: ${Object.keys(changes).join(', ')}`, payload: changes });
  });
  return readPermissions(participantId, db);
}
