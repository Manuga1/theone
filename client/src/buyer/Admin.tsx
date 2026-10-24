// Admin: organisation, declared uses vs participant red-lines, demo clock and data controls.
import type { BuyerHome, DemoState } from '@shared/api-types';
import { useApi } from '../hooks';
import { Card, Pill, ErrorBox } from '../components';
import { useOrgConsent } from './shared';

export default function AdminPage() {
  const home = useApi<BuyerHome>('/buyer/home');
  const state = useApi<DemoState>('/demo/state');
  const consent = useOrgConsent();
  if (home.error) return <ErrorBox error={home.error} />;
  const d = home.data;
  return (
    <div className="col gap-16">
      <div className="page-head--row" style={{ marginBottom: 0 }}><div><h1 className="h1">Admin</h1><div className="sub">Organisation settings and demo controls.</div></div></div>
      <div className="grid grid--2 gap-16">
        <Card title="Organisation" right={consent.blocked ? <Pill variant="missing">Blocked by red-lines</Pill> : <Pill variant="verified" icon>Eligible</Pill>}>
          {d && (
            <div className="kv-grid">
              <div><span className="k">Name</span><span className="v">{d.org.name}</span></div>
              <div><span className="k">Type</span><span className="v" style={{ textTransform: 'capitalize' }}>{d.org.type}</span></div>
              <div style={{ gridColumn: '1 / -1' }}><span className="k">Declared uses</span><span className="v">{d.org.declaredUses.map((u) => u.replace(/_/g, ' ')).join(', ') || '—'}</span></div>
              <div><span className="k">Studies</span><span className="v">{d.counts.studies}</span></div>
              <div><span className="k">Open campaigns</span><span className="v">{d.counts.campaigns}</span></div>
              <div><span className="k">Datasets</span><span className="v">{d.counts.datasets}</span></div>
            </div>
          )}
          {consent.blocked && <div className="callout callout--red mt-12">{consent.reason}</div>}
          <div className="note mt-12">Declared uses are checked against every participant's fixed red-lines (advertising, insurance underwriting, employment screening, law enforcement, re-identification, data brokerage, credit scoring). A conflicting use zeroes every cohort and refuses campaign creation.</div>
        </Card>
        <div className="col gap-16">
          <Card title="Organisations in this demo">
            <div className="list">
              {(state.data?.orgs ?? []).map((o) => <div className="list__item" key={o.id}><span className="list__text"><span className="strong">{o.name}</span> <span className="muted">· {o.type}</span></span><span className="tiny faint">{o.declaredUses.map((u) => u.replace(/_/g, ' ')).join(', ')}</span></div>)}
            </div>
            <div className="tiny faint mt-8">Switch organisation in the header to see the red-line demo.</div>
          </Card>
          <Card title="Demo" soft>
            <div className="kv-grid">
              <div><span className="k">Demo clock</span><span className="v">{state.data?.today ?? '—'}</span></div>
              <div><span className="k">Write version</span><span className="v">{state.data?.writeVersion ?? '—'}</span></div>
              <div><span className="k">Seeded</span><span className="v">{state.data ? (state.data.seeded ? 'yes' : 'no (schema only)') : '—'}</span></div>
            </div>
            <div className="note mt-8">Use “Reset demo” in the header to wipe and regenerate all synthetic data.</div>
          </Card>
        </div>
      </div>
    </div>
  );
}
