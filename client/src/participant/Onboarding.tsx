// /p/onboarding — identity → consent → mode → done. Rendered outside the Shell (focused flow, no nav); the participant
// layout redirects here while OnboardingState.completed is false (see OnboardingGate in App.tsx). Every step posts an
// OnboardingInput; earlier steps stay reachable so the participant can change an answer before finishing.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShieldCheck, ShieldOff, Vault, Sparkles, Check, ArrowRight, ArrowLeft, RotateCcw, HeartPulse, Lock, Wallet } from 'lucide-react';
import type { OnboardingInput, OnboardingState, OnboardingStep, ParticipantPermissions } from '@shared/api-types';
import { dateLong } from '@shared/fmt';
import { useApi } from '../hooks';
import { api, ApiRequestError } from '../api';
import { useAction } from '../useAction';
import { Toasts } from '../toast';
import { BRAND } from '@shared/brand';
import { Card, ErrorBox, Pill, StepBar, domainStyle, BrandMark, DemoBanner, type Step } from '../components';

export const ONBOARDING_STEPS: Step[] = [
  { key: 'identity', label: 'Identity' },
  { key: 'consent', label: 'Consent' },
  { key: 'mode', label: 'Mode' },
  { key: 'done', label: 'Done' },
];
const ORDER: OnboardingStep[] = ['identity', 'consent', 'mode', 'done'];
const idx = (s: OnboardingStep) => ORDER.indexOf(s);

function Switch({ on, onChange, disabled, label }: { on: boolean; onChange?: (v: boolean) => void; disabled?: boolean; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch${on ? ' switch--on' : ''}`} disabled={disabled} onClick={() => onChange?.(!on)} />;
}

function IdentityStep({ d, busy, onConfirm }: { d: OnboardingState; busy: boolean; onConfirm: () => void }) {
  const v = d.identity;
  const verified = v.status === 'verified';
  return (
    <Card title="Confirm your identity" sub="Your legal identity lives in a separate vault. Researchers only ever see a pseudonym, an age band and a country." right={<Pill variant={verified ? 'verified' : v.status === 'pending' ? 'partial' : 'missing'} sm icon>{v.status}</Pill>}>
      <div className="kv-grid mb-12">
        <div><span className="k">Legal name</span><span className="v">{v.legalName || '—'}</span></div>
        <div><span className="k">Email</span><span className="v">{v.email || '—'}</span></div>
        <div><span className="k">Date of birth</span><span className="v">{v.dob ? dateLong(v.dob) : '—'}</span></div>
      </div>
      <div className="callout mb-12 row gap-8" style={{ alignItems: 'flex-start' }}><Lock style={{ width: 14, height: 14, flex: '0 0 14px', marginTop: 1 }} /><span>This is your asset; we are just managing it for you. Identity never leaves the vault, never joins a dataset and is never licensed.</span></div>
      <button className="btn btn--primary" disabled={busy} onClick={onConfirm} data-testid="onboarding-confirm-identity"><ShieldCheck /> {verified ? 'Yes, this is me' : 'Confirm and verify'} <ArrowRight /></button>
    </Card>
  );
}

function ConsentStep({ d, perms, busy, onBack, onSubmit }: { d: OnboardingState; perms: ParticipantPermissions | null; busy: boolean; onBack: () => void; onSubmit: (x: { recontactOptIn: boolean; commercialOk: boolean; excludedCategories: string[] }) => void }) {
  const [recontact, setRecontact] = useState(d.consent.recontactOptIn);
  const [commercial, setCommercial] = useState(d.consent.commercialOk);
  const [excluded, setExcluded] = useState<string[]>(d.consent.excludedCategories);
  useEffect(() => { setRecontact(d.consent.recontactOptIn); setCommercial(d.consent.commercialOk); setExcluded(d.consent.excludedCategories); }, [d.consent]);
  const categories = perms?.categories ?? d.consent.excludedCategories.map((slug) => ({ slug, name: slug, excluded: true }));
  // The API lists red-lines by key; Permissions carries the labels.
  const redline = (k: string) => perms?.prohibitedUses.find((p) => p.key === k)?.label ?? k.replace(/_/g, ' ');
  const toggle = (slug: string, share: boolean) => setExcluded(share ? excluded.filter((s) => s !== slug) : [...excluded, slug]);
  return (
    <Card title="Set your consent" sub="These are your defaults; every study still asks before it licenses anything. Change them any time under Permissions.">
      <div className="section-title">Never allowed — fixed for everyone</div>
      {d.consent.prohibitedUses.map((p) => (
        <div className="redline" key={p}><span className="redline__icon"><ShieldOff /></span><span className="redline__text">{redline(p)}</span><Switch on disabled label={redline(p)} /></div>
      ))}
      <div className="section-title mt-12">Contact & sponsors</div>
      <div className="redline">
        <span className="redline__text"><div className="strong">Recontact via the platform</div><div className="small muted">Studies may invite you to new opportunities; they never receive your contact details.</div></span>
        <Switch on={recontact} label="Recontact" onChange={setRecontact} />
      </div>
      <div className="redline">
        <span className="redline__text"><div className="strong">Commercial research</div><div className="small muted">Allow pharma and biotech sponsors (academic-only when off).</div></span>
        <Switch on={commercial} label="Commercial" onChange={setCommercial} />
      </div>
      <div className="section-title mt-12">Categories you share</div>
      {categories.map((c) => {
        const s = domainStyle(c.slug);
        const I = s.icon;
        const share = !excluded.includes(c.slug);
        return (
          <div className="redline" key={c.slug}>
            <span className="ctree__domain-icon" style={{ background: s.soft, color: s.color }}><I /></span>
            <span className="redline__text">{c.name}{!share && <span className="tiny faint"> · excluded from licenses</span>}</span>
            <Switch on={share} label={`Share ${c.name}`} onChange={(v) => toggle(c.slug, v)} />
          </div>
        );
      })}
      <div className="row gap-6 mt-12 row--wrap">
        <button className="btn" onClick={onBack} disabled={busy}><ArrowLeft /> Back</button>
        <button className="btn btn--primary" disabled={busy} onClick={() => onSubmit({ recontactOptIn: recontact, commercialOk: commercial, excludedCategories: excluded })} data-testid="onboarding-consent-next">Continue <ArrowRight /></button>
      </div>
    </Card>
  );
}

function ModeStep({ d, busy, onBack, onSubmit }: { d: OnboardingState; busy: boolean; onBack: () => void; onSubmit: (vaultOnly: boolean) => void }) {
  const [vault, setVault] = useState(d.vaultOnly);
  useEffect(() => setVault(d.vaultOnly), [d.vaultOnly]);
  const options: { key: boolean; icon: React.ReactNode; title: string; body: string; bullets: string[] }[] = [
    { key: false, icon: <Sparkles />, title: 'Earn from research', body: 'Studies license scoped, pseudonymous slices for a fixed term. You keep 90% of every fee and can revoke forward at any time.', bullets: ['Opportunities matched to your signature', 'Micro-rewards for logs, photos and check-ins', 'Every payment is a ledger row you can audit'] },
    { key: true, icon: <Vault />, title: 'Vault only', body: 'Use the graph purely as your own organised health record. Nothing is offered, licensed or sold.', bullets: ['No opportunities, no licenses, no rewards', 'Everything you upload or log is still filed and verified', 'Switch to earning later with one toggle'] },
  ];
  return (
    <Card title="Choose how you use your asset" sub="This is the permissions clause from your side: earn from research, or keep it purely as a vault.">
      <div className="mode-grid">
        {options.map((o) => (
          <button type="button" key={String(o.key)} className={`mode-opt${vault === o.key ? ' mode-opt--active' : ''}`} onClick={() => setVault(o.key)} data-testid={o.key ? 'mode-vault' : 'mode-earn'} aria-pressed={vault === o.key}>
            <div className="row gap-8"><span className={`list__icon${o.key ? '' : ' list__icon--green'}`}>{o.icon}</span><span className="strong">{o.title}</span>{vault === o.key && <span className="pill pill--accent pill--sm" style={{ marginLeft: 'auto' }}><Check style={{ width: 9, height: 9 }} /> chosen</span>}</div>
            <div className="small muted mt-8">{o.body}</div>
            <ul className="mode-opt__list">{o.bullets.map((b) => <li key={b}>{b}</li>)}</ul>
          </button>
        ))}
      </div>
      <div className="row gap-6 mt-12 row--wrap">
        <button className="btn" onClick={onBack} disabled={busy}><ArrowLeft /> Back</button>
        <button className="btn btn--primary" disabled={busy} onClick={() => onSubmit(vault)} data-testid="onboarding-mode-next">Continue <ArrowRight /></button>
      </div>
    </Card>
  );
}

function DoneStep({ d, perms, busy, onBack, onFinish }: { d: OnboardingState; perms: ParticipantPermissions | null; busy: boolean; onBack: () => void; onFinish: () => void }) {
  const names = (slugs: string[]) => slugs.map((s) => perms?.categories.find((c) => c.slug === s)?.name ?? s);
  return (
    <Card title={d.completed ? 'You are all set' : 'Review and finish'} sub="A summary of what you chose. Everything here can be changed later under Permissions and Profile.">
      <div className="kv-grid mb-12">
        <div><span className="k">Identity</span><span className="v">{d.identity.status}</span></div>
        <div><span className="k">Mode</span><span className="v row gap-4">{d.vaultOnly ? <><Vault style={{ width: 12, height: 12 }} /> Vault only</> : <><Wallet style={{ width: 12, height: 12 }} /> Earn from research</>}</span></div>
        <div><span className="k">Recontact</span><span className="v">{d.consent.recontactOptIn ? 'Via the platform' : 'Off'}</span></div>
        <div><span className="k">Sponsors</span><span className="v">{d.consent.commercialOk ? 'Commercial + academic' : 'Academic only'}</span></div>
        <div><span className="k">Excluded categories</span><span className="v">{d.consent.excludedCategories.length ? names(d.consent.excludedCategories).join(', ') : 'None'}</span></div>
        <div><span className="k">Red-lines</span><span className="v">{d.consent.prohibitedUses.length} fixed</span></div>
      </div>
      <div className="row gap-6 row--wrap">
        {!d.completed && <button className="btn" onClick={onBack} disabled={busy}><ArrowLeft /> Back</button>}
        <button className="btn btn--primary" disabled={busy} onClick={onFinish} data-testid="onboarding-finish"><HeartPulse /> {d.completed ? 'Open my health asset' : 'Finish and open my health asset'}</button>
      </div>
    </Card>
  );
}

export default function OnboardingPage() {
  const q = useApi<OnboardingState>('/participant/onboarding');
  const perms = useApi<ParticipantPermissions>('/participant/permissions');
  const navigate = useNavigate();
  /** A step the participant stepped back to (never beyond the server's current step). */
  const [view, setView] = useState<OnboardingStep | null>(null);
  const post = useAction(async (body: OnboardingInput) => {
    const r = await api.post<OnboardingState>('/participant/onboarding', body);
    setView(null);
    if (body.step === 'done') navigate('/p');
    return r;
  }, { errorPrefix: 'Onboarding' });
  const restart = useAction(async () => { await api.post('/participant/onboarding', { step: 'restart' }); setView(null); }, { errorPrefix: 'Restart onboarding' });

  const d = q.data;
  const unserved = q.error instanceof ApiRequestError && q.error.status === 404;
  const serverStep: OnboardingStep = d ? (d.completed ? 'done' : d.step) : 'identity';
  const step: OnboardingStep = view && idx(view) <= idx(serverStep) ? view : serverStep;
  const back = (to: OnboardingStep) => setView(to);

  return (
    <div className="onboard">
      <DemoBanner />
      <header className="onboard__head">
        <div className="shell__brand"><BrandMark /> {BRAND.name}</div>
        <div className="row gap-8">
          {d?.completed && <Link className="btn btn--sm" to="/p">Skip to my asset</Link>}
          {d && <button className="btn btn--sm" onClick={() => restart.run()} disabled={restart.busy} title="Start again from identity"><RotateCcw /> <span>Restart</span></button>}
        </div>
      </header>
      <main className="onboard__main">
        <div className="onboard__intro">
          <h1 className="h1">Welcome to your health asset</h1>
          <div className="sub">Four quick steps. Your identity stays in a vault, your data stays yours, and you decide whether it ever earns.</div>
        </div>
        <div className="onboard__steps"><StepBar steps={ONBOARDING_STEPS} active={step} /></div>
        {q.error && !unserved && <ErrorBox error={q.error} />}
        {unserved && (
          <Card title="Onboarding is not available yet">
            <div className="small muted">This API does not serve <code>/api/participant/onboarding</code> yet. Nothing is gated until it does.</div>
            <Link className="btn btn--primary mt-12" to="/p">Open my health asset</Link>
          </Card>
        )}
        {!d && !q.error && <div className="faint small">Loading…</div>}
        {d && step === 'identity' && <IdentityStep d={d} busy={post.busy} onConfirm={() => post.run({ step: 'identity', confirm: true })} />}
        {d && step === 'consent' && <ConsentStep d={d} perms={perms.data} busy={post.busy} onBack={() => back('identity')} onSubmit={(x) => post.run({ step: 'consent', ...x })} />}
        {d && step === 'mode' && <ModeStep d={d} busy={post.busy} onBack={() => back('consent')} onSubmit={(vaultOnly) => post.run({ step: 'mode', vaultOnly })} />}
        {d && step === 'done' && <DoneStep d={d} perms={perms.data} busy={post.busy} onBack={() => back('mode')} onFinish={() => (d.completed ? navigate('/p') : post.run({ step: 'done' }))} />}
        <div className="tiny faint onboard__foot">Synthetic demo data only · the demo clock, not the wall clock, dates every step.</div>
      </main>
      <Toasts />
    </div>
  );
}
