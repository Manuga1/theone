// Analytics: thin page over real counts (home tiles + studies / campaigns / datasets aggregates).
import type { BuyerHome, StudySummary, Campaign, DatasetSummary } from '@shared/api-types';
import { useApi } from '../hooks';
import { Card, StatTile, KNum, Num, BarRow, kfloor, moneyK } from '../components';

export default function AnalyticsPage() {
  const home = useApi<BuyerHome>('/buyer/home');
  const studiesQ = useApi<{ studies: StudySummary[] } | StudySummary[]>('/buyer/studies');
  const campaignsQ = useApi<{ campaigns: Campaign[] } | Campaign[]>('/buyer/campaigns');
  const datasetsQ = useApi<{ datasets: DatasetSummary[] } | DatasetSummary[]>('/buyer/datasets');
  const studies = Array.isArray(studiesQ.data) ? studiesQ.data : studiesQ.data?.studies ?? [];
  const campaigns = Array.isArray(campaignsQ.data) ? campaignsQ.data : campaignsQ.data?.campaigns ?? [];
  const datasets = Array.isArray(datasetsQ.data) ? datasetsQ.data : datasetsQ.data?.datasets ?? [];
  const sum = (f: (s: StudySummary) => number) => studies.reduce((a, s) => a + f(s), 0);
  const invited = sum((s) => s.counters.invited);
  const budget = campaigns.reduce((a, c) => a + c.estimate.totalCents, 0);
  const d = home.data;
  return (
    <div className="col gap-16">
      <div className="page-head--row" style={{ marginBottom: 0 }}><div><h1 className="h1">Analytics</h1><div className="sub">Aggregates across your organisation. Every number is a query; small counts read “&lt;20”.</div></div></div>
      <div className="grid grid--4">
        <StatTile label="Studies" value={<Num n={d?.counts.studies ?? 0} />} delta={`${studies.filter((s) => s.status === 'active').length} active`} />
        <StatTile label="Open campaigns" value={<Num n={d?.counts.campaigns ?? 0} />} delta={`committed budget ${moneyK(budget)}`} />
        <StatTile label="Dataset versions" value={<Num n={datasets.length} />} delta={`${datasets.filter((x) => x.status === 'current').length} current`} />
        <StatTile label="Participants invited" value={<KNum n={invited} />} delta={`${kfloor(sum((s) => s.counters.qualityAccepted))} quality accepted`} />
      </div>
      <div className="grid grid--2 gap-16">
        <Card title="Recruitment funnel across studies">
          <div className="col gap-8">
            {[['Invited', invited], ['Accepted', sum((s) => s.counters.accepted)], ['Started', sum((s) => s.counters.started)], ['Completed', sum((s) => s.counters.completed)], ['Quality accepted', sum((s) => s.counters.qualityAccepted)]].map(([l, n]) => (
              <BarRow key={String(l)} label={String(l)} value={invited > 0 ? (Number(n) / invited) * 100 : 0} display={kfloor(Number(n))} labelWidth={110} />
            ))}
            {studies.length === 0 && <div className="rail__empty">No studies yet.</div>}
          </div>
        </Card>
        <Card title="Population reach">
          <div className="col gap-8">
            {d && [['Available', d.tiles.availableParticipants], ['Longitudinal', d.tiles.longitudinalProfiles], ['Genomics', d.tiles.genomicsAvailable], ['Recontactable', d.tiles.recontactable]].map(([l, n]) => (
              <BarRow key={String(l)} label={String(l)} value={d.tiles.availableParticipants > 0 ? (Number(n) / d.tiles.availableParticipants) * 100 : 0} display={kfloor(Number(n))} labelWidth={110} tone="green" />
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
