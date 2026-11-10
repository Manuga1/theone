// Consent settings (red-lines fixed; category exclusions, recontact, commercial, pre-authorised reuse editable).
import { nowIso } from '@shared/clock';
import { PROHIBITED_USES, PROHIBITED_USE_KEYS } from '@shared/ontology';
import type { ParticipantPermissions, PermissionsUpdate } from '@shared/api-types';
import { graph } from '../db/graph';
import type { Db } from '../db/driver';
import { badRequest } from '../errors';
import { domains } from './ontology';

type Row = { excluded_categories_json: string; recontact_opt_in: number; commercial_ok: number; preauthorize_reuse_only: number };

export async function readPermissions(participantId: number, db: Db = graph()): Promise<ParticipantPermissions> {
  const r = await db.tableExists('consent_setting') ? await db.get<Row>('SELECT excluded_categories_json, recontact_opt_in, commercial_ok, preauthorize_reuse_only FROM consent_setting WHERE participant_id = ?', participantId) : undefined;
  const excluded = new Set<string>(r ? (JSON.parse(r.excluded_categories_json) as string[]) : []);
  return {
    prohibitedUses: PROHIBITED_USES.map((p) => ({ key: p.key, label: p.label, fixed: true })),
    categories: (await domains(db)).map((d) => ({ slug: d.slug, name: d.name, excluded: excluded.has(d.slug) })),
    recontactOptIn: !!(r?.recontact_opt_in ?? 1),
    commercialOk: !!(r?.commercial_ok ?? 1),
    preauthorizeReuseOnly: !!(r?.preauthorize_reuse_only ?? 0),
    note: 'Red-lines are fixed for every participant in this model. Excluding a category blocks new licenses for it; existing licenses run to the end of their term.',
  };
}

export async function updatePermissions(participantId: number, patch: PermissionsUpdate, db: Db = graph()): Promise<ParticipantPermissions> {
  const valid = new Set((await domains(db)).map((d) => d.slug));
  if (patch.excludedCategories) for (const s of patch.excludedCategories) if (!valid.has(s)) throw badRequest(`unknown category ${s}`);
  const now = nowIso();
  await db.tx(async () => {
        const exists = await db.get('SELECT 1 FROM consent_setting WHERE participant_id = ?', participantId);
        if (!exists) {
          await db.run('INSERT INTO consent_setting (participant_id, prohibited_uses_json, excluded_categories_json, recontact_opt_in, commercial_ok, preauthorize_reuse_only, willing_device, willing_protocol, willing_survey, willing_connect, updated_at, created_at) VALUES (?,?,?,?,?,?,1,1,1,1,?,?)',
                    participantId, JSON.stringify(PROHIBITED_USE_KEYS), '[]', 1, 1, 0, now, now);
        }
        if (patch.excludedCategories) await db.run('UPDATE consent_setting SET excluded_categories_json = ?, updated_at = ? WHERE participant_id = ?', JSON.stringify(patch.excludedCategories), now, participantId);
        if (patch.recontactOptIn !== undefined) await db.run('UPDATE consent_setting SET recontact_opt_in = ?, updated_at = ? WHERE participant_id = ?', patch.recontactOptIn ? 1 : 0, now, participantId);
        if (patch.commercialOk !== undefined) await db.run('UPDATE consent_setting SET commercial_ok = ?, updated_at = ? WHERE participant_id = ?', patch.commercialOk ? 1 : 0, now, participantId);
        if (patch.preauthorizeReuseOnly !== undefined) await db.run('UPDATE consent_setting SET preauthorize_reuse_only = ?, updated_at = ? WHERE participant_id = ?', patch.preauthorizeReuseOnly ? 1 : 0, now, participantId);
      });
  return await readPermissions(participantId, db);
}
