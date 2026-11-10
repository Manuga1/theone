// P4 Your Health Timeline: quick log on top, category chips, the year rail, and the trailing-months swimlanes.
// Items filed from the quick-log box appear on the rail immediately (optimistic card) and are replaced by the refetch.
import { useEffect, useState } from 'react';
import type { ParticipantTimeline, TimelineEvent, QuickLogResult } from '@shared/api-types';
import { useApi } from '../hooks';
import { Card, Tabs, TimelineRail, SwimlaneStrip, ErrorBox, QuickLog } from '../components';

type Cat = TimelineEvent['category'] | 'all';

function categoryOf(slug: string): TimelineEvent['category'] {
  if (slug.startsWith('clinical.labs')) return 'labs';
  if (slug.startsWith('clinical.medications')) return 'medications';
  if (slug.startsWith('clinical.imaging')) return 'imaging';
  if (slug.startsWith('clinical')) return 'clinical';
  if (slug.startsWith('biology') || slug.includes('genom')) return 'genomics';
  if (slug.startsWith('physiology')) return 'devices';
  if (slug.startsWith('behavior')) return 'lifestyle';
  return 'other';
}

export default function TimelinePage() {
  const [cat, setCat] = useState<Cat>('all');
  const [justFiled, setJustFiled] = useState<TimelineEvent[]>([]);
  const q = useApi<ParticipantTimeline>(`/participant/timeline${cat === 'all' ? '' : `?category=${cat}`}`);
  const d = q.data;
  // Drop optimistic cards once the refetched timeline carries an event for the same concept on the same day.
  useEffect(() => {
    if (!d) return;
    setJustFiled((list) => list.filter((f) => !d.events.some((e) => e.conceptSlug === f.conceptSlug && e.date.slice(0, 10) === f.date.slice(0, 10) && e.title === f.title)));
  }, [d]);
  if (q.error) return <ErrorBox error={q.error} />;

  const onFiled = (r: QuickLogResult) => {
    if (r.status !== 'filed' || !r.filedAs) return;
    const f = r.filedAs;
    setJustFiled((list) => [
      { id: -r.item.id, date: f.observedAt.slice(0, 10), kind: 'quick_log', category: categoryOf(f.conceptSlug), title: `${f.conceptName}: ${f.valueLabel}`, detail: `Logged just now · filed under ${f.path.join(' › ')}${f.newBranch ? ' (new branch)' : ''}`, conceptSlug: f.conceptSlug },
      ...list,
    ]);
  };
  const events = d ? [...d.events, ...justFiled.filter((f) => cat === 'all' || f.category === cat)] : [];

  return (
    <div className="col gap-16">
      <div className="page-head--row" style={{ marginBottom: 0 }}>
        <div><h1 className="h1">Your Health Timeline</h1><div className="sub">Every event in your graph, with the sources that recorded it.</div></div>
      </div>
      <Card title="Quick log" sub="Logged items land on the rail immediately."><QuickLog compact onFiled={onFiled} /></Card>
      {d && <Tabs variant="pills" value={cat} onChange={setCat} items={d.categories.map((c) => ({ key: c.key, label: c.label, count: c.n }))} />}
      <div className="grid gap-16 grid--main-aside-520">
        <Card title="Timeline" sub={d ? `${events.length} events${justFiled.length > 0 ? ` · ${justFiled.length} just logged` : ''}` : undefined}>
          <div style={{ maxHeight: 760, overflowY: 'auto', paddingRight: 6 }}>{d ? <TimelineRail events={events} /> : <div className="faint small">Loading…</div>}</div>
        </Card>
        <div className="col gap-16">
          <Card title="Recent observations" sub={d ? `${d.swimlane.months[0] ?? ''} – ${d.swimlane.months[d.swimlane.months.length - 1] ?? ''} · trailing six months` : undefined}>
            {d ? <SwimlaneStrip swimlane={d.swimlane} /> : <div className="faint small">Loading…</div>}
            <div className="tiny faint mt-8">Dots are point measurements; bars are intervals such as an active prescription.</div>
          </Card>
          <Card title="Reading the timeline" soft>
            <div className="why">
              <p>Clinical events come from your connected records; device, nutrition and survey observations are summarised per month. Filter with the chips above to focus on one category.</p>
              <p>Quick logs are filed by the classifier into the matching branch; anything it is unsure about waits in your inbox under Data Sources.</p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
