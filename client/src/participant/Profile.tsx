// Profile: identity from the vault (participant side only), the pseudonym researchers never see directly, and the
// onboarding card (identity → consent → mode → done) with "Restart onboarding".
import { ShieldCheck, KeyRound, RotateCcw, Vault, ListChecks } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import type { OnboardingState, ParticipantProfile } from '@shared/api-types';
import { useApi } from '../hooks';
import { api, ApiRequestError } from '../api';
import { useAction } from '../useAction';
import { Card, ErrorBox, Pill, StepBar } from '../components';
import { dateLong } from '@shared/fmt';
import { ONBOARDING_STEPS } from './Onboarding';

/** Onboarding status + restart. GET /participant/onboarding; 404 → the API does not serve onboarding yet. */
function OnboardingCard() {
  const q = useApi<OnboardingState>('/participant/onboarding');
  const navigate = useNavigate();
  const restart = useAction(async () => {
    await api.post('/participant/onboarding', { step: 'restart' });
    navigate('/p/onboarding');
  }, { errorPrefix: 'Restart onboarding' });
  const unserved = q.error instanceof ApiRequestError && q.error.status === 404;
  const d = q.data;
  return (
    <Card title="Onboarding" sub="Identity → consent → mode. Restart to walk through it again; nothing you logged is touched." right={d ? <Pill variant={d.completed ? 'verified' : 'partial'} sm icon>{d.completed ? 'completed' : `at ${d.step}`}</Pill> : null}>
      {q.error && !unserved && <ErrorBox error={q.error} />}
      {unserved && <div className="small faint">Onboarding is not served by this API yet.</div>}
      {d && (
        <div className="col gap-12">
          <StepBar steps={ONBOARDING_STEPS} active={d.completed ? 'done' : d.step} />
          <div className="row gap-8 row--wrap small muted">
            <span className="row gap-4"><ListChecks style={{ width: 12, height: 12 }} /> Identity {d.identity.status}</span>
            <span>·</span>
            <span>{d.consent.commercialOk ? 'Commercial research allowed' : 'Academic research only'}</span>
            <span>·</span>
            <span className="row gap-4"><Vault style={{ width: 12, height: 12 }} /> {d.vaultOnly ? 'Vault mode' : 'Earning mode'}</span>
          </div>
          <div className="row gap-6 row--wrap">
            <button className="btn btn--sm" disabled={restart.busy} onClick={() => restart.run()} data-testid="restart-onboarding"><RotateCcw /> Restart onboarding</button>
            {!d.completed && <Link className="btn btn--sm btn--primary" to="/p/onboarding">Continue onboarding</Link>}
          </div>
        </div>
      )}
      {!d && !q.error && <div className="faint small">Loading…</div>}
    </Card>
  );
}

export default function ProfilePage() {
  const q = useApi<ParticipantProfile>('/participant/profile');
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data;
  if (!d) return <div className="faint small">Loading…</div>;
  const initials = d.legalName.split(/\s+/).map((s) => s[0] ?? '').join('').slice(0, 2).toUpperCase();
  return (
    <div className="col gap-16">
      <div className="page-head--row" style={{ marginBottom: 0 }}>
        <div><h1 className="h1">Profile</h1><div className="sub">Your identity stays in a separate vault; your health graph carries only a pseudonym.</div></div>
      </div>
      <div className="grid grid--2 gap-16">
        <Card title="Identity (vault)" right={<Pill variant={d.verificationStatus === 'verified' ? 'verified' : 'partial'} sm icon>{d.verificationStatus}</Pill>}>
          <div className="row gap-12 mb-12"><span className="avatar avatar--lg">{initials || '–'}</span><div><div className="h2">{d.legalName || '—'}</div><div className="small muted">{d.email || '—'}</div></div></div>
          <div className="kv-grid">
            <div><span className="k">Phone</span><span className="v">{d.phone || '—'}</span></div>
            <div><span className="k">Date of birth</span><span className="v">{d.dob ? dateLong(d.dob) : '—'}</span></div>
            <div><span className="k">Age</span><span className="v">{d.age || '—'}</span></div>
            <div><span className="k">Sex</span><span className="v" style={{ textTransform: 'capitalize' }}>{d.sex || '—'}</span></div>
            <div><span className="k">Location</span><span className="v">{[d.region, d.country].filter(Boolean).join(', ') || '—'}</span></div>
            <div><span className="k">Enrolled</span><span className="v">{d.enrolledAt ? dateLong(d.enrolledAt) : '—'}</span></div>
          </div>
        </Card>
        <div className="col gap-16">
          <Card title="Pseudonym">
            <div className="row gap-8"><span className="list__icon"><KeyRound /></span><code style={{ fontSize: 14 }}>{d.pseudonym || '—'}</code></div>
            <div className="small muted mt-8">Internal only. Each study and dataset derives its own hashed pseudonym from this one, so two studies cannot link you across licenses.</div>
          </Card>
          <OnboardingCard />
          <Card title="What researchers see" soft>
            <div className="row gap-8 mb-8"><ShieldCheck style={{ width: 14, height: 14, color: 'var(--green)' }} /><span className="small strong">Age band · country · scoped pseudonym · licensed variables</span></div>
            <div className="why"><p>{d.identityNote}</p></div>
          </Card>
        </div>
      </div>
    </div>
  );
}
