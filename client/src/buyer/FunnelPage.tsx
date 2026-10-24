// B3 Cohort Funnel: sequential stages, READY NOW, and the "your potential cohort is larger" callout.
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Card, Funnel, KNum, kfloor } from '../components';
import { CohortStepBar, CohortSubNav, PageState, useCohort, BlockedBanner } from './shared';

export default function FunnelPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const q = useCohort(id);
  const d = q.data;
  const p = d?.preview;
  const potential = p ? p.matrix.estimatedAfter : null;
  return (
    <div className="col gap-16">
      <div className="page-head--row" style={{ marginBottom: 0 }}>
        <div><h1 className="h1">{d?.name ?? 'Cohort'} — funnel</h1><div className="sub">{d?.criteria.purpose}</div></div>
        <CohortStepBar id={id} active="review" />
      </div>
      {id && <CohortSubNav id={id} active="funnel" />}
      <PageState error={q.error} loading={q.loading && !d}>
        {p && (
          <div className="grid gap-16" style={{ gridTemplateColumns: 'minmax(0, 1fr) 380px' }}>
            <Card title="Population match" sub="Each stage applies one more criterion. Longitudinal stages use already-held (historical) data only.">
              <BlockedBanner consent={p.consent} />
              <Funnel stages={p.funnel} readyNow={p.readyNow} maxWidth={520} />
            </Card>
            <div className="col gap-16">
              <Card title="But your potential cohort is larger." soft>
                <div className="why">
                  <p>Many eligible participants are missing just one or two variables. See how many more could be recruited by collecting missing data.</p>
                </div>
                <div className="stack-rows">
                  <div><span>Ready now</span><span className="v"><KNum n={p.readyNow} /></span></div>
                  <div><span>Estimated after enrichment</span><span className="v">{potential ? `${kfloor(potential.low)} – ${kfloor(potential.high)}` : '—'}</span></div>
                  <div><span>Eligible but missing data</span><span className="v"><KNum n={p.matrix.groups.reduce((a, g) => a + g.eligible, 0)} /></span></div>
                </div>
                <button className="btn btn--primary btn--block mt-12" onClick={() => navigate(`/b/cohorts/${id}/missing`)}>Expand Cohort <ArrowRight /></button>
              </Card>
              <Card title="Criteria">
                <div className="kv-grid">
                  <div><span className="k">Age</span><span className="v">{d?.criteria.demographics.ageMin ?? '—'} – {d?.criteria.demographics.ageMax ?? '—'}</span></div>
                  <div><span className="k">Country</span><span className="v">{d?.criteria.demographics.country ?? 'Any'}</span></div>
                  <div><span className="k">Conditions</span><span className="v">{d?.criteria.conditions.length ?? 0}</span></div>
                  <div><span className="k">Modalities</span><span className="v">{d?.criteria.modalities.length ?? 0}</span></div>
                </div>
              </Card>
            </div>
          </div>
        )}
      </PageState>
    </div>
  );
}
