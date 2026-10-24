// P1 Home — My Health Asset: 4 stat tiles, the radial health signature, and "What changed this week".
import { useNavigate } from 'react-router-dom';
import { Activity, ShieldCheck, Wallet, Sparkles, Check, FlaskConical, Moon, Image, ClipboardList } from 'lucide-react';
import type { ParticipantHome } from '@shared/api-types';
import { nowMs } from '@shared/clock';
import { useApi } from '../hooks';
import { Card, StatTile, RadialSignature, Money, Num, Pct, signed, ErrorBox, EmptyState } from '../components';

function greeting(): string {
  // Time of day from the fixed demo clock (never the wall clock).
  const h = new Date(nowMs()).getUTCHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function activityIcon(kind: string) {
  if (kind === 'license_fee' || kind === 'contribution_payment') return { icon: <Wallet />, tone: ' list__icon--green' };
  if (kind.includes('lab')) return { icon: <FlaskConical />, tone: ' list__icon--purple' };
  if (kind.includes('sleep')) return { icon: <Moon />, tone: '' };
  if (kind.includes('imaging')) return { icon: <Image />, tone: ' list__icon--amber' };
  if (kind.includes('survey')) return { icon: <ClipboardList />, tone: ' list__icon--amber' };
  return { icon: <Check />, tone: ' list__icon--green' };
}

export default function HomePage() {
  const q = useApi<ParticipantHome>('/participant/home');
  const navigate = useNavigate();
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data;
  if (!d) return <div className="faint small">Loading…</div>;
  if (d.empty) return <EmptyState />;

  return (
    <div className="grid grid--main-aside gap-16">
      <div className="col gap-16">
        <div>
          <h1 className="h1">{greeting()}, {d.participant.firstName}</h1>
          <div className="sub">Your health data is making a difference.</div>
        </div>
        <div className="grid grid--4">
          <StatTile label="Data completeness" icon={<Activity />} value={<Pct x={d.completeness.pct} />} delta={`${signed(d.completeness.deltaMonth, '%')} this month`} tone={d.completeness.deltaMonth >= 0 ? 'up' : 'down'} />
          <StatTile label="Verified sources" icon={<ShieldCheck />} iconTone="green" value={<Num n={d.verifiedSources} />} delta={`${d.licensedUses} licensed uses`} />
          <StatTile label="Lifetime earnings" icon={<Wallet />} iconTone="purple" value={<Money cents={d.lifetimeEarningsCents} />} delta="90% of every license fee" />
          <StatTile label="Available opportunities" icon={<Sparkles />} iconTone="amber" value={<Num n={d.opportunities.count} />} delta={d.opportunities.count > 0 ? <>Up to <Money cents={d.opportunities.maxCents} /></> : 'None open'} tone="accent" />
        </div>
        <Card title="Your Health Signature" sub="Click any category to explore your data, see completeness, and find opportunities." right={<button className="btn btn--sm" onClick={() => navigate('/p/signature')}>Explore</button>}>
          {d.ring.length === 0 ? (
            <div className="rail__empty">No signature yet — connect a data source.</div>
          ) : (
            <RadialSignature ring={d.ring} name={d.participant.firstName} age={d.participant.age} width={600} height={400} onSelect={(slug) => navigate(`/p/signature/${slug}`)} />
          )}
        </Card>
      </div>
      <div className="col gap-16">
        <Card title="What changed this week">
          <div className="list">
            {d.whatChanged.map((a) => {
              const ic = activityIcon(a.kind);
              return (
                <div className="list__item" key={a.id}>
                  <span className={`list__icon${ic.tone}`}>{ic.icon}</span>
                  <span className="list__text">{a.text}</span>
                  <span className="list__when">{a.relative}</span>
                </div>
              );
            })}
            {d.whatChanged.length === 0 && <div className="rail__empty">Nothing new this week.</div>}
          </div>
        </Card>
        <Card title="How your asset works" soft>
          <div className="why">
            <p>Your health graph is built from verified sources. Researchers license a scoped, pseudonymous slice for a fixed term; you keep 90% of every fee and can revoke forward at any time.</p>
            <p>Missing or partial nodes are where new opportunities appear.</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
