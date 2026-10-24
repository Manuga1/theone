// B1 Researcher Home: 4 tiles, 4 CTAs, search results (?q=) and recent activity.
import { Link, useSearchParams } from 'react-router-dom';
import { Users, Layers, Dna, UserCheck, Target, FlaskConical, Database, Megaphone, Search, CheckCircle2, FileText, ShieldAlert } from 'lucide-react';
import type { BuyerHome, BuyerSearch } from '@shared/api-types';
import { useApi } from '../hooks';
import { Card, StatTile, KNum, ErrorBox } from '../components';

function activityIcon(kind: string) {
  if (kind === 'blocked') return { icon: <ShieldAlert />, tone: ' list__icon--amber' };
  if (kind.includes('dataset')) return { icon: <Database />, tone: ' list__icon--purple' };
  if (kind.includes('campaign')) return { icon: <Megaphone />, tone: ' list__icon--green' };
  if (kind.includes('study')) return { icon: <FlaskConical />, tone: '' };
  return { icon: <CheckCircle2 />, tone: '' };
}

export default function HomePage() {
  const [params] = useSearchParams();
  const qstr = params.get('q') ?? '';
  const home = useApi<BuyerHome>('/buyer/home');
  const search = useApi<BuyerSearch>(qstr ? `/buyer/search?q=${encodeURIComponent(qstr)}` : null);
  if (home.error) return <ErrorBox error={home.error} />;
  const d = home.data;
  return (
    <div className="grid gap-16" style={{ gridTemplateColumns: 'minmax(0, 1fr) 380px' }}>
      <div className="col gap-16">
        <div><h1 className="h1">Welcome back{d ? `, ${d.org.name}` : ''}</h1><div className="sub">Research workspace — find the right population, understand data coverage, expand your cohort, run your study.</div></div>
        <div className="grid grid--4">
          <StatTile label="Available participants" icon={<Users />} value={<KNum n={d?.tiles.availableParticipants ?? 0} />} delta="consenting to your declared uses" />
          <StatTile label="Longitudinal profiles" icon={<Layers />} iconTone="green" value={<KNum n={d?.tiles.longitudinalProfiles ?? 0} />} delta="≥ 1 year of EHR history" />
          <StatTile label="Genomics available" icon={<Dna />} iconTone="purple" value={<KNum n={d?.tiles.genomicsAvailable ?? 0} />} delta="exome on file" />
          <StatTile label="Recontactable participants" icon={<UserCheck />} iconTone="amber" value={<KNum n={d?.tiles.recontactable ?? 0} />} delta="opted in to platform recontact" />
        </div>
        <div className="cta-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <Link className="cta cta--primary" to="/b/cohorts/new"><Target /> Build a Cohort</Link>
          <Link className="cta" to="/b/studies"><FlaskConical /> My Studies{d ? ` (${d.counts.studies})` : ''}</Link>
          <Link className="cta" to="/b/datasets"><Database /> Licensed Datasets{d ? ` (${d.counts.datasets})` : ''}</Link>
          <Link className="cta" to="/b/campaigns"><Megaphone /> Active Collection Campaigns{d ? ` (${d.counts.campaigns})` : ''}</Link>
        </div>
        {qstr && (
          <Card title={<span className="row gap-6"><Search size={13} /> Results for “{qstr}”</span>} sub={search.data ? `${search.data.results.length} matches across variables, cohorts, studies and datasets` : 'Searching…'}>
            {search.error && <ErrorBox error={search.error} />}
            <div className="list">
              {(search.data?.results ?? []).map((r) => (
                <Link className="list__item" key={`${r.type}-${r.id}`} to={r.href} style={{ color: 'inherit' }}>
                  <span className="list__icon">{r.type === 'concept' ? <FileText /> : r.type === 'study' ? <FlaskConical /> : r.type === 'dataset' ? <Database /> : <Target />}</span>
                  <span className="list__text"><span className="strong">{r.label}</span> <span className="muted">· {r.sub}</span></span>
                  <span className="pill pill--outline pill--sm">{r.type}</span>
                </Link>
              ))}
              {search.data && search.data.results.length === 0 && <div className="rail__empty">No matches.</div>}
            </div>
          </Card>
        )}
        <Card title="How the workspace works" soft>
          <div className="why">
            <p><strong>Define</strong> a population and see the funnel live. <strong>Review</strong> where eligible participants are missing data and what it costs to collect it. <strong>Enrich</strong> with a collection campaign; participants accept per study and license forward. <strong>Run</strong> the study and analyse the dataset in the secure workspace — counts under 20 always read “&lt;20”.</p>
          </div>
        </Card>
      </div>
      <div className="col gap-16">
        <Card title="Recent activity">
          <div className="list">
            {(d?.activity ?? []).map((a) => {
              const ic = activityIcon(a.kind);
              return (
                <div className="list__item" key={a.id}>
                  <span className={`list__icon${ic.tone}`}>{ic.icon}</span>
                  <span className="list__text">{a.text}</span>
                  <span className="list__when">{a.relative}</span>
                </div>
              );
            })}
            {d && d.activity.length === 0 && <div className="rail__empty">No activity yet.</div>}
          </div>
        </Card>
        {d && (
          <Card title="Your organisation" soft>
            <div className="kv-grid">
              <div><span className="k">Name</span><span className="v">{d.org.name}</span></div>
              <div><span className="k">Type</span><span className="v" style={{ textTransform: 'capitalize' }}>{d.org.type}</span></div>
              <div style={{ gridColumn: '1 / -1' }}><span className="k">Declared uses</span><span className="v">{d.org.declaredUses.map((u) => u.replace(/_/g, ' ')).join(', ') || '—'}</span></div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
