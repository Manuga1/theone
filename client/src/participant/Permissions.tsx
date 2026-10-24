// Permissions: fixed red-lines, category exclusions, recontact, commercial use and pre-authorised reuse-only licensing.
import { Lock, ShieldOff } from 'lucide-react';
import type { ParticipantPermissions, PermissionsUpdate } from '@shared/api-types';
import { useApi } from '../hooks';
import { api } from '../api';
import { useAction } from '../useAction';
import { Card, ErrorBox, domainStyle } from '../components';

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

  return (
    <div className="col gap-16">
      <div className="page-head--row" style={{ marginBottom: 0 }}>
        <div><h1 className="h1">Permissions</h1><div className="sub">You are the principal. These settings decide who can license your data and for what.</div></div>
      </div>
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
