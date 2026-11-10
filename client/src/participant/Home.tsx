// P1 Home — My Health Asset: quick log, 4 stat tiles (earnings/opportunities hidden in vault mode), the radial health
// signature, daily check-in + streak, logging rewards today, inbox badge, and "What changed this week".
import { useNavigate, Link } from 'react-router-dom';
import { Activity, ShieldCheck, Wallet, Sparkles, Check, FlaskConical, Moon, Image, ClipboardList, Inbox, Flame, Lock, CalendarCheck2, Zap } from 'lucide-react';
import type { ParticipantHome, CheckIn, CheckInInput, CheckInResult } from '@shared/api-types';
import { nowMs } from '@shared/clock';
import { useApi } from '../hooks';
import { api, ApiRequestError } from '../api';
import { useAction } from '../useAction';
import { pushToast } from '../toast';
import { useState } from 'react';
import { Card, StatTile, RadialSignature, Money, Num, Pct, signed, ErrorBox, EmptyState, QuickLog } from '../components';

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
  if (kind.includes('log') || kind.includes('ingest') || kind.includes('upload')) return { icon: <Zap />, tone: '' };
  return { icon: <Check />, tone: ' list__icon--green' };
}

/** Daily check-in card: GET /participant/checkin → prompts by valueKind → POST /participant/checkin. */
function CheckInCard({ summary }: { summary: NonNullable<ParticipantHome['checkIn']> | undefined }) {
  const q = useApi<CheckIn>('/participant/checkin');
  const [answers, setAnswers] = useState<Record<string, string | number | boolean | null>>({});
  const submit = useAction(async () => {
    const body: CheckInInput = { answers: (q.data?.prompts ?? []).map((p) => ({ id: p.id, value: answers[p.id] ?? null })) };
    const r = await api.post<CheckInResult>('/participant/checkin', body);
    pushToast('success', `Check-in done: ${r.filed} answers filed${r.rewardCents > 0 ? ` · +$${(r.rewardCents / 100).toFixed(2)}` : ''} · ${r.streakDays}-day streak`);
    setAnswers({});
  }, { errorPrefix: 'Check-in' });
  const streak = q.data?.streakDays ?? summary?.streakDays ?? 0;
  const right = <span className="streak" title="Consecutive days with at least one filed item or a completed check-in"><Flame /> {streak}-day streak</span>;
  if (q.error) {
    const unserved = q.error instanceof ApiRequestError && q.error.status === 404;
    return (
      <Card title="Daily check-in" sub="A few quick questions, once a day." right={right}>
        <div className="small faint">{unserved ? 'Check-ins are not served by the API yet.' : q.error.message}</div>
      </Card>
    );
  }
  const d = q.data;
  if (!d) return <Card title="Daily check-in" right={right}><div className="faint small">Loading…</div></Card>;
  if (d.done) {
    return (
      <Card title="Daily check-in" sub={d.date} right={right}>
        <div className="row gap-8"><span className="list__icon list__icon--green"><CalendarCheck2 /></span><div className="small">Done for today{d.rewardCents > 0 ? <> · earned <strong><Money cents={d.rewardCents} exact /></strong></> : null}. Come back tomorrow to keep the streak.</div></div>
      </Card>
    );
  }
  return (
    <Card title="Daily check-in" sub={`${d.prompts.length} quick question${d.prompts.length === 1 ? '' : 's'}${d.rewardCents > 0 ? ` · earns ${'$' + (d.rewardCents / 100).toFixed(2)}` : ''}`} right={right}>
      <form onSubmit={(e) => { e.preventDefault(); submit.run(); }}>
        {d.prompts.map((p) => (
          <div className="checkin__q" key={p.id}>
            <div className="strong">{p.question}</div>
            {p.valueKind === 'boolean' ? (
              <div className="chip-row">
                <button type="button" className={`chip${answers[p.id] === true ? ' chip--active' : ''}`} onClick={() => setAnswers({ ...answers, [p.id]: true })}>Yes</button>
                <button type="button" className={`chip${answers[p.id] === false ? ' chip--active' : ''}`} onClick={() => setAnswers({ ...answers, [p.id]: false })}>No</button>
              </div>
            ) : p.options && p.options.length > 0 ? (
              <div className="chip-row">{p.options.map((o) => <button type="button" key={o} className={`chip${answers[p.id] === o ? ' chip--active' : ''}`} onClick={() => setAnswers({ ...answers, [p.id]: o })}>{o}</button>)}</div>
            ) : p.valueKind === 'continuous' || p.valueKind === 'float' ? (
              <div className="row gap-6"><input className="input input--sm" type="number" step="any" style={{ width: 110 }} value={typeof answers[p.id] === 'number' ? String(answers[p.id]) : ''} onChange={(e) => setAnswers({ ...answers, [p.id]: e.target.value === '' ? null : Number(e.target.value) })} aria-label={p.question} />{p.unit && <span className="small muted">{p.unit}</span>}</div>
            ) : (
              <input className="input input--sm" value={typeof answers[p.id] === 'string' ? (answers[p.id] as string) : ''} onChange={(e) => setAnswers({ ...answers, [p.id]: e.target.value || null })} aria-label={p.question} />
            )}
            <div className="tiny faint">→ {p.conceptName}</div>
          </div>
        ))}
        <button className="btn btn--primary btn--sm mt-12" type="submit" disabled={submit.busy || d.prompts.length === 0}><CalendarCheck2 /> Submit check-in</button>
      </form>
    </Card>
  );
}

export default function HomePage() {
  const q = useApi<ParticipantHome>('/participant/home');
  const navigate = useNavigate();
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data;
  if (!d) return <div className="faint small">Loading…</div>;
  if (d.empty) return <EmptyState />;
  const vault = d.vaultOnly === true;
  const needsReview = d.inbox?.needsReview ?? 0;

  return (
    <div className="grid grid--main-aside gap-16">
      <div className="col gap-16">
        <div className="page-head--row" style={{ marginBottom: 0 }}>
          <div>
            <h1 className="h1">{greeting()}, {d.participant.firstName}</h1>
            <div className="sub">{vault ? 'Vault mode: your data is stored and organised for you only.' : 'Your health data is making a difference.'}</div>
          </div>
          <div className="home-badges">
            {vault && <Link to="/p/permissions" className="pill pill--dark" title="No opportunities, licensing or rewards while vault-only is on"><Lock style={{ width: 10, height: 10 }} /> Vault mode</Link>}
            {needsReview > 0 && <Link to="/p/sources" className="pill pill--partial" title="Uploads and logs waiting for your decision"><Inbox style={{ width: 10, height: 10 }} /> {needsReview} to review</Link>}
            {d.inbox && d.inbox.autoFiledToday > 0 && <span className="pill pill--verified" title="Filed automatically today"><Check style={{ width: 10, height: 10 }} /> {d.inbox.autoFiledToday} filed today</span>}
            {d.checkIn && <span className="streak" title="Consecutive days with activity"><Flame /> {d.checkIn.streakDays}</span>}
          </div>
        </div>
        <Card title="Quick log" sub="Say or type what happened; the graph files it in the right branch." right={!vault && d.rewardsToday ? <span className="pill pill--verified" title="Logging rewards earned today"><Wallet style={{ width: 10, height: 10 }} /> <Money cents={d.rewardsToday.cents} exact /> today</span> : null}>
          <QuickLog />
        </Card>
        <div className="grid grid--4">
          <StatTile label="Data completeness" icon={<Activity />} value={<Pct x={d.completeness.pct} />} delta={`${signed(d.completeness.deltaMonth, '%')} this month`} tone={d.completeness.deltaMonth >= 0 ? 'up' : 'down'} />
          <StatTile label="Verified sources" icon={<ShieldCheck />} iconTone="green" value={<Num n={d.verifiedSources} />} delta={`${d.licensedUses} licensed uses`} />
          {vault ? (
            <>
              <StatTile label="Logged today" icon={<Zap />} iconTone="purple" value={<Num n={d.inbox?.autoFiledToday ?? 0} />} delta="items filed automatically" />
              <StatTile label="Vault mode" icon={<Lock />} iconTone="amber" value="On" delta="No data selling" />
            </>
          ) : (
            <>
              <StatTile label="Lifetime earnings" icon={<Wallet />} iconTone="purple" value={<Money cents={d.lifetimeEarningsCents} />} delta={d.rewardsToday && d.rewardsToday.cents > 0 ? <>+<Money cents={d.rewardsToday.cents} exact /> logging today</> : '90% of every license fee'} />
              <StatTile label="Available opportunities" icon={<Sparkles />} iconTone="amber" value={<Num n={d.opportunities.count} />} delta={d.opportunities.count > 0 ? <>Up to <Money cents={d.opportunities.maxCents} /></> : 'None open'} tone="accent" />
            </>
          )}
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
        {d.checkIn && <CheckInCard summary={d.checkIn} />}
        {!vault && d.rewardsToday && (
          <Card title="Logging rewards today" sub="Micro-payments for logs, photos and check-ins; the funding study is named on each ledger row." right={<Link className="btn btn--sm" to="/p/earnings">Ledger</Link>}>
            <div className="row gap-16" style={{ alignItems: 'baseline' }}>
              <span className="big-num"><Money cents={d.rewardsToday.cents} exact /></span>
              <span className="small muted"><Num n={d.rewardsToday.count} /> rewarded item{d.rewardsToday.count === 1 ? '' : 's'}</span>
            </div>
          </Card>
        )}
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
            <p>Your health graph is built from verified sources and your own logs. Researchers license a scoped, pseudonymous slice for a fixed term; you keep 90% of every fee and can revoke forward at any time.</p>
            <p>{vault ? 'In vault mode nothing is licensed or sold; the graph is simply yours, organised.' : 'Missing or partial nodes are where new opportunities appear.'}</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
