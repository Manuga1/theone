// B5 Data Coverage Heatmap: cohort + groups × modalities, with a provenance floor per modality, and coverage bars.
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { CohortPreview } from '@shared/api-types';
import type { CohortCriteria } from '@shared/criteria';
import { api } from '../api';
import { Card, Heatmap, CoverageBars, ProvenanceSelect, ErrorBox, KNum } from '../components';
import { CohortStepBar, CohortSubNav, PageState, useCohort, BlockedBanner } from './shared';

export default function CoveragePage() {
  const { id } = useParams();
  const q = useCohort(id);
  const [ranks, setRanks] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<CohortPreview | null>(null);
  const [err, setErr] = useState<Error | null>(null);
  const seq = useRef(0);
  const base = q.data?.criteria ?? null;

  // Re-run the preview when a provenance floor changes (debounced 300 ms); the saved preview is used as-is otherwise.
  useEffect(() => {
    if (!base) return;
    const overrides = Object.entries(ranks);
    if (overrides.length === 0) { setPreview(q.data?.preview ?? null); return; }
    const criteria: CohortCriteria = { ...base, modalities: base.modalities.map((m) => ({ ...m, minProvRank: ranks[m.slug] ?? m.minProvRank })) };
    const mine = ++seq.current;
    const t = setTimeout(() => {
      api.query<CohortPreview>('/buyer/cohorts/preview', criteria).then((p) => mine === seq.current && setPreview(p)).catch((e: Error) => mine === seq.current && setErr(e));
    }, 300);
    return () => clearTimeout(t);
  }, [base, ranks, q.data]);

  const p = preview;
  return (
    <div className="col gap-16">
      <div className="page-head--row" style={{ marginBottom: 0 }}>
        <div><h1 className="h1">Data coverage by variable</h1><div className="sub">Overview of data availability in your target population. Raise a provenance floor to see how coverage shrinks.</div></div>
        <CohortStepBar id={id} active="enrich" />
      </div>
      {id && <CohortSubNav id={id} active="coverage" />}
      <PageState error={q.error} loading={q.loading && !q.data}>
        {err && <ErrorBox error={err} />}
        {p && base && (
          <div className="grid gap-16" style={{ gridTemplateColumns: 'minmax(0, 1fr) 380px' }}>
            <Card title="Coverage heatmap" sub="≥ 90 % of the row holds the variable = complete · ≥ 30 % = partial · else missing" right={<span className="small muted">base <strong><KNum n={p.funnel[2]?.n ?? p.total} /></strong></span>}>
              <BlockedBanner consent={p.consent} />
              <Heatmap heatmap={p.heatmap} />
              <div className="divider" />
              <CoverageBars bars={p.bars} title="Coverage counts (share of the clinical-match base with any data)" />
            </Card>
            <div className="col gap-16">
              <Card title="Minimum provenance" sub="Per required modality. Verification is provenance: a device beats a self-report.">
                <div className="col gap-8">
                  {base.modalities.map((m) => (
                    <ProvenanceSelect key={m.slug} small label={p.heatmap.columns.find((c) => c.slug === m.slug)?.label ?? m.slug.split('.').pop()!.replace(/_/g, ' ')} value={ranks[m.slug] ?? m.minProvRank} onChange={(r) => setRanks({ ...ranks, [m.slug]: r })} />
                  ))}
                </div>
                {Object.keys(ranks).length > 0 && <button className="btn btn--sm btn--ghost mt-8" onClick={() => setRanks({})}>Reset to saved cohort</button>}
              </Card>
              <Card title="Ready now under these floors"><div className="big-num"><KNum n={p.readyNow} /></div><div className="small muted">complete across every modality</div></Card>
            </div>
          </div>
        )}
      </PageState>
    </div>
  );
}
