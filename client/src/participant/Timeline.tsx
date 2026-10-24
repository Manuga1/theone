// P4 Your Health Timeline: category chips, the year rail, and the trailing-months swimlanes.
import { useState } from 'react';
import type { ParticipantTimeline, TimelineEvent } from '@shared/api-types';
import { useApi } from '../hooks';
import { Card, Tabs, TimelineRail, SwimlaneStrip, ErrorBox } from '../components';

type Cat = TimelineEvent['category'] | 'all';

export default function TimelinePage() {
  const [cat, setCat] = useState<Cat>('all');
  const q = useApi<ParticipantTimeline>(`/participant/timeline${cat === 'all' ? '' : `?category=${cat}`}`);
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data;
  return (
    <div className="col gap-16">
      <div className="page-head--row" style={{ marginBottom: 0 }}>
        <div><h1 className="h1">Your Health Timeline</h1><div className="sub">Every event in your graph, with the sources that recorded it.</div></div>
      </div>
      {d && <Tabs variant="pills" value={cat} onChange={setCat} items={d.categories.map((c) => ({ key: c.key, label: c.label, count: c.n }))} />}
      <div className="grid gap-16" style={{ gridTemplateColumns: 'minmax(0, 1fr) 520px' }}>
        <Card title="Timeline" sub={d ? `${d.events.length} events` : undefined}>
          <div style={{ maxHeight: 760, overflowY: 'auto', paddingRight: 6 }}>{d ? <TimelineRail events={d.events} /> : <div className="faint small">Loading…</div>}</div>
        </Card>
        <div className="col gap-16">
          <Card title="Recent observations" sub={d ? `${d.swimlane.months[0] ?? ''} – ${d.swimlane.months[d.swimlane.months.length - 1] ?? ''} · trailing six months` : undefined}>
            {d ? <SwimlaneStrip swimlane={d.swimlane} /> : <div className="faint small">Loading…</div>}
            <div className="tiny faint mt-8">Dots are point measurements; bars are intervals such as an active prescription.</div>
          </Card>
          <Card title="Reading the timeline" soft>
            <div className="why">
              <p>Clinical events come from your connected records; device, nutrition and survey observations are summarised per month. Filter with the chips above to focus on one category.</p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
