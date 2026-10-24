// B4 Missing Data Matrix: eligible vs recruitable per missing-variable group, current vs estimated complete cohort.
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Card, MissingMatrix, KNum, kfloor } from '../components';
import { CohortStepBar, CohortSubNav, PageState, useCohort, BlockedBanner } from './shared';

export default function MissingDataPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const q = useCohort(id);
  const d = q.data;
  const p = d?.preview;
  return (
    <div className="col gap-16">
      <div className="page-head--row" style={{ marginBottom: 0 }}>
        <div><h1 className="h1">Where are the gaps?</h1><div className="sub">Many eligible participants are missing one or more variables. Recruitable = eligible ∧ recontactable ∧ no exclusion ∧ no open opportunity.</div></div>
        <CohortStepBar id={id} active="enrich" />
      </div>
      {id && <CohortSubNav id={id} active="missing" />}
      <PageState error={q.error} loading={q.loading && !d}>
        {p && (
          <div className="grid gap-16" style={{ gridTemplateColumns: 'minmax(0, 1fr) 380px' }}>
            <Card title="Missing data matrix" sub="Only variables the platform can collect are enumerated; history requirements cannot be recruited.">
              <BlockedBanner consent={p.consent} />
              <MissingMatrix matrix={p.matrix} readyNow={p.readyNow} action={<button className="btn btn--primary btn--block btn--lg" onClick={() => navigate(`/b/cohorts/${id}/expand`)}>Expand Cohort <ArrowRight /></button>} />
            </Card>
            <div className="col gap-16">
              <Card title="Current complete cohort"><div className="big-num"><KNum n={p.readyNow} /></div><div className="small muted">hold every required variable today</div></Card>
              <Card title="Estimated complete cohort after enrichment">
                <span className="band">{kfloor(p.matrix.estimatedAfter.low)} – {kfloor(p.matrix.estimatedAfter.high)}</span>
                <div className="small muted mt-8">point estimate <strong><KNum n={p.matrix.estimatedAfter.point} /></strong>; acceptance and completion rates applied per missing-variable group, ±6 % band.</div>
              </Card>
              <Card title="Groups" soft>
                <div className="stack-rows">
                  {p.matrix.groups.map((g) => <div key={g.key}><span>{g.label}</span><span className="v"><KNum n={g.recruitable} /> <span className="faint" style={{ fontWeight: 400 }}>/ {kfloor(g.eligible)}</span></span></div>)}
                  {p.matrix.groups.length === 0 && <div className="rail__empty">No enrichable gaps.</div>}
                </div>
              </Card>
            </div>
          </div>
        )}
      </PageState>
    </div>
  );
}
