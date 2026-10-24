// B6 Expand Cohort: target N → live estimate (contacts / acceptance / completion, cost lines, timeline) → draft campaign.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Megaphone } from 'lucide-react';
import type { Campaign, Estimate } from '@shared/api-types';
import type { CampaignVariable } from '@shared/requirement';
import { api } from '../api';
import { useAction } from '../useAction';
import { Card, ErrorBox, KNum, Money, MoneyK, Num, kfloor, money } from '../components';
import { CohortStepBar, CohortSubNav, PageState, useCohort, useOntologyLeaves, variablesFromCriteria, MODE_LABEL, requirementLabel, BlockedBanner } from './shared';

export default function ExpandPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const q = useCohort(id);
  const ont = useOntologyLeaves();
  const [targetN, setTargetN] = useState<number>(0);
  const [termMonths, setTermMonths] = useState(12);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [err, setErr] = useState<Error | null>(null);
  const [pending, setPending] = useState(false);
  const seq = useRef(0);
  const d = q.data;

  // Default target: the point estimate after enrichment, rounded to the nearest hundred (a query result, not a literal).
  useEffect(() => {
    if (d && targetN === 0) setTargetN(Math.max(100, Math.round(d.preview.matrix.estimatedAfter.point / 100) * 100));
  }, [d, targetN]);

  const variables: CampaignVariable[] = useMemo(() => (d && ont.bySlug.size ? variablesFromCriteria(d.criteria, ont.bySlug) : []), [d, ont.bySlug]);
  const collect = variables.filter((v) => v.mode !== 'reuse');

  useEffect(() => {
    if (!id || targetN <= 0 || variables.length === 0) return;
    setPending(true);
    const mine = ++seq.current;
    const t = setTimeout(() => {
      api.query<Estimate>('/buyer/campaigns/estimate', { cohortId: Number(id), targetN, variables })
        .then((e) => { if (mine === seq.current) { setEstimate(e); setErr(null); } })
        .catch((e: Error) => { if (mine === seq.current) setErr(e); })
        .finally(() => { if (mine === seq.current) setPending(false); });
    }, 300);
    return () => clearTimeout(t);
  }, [id, targetN, variables]);

  const create = useAction(async () => {
    if (!d) return;
    const c = await api.post<Campaign>('/buyer/campaigns', {
      cohortId: d.id,
      name: `${d.name} — enrichment campaign`,
      purpose: d.criteria.purpose,
      targetN,
      variables,
      licenseTermMonths: termMonths,
      useTags: ['clinical_research'],
    });
    navigate(`/b/cohorts/${id}/proposal?campaign=${c.id}`);
  }, { success: 'Draft campaign created', errorPrefix: 'Could not create campaign' });

  return (
    <div className="col gap-16">
      <div className="page-head--row" style={{ marginBottom: 0 }}>
        <div><h1 className="h1">Expand your cohort</h1><div className="sub">Fund participants to collect missing data; the platform contacts them, verifies submissions and licenses the result to you.</div></div>
        <CohortStepBar id={id} active="proposal" />
      </div>
      {id && <CohortSubNav id={id} active="expand" />}
      <PageState error={q.error} loading={q.loading && !d}>
        {d && (
          <div className="grid gap-16" style={{ gridTemplateColumns: '380px minmax(0, 1fr)' }}>
            <div className="col gap-16">
              <Card title="Target complete N">
                <BlockedBanner consent={d.preview.consent} />
                <input className="input" type="number" min={1} step={50} value={targetN || ''} onChange={(e) => setTargetN(Math.max(0, Number(e.target.value)))} style={{ fontSize: 18, fontWeight: 700 }} />
                <div className="tiny faint mt-8">Ready now <KNum n={d.preview.readyNow} /> · estimated after enrichment {kfloor(d.preview.matrix.estimatedAfter.low)} – {kfloor(d.preview.matrix.estimatedAfter.high)}</div>
                <label className="field mt-12"><span className="field__label">License term</span><select className="select select--sm" value={termMonths} onChange={(e) => setTermMonths(Number(e.target.value))}>{[6, 12, 18, 24].map((m) => <option key={m} value={m}>{m} months</option>)}</select></label>
              </Card>
              <Card title="Variables to collect" sub="Defaults from the ontology's collection protocols; reuse where the participant already holds the data.">
                <div className="table-wrap">
                  <table className="table table--compact">
                    <thead><tr><th>Variable</th><th>Mode</th><th>Requirement</th><th className="num">Comp</th></tr></thead>
                    <tbody>
                      {variables.map((v) => (
                        <tr key={v.conceptSlug}>
                          <td className="strong">{ont.bySlug.get(v.conceptSlug)?.name ?? v.conceptSlug}</td>
                          <td className="muted">{MODE_LABEL[v.mode]}</td>
                          <td className="muted">{requirementLabel(v)}</td>
                          <td className="num">{v.mode === 'reuse' ? '—' : money(v.compCents)}</td>
                        </tr>
                      ))}
                      {variables.length === 0 && <tr><td colSpan={4} className="faint">Loading ontology…</td></tr>}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
            <div className="col gap-16">
              <Card title="Estimate" sub={pending ? 'updating…' : estimate ? `pool of ${kfloor(estimate.pool)} recruitable participants` : 'Computing…'}>
                {err && <ErrorBox error={err} />}
                {estimate && (
                  <div className="grid grid--2 gap-16">
                    <div className="estimate-rows">
                      <div><span>Participants to contact</span><span className="v"><KNum n={estimate.contacts} /></span></div>
                      <div><span>Expected acceptance</span><span className="v"><KNum n={estimate.accepted} /></span></div>
                      <div><span>Expected completion</span><span className="v"><KNum n={estimate.completed} /></span></div>
                      <div><span>Estimated timeline</span><span className="v">{estimate.weeksLow}–{estimate.weeksHigh} weeks</span></div>
                    </div>
                    <div className="estimate-rows">
                      {estimate.costLines.map((l) => <div key={l.key}><span>{l.label}</span><span className="v"><MoneyK cents={l.cents} /></span></div>)}
                      <div><span className="strong">Total</span><span className="v v--total"><Money cents={estimate.totalCents} /></span></div>
                    </div>
                  </div>
                )}
                {estimate && (
                  <div className="mt-16">
                    <div className="section-title">Per missing-variable group</div>
                    <div className="table-wrap">
                      <table className="table table--compact">
                        <thead><tr><th>Group</th><th className="num">Recruitable</th><th className="num">Contacts</th><th className="num">Accepted</th><th className="num">Completed</th></tr></thead>
                        <tbody>{estimate.groups.map((g) => <tr key={g.label}><td>{g.label}</td><td className="num">{kfloor(g.recruitable)}</td><td className="num">{kfloor(g.contacts)}</td><td className="num">{kfloor(g.accepted)}</td><td className="num">{kfloor(g.completed)}</td></tr>)}</tbody>
                      </table>
                    </div>
                  </div>
                )}
                <div className="row row--between mt-16">
                  <div className="tiny faint">Participant compensation is net; the platform fee (10 % of gross) is included in “Platform & recruitment”. {collect.length} variables collected, <Num n={variables.length - collect.length} /> reused.</div>
                  <button className="btn btn--primary btn--lg" disabled={!estimate || create.busy || d.preview.consent.blocked} onClick={() => create.run()}><Megaphone /> Create collection campaign</button>
                </div>
              </Card>
            </div>
          </div>
        )}
      </PageState>
    </div>
  );
}
