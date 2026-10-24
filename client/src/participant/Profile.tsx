// Profile: identity from the vault (participant side only) and the pseudonym researchers never see directly.
import { ShieldCheck, KeyRound } from 'lucide-react';
import type { ParticipantProfile } from '@shared/api-types';
import { useApi } from '../hooks';
import { Card, ErrorBox, Pill } from '../components';
import { dateLong } from '@shared/fmt';

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
          <Card title="What researchers see" soft>
            <div className="row gap-8 mb-8"><ShieldCheck style={{ width: 14, height: 14, color: 'var(--green)' }} /><span className="small strong">Age band · country · scoped pseudonym · licensed variables</span></div>
            <div className="why"><p>{d.identityNote}</p></div>
          </Card>
        </div>
      </div>
    </div>
  );
}
