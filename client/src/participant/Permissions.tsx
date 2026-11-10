// Permissions: fixed red-lines, category exclusions, recontact, commercial use, pre-authorised reuse-only licensing and
// the vault-only mode from the 2026-11-10 notes ("users can opt to use it purely as a vault, no data selling").
import { Lock, ShieldOff, Vault, Sparkles, Wallet, FileSignature, Check, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ParticipantPermissions, PermissionsUpdate } from '@shared/api-types';
import { useApi } from '../hooks';
import { api } from '../api';
import { useAction } from '../useAction';
import { Card, ErrorBox, domainStyle } from '../components';

/** The vault-only switch: what turns off, what stays, and that existing licenses run to term. */
export function VaultModeCard({ on, busy, onChange, served }: { on: boolean; busy?: boolean; onChange: (v: boolean) => void; served: boolean }) {
  const effects: { icon: React.ReactNode; label: string; off: string }[] = [
    { icon: <Sparkles />, label: 'Research opportunities', off: 'None are offered; the cohort engine leaves you out of every count.' },
    { icon: <FileSignature />, label: 'New licenses', off: 'Nothing new is licensed or sold. Licenses already in term run to their end date.' },
    { icon: <Wallet />, label: 'Logging rewards', off: 'No micro-payments for logs, photos or check-ins; everything is still filed.' },
  ];
  return (
    <Card title="Vault mode" sub="Use your health graph purely as a vault: stored, organised and verified for you — nothing sold." right={<span className={`pill ${on ? 'pill--dark' : 'pill--outline'}`} data-testid="vault-pill"><Vault style={{ width: 10, height: 10 }} /> {on ? 'On' : 'Off'}</span>}>
      <div className="redline">
        <span className="redline__icon" style={on ? { background: 'var(--dark)', color: '#fff' } : undefined}><Vault /></span>
        <span className="redline__text"><div className="strong">Vault only — no data selling</div><div className="small muted">{on ? 'Your data is yours alone right now. Switch off to see opportunities and earn again.' : 'Keep everything you upload and log, but opt out of research licensing and rewards entirely.'}</div></span>
        <Switch on={on} disabled={busy || !served} label="Vault only" onChange={onChange} />
      </div>
      <div className="vault-effects">
        {effects.map((e) => (
          <div className="vault-effect" key={e.label}>
            <span className={`list__icon${on ? '' : ' list__icon--green'}`}>{e.icon}</span>
            <div><div className="strong row gap-6">{e.label} {on ? <span className="pill pill--neutral pill--sm"><X style={{ width: 9, height: 9 }} /> off</span> : <span className="pill pill--verified pill--sm"><Check style={{ width: 9, height: 9 }} /> on</span>}</div><div className="tiny muted">{on ? e.off : 'Available while vault mode is off.'}</div></div>
          </div>
        ))}
      </div>
      <div className="note mt-12">
        {served
          ? <>Toggling vault mode writes a tamper-evident audit event; see the <Link to="/p/earnings">audit card on Earnings</Link>. Your identity vault is separate and never affected.</>
          : 'This API does not serve the vault-only flag yet; the switch is read-only until it does.'}
      </div>
    </Card>
  );
}

function Switch({ on, onChange, disabled, label }: { on: boolean; onChange?: (v: boolean) => void; disabled?: boolean; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch${on ? ' switch--on' : ''}`} disabled={disabled} onClick={() => onChange?.(!on)} />;
}

export default function PermissionsPage() {
  const q = useApi<ParticipantPermissions>('/participant/permissions');
  const save = useAction(async (patch: PermissionsUpdate) => api.put('/participant/permissions', patch), { success: 'Permissions updated' });
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data;
  if (!d) return <div className="faint small">Loading…</div>;
  const excluded = d.categories.filter((c) => c.excluded).map((c) => c.slug);
  const toggleCategory = (slug: string, exclude: boolean) => save.run({ excludedCategories: exclude ? [...excluded, slug] : excluded.filter((s) => s !== slug) });
  const vault = d.vaultOnly === true;

  return (
    <div className="col gap-16">
      <div className="page-head--row" style={{ marginBottom: 0 }}>
        <div><h1 className="h1">Permissions</h1><div className="sub">You are the principal. These settings decide who can license your data and for what.</div></div>
      </div>
      {vault && <div className="callout callout--amber row gap-8" style={{ alignItems: 'center' }}><Vault style={{ width: 14, height: 14, flex: '0 0 14px' }} /> Vault mode is on: no opportunities, no new licenses, no logging rewards. Your graph keeps filing everything you add.</div>}
      <div className="grid grid--2 gap-16">
        <Card title="Red-lines" sub="Prohibited for every participant. Organisations declaring any of these uses see zero participants and cannot create cohorts." right={<span className="redline__lock"><Lock /> Fixed</span>}>
          {d.prohibitedUses.map((p) => (
            <div className="redline" key={p.key}>
              <span className="redline__icon"><ShieldOff /></span>
              <span className="redline__text">{p.label}</span>
              <Switch on disabled label={p.label} />
            </div>
          ))}
          <div className="note mt-12">Red-lines are enforced in the cohort engine, not only in the UI: a red-lined purpose zeroes every funnel stage and campaign creation is refused.</div>
        </Card>
        <div className="col gap-16">
          <VaultModeCard on={vault} busy={save.busy} served={d.vaultOnly !== undefined} onChange={(v) => save.run({ vaultOnly: v })} />
          <Card title="Category exclusions" sub="Excluding a category blocks new licenses for it. Existing licenses run to the end of their term.">
            {d.categories.map((c) => {
              const s = domainStyle(c.slug);
              const I = s.icon;
              return (
                <div className="redline" key={c.slug}>
                  <span className="ctree__domain-icon" style={{ background: s.soft, color: s.color }}><I /></span>
                  <span className="redline__text">{c.name}{c.excluded && <span className="tiny faint"> · excluded from new licenses</span>}</span>
                  <Switch on={!c.excluded} disabled={save.busy} label={`Share ${c.name}`} onChange={(v) => toggleCategory(c.slug, !v)} />
                </div>
              );
            })}
          </Card>
          <Card title="Contact & reuse">
            <div className="redline">
              <span className="redline__text"><div className="strong">Recontact via the platform</div><div className="small muted">Studies may invite you to new opportunities. They never receive your contact details.</div></span>
              <Switch on={d.recontactOptIn} disabled={save.busy} label="Recontact" onChange={(v) => save.run({ recontactOptIn: v })} />
            </div>
            <div className="redline">
              <span className="redline__text"><div className="strong">Commercial research</div><div className="small muted">Allow pharma and biotech sponsors (academic-only when off).</div></span>
              <Switch on={d.commercialOk} disabled={save.busy} label="Commercial" onChange={(v) => save.run({ commercialOk: v })} />
            </div>
            <div className="redline">
              <span className="redline__text"><div className="strong">Pre-authorise reuse-only licenses</div><div className="small muted">Let studies that only reuse data you already hold license it without a new review step. Collection tasks always require explicit consent.</div></span>
              <Switch on={d.preauthorizeReuseOnly} disabled={save.busy} label="Pre-authorise reuse" onChange={(v) => save.run({ preauthorizeReuseOnly: v })} />
            </div>
          </Card>
          <div className="note">{d.note}</div>
        </div>
      </div>
    </div>
  );
}
