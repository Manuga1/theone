// Vertical year rail with event cards. Years come from the events; "Today" is appended from the demo clock.
import type { TimelineEvent } from '@shared/api-types';
import { DEMO_TODAY } from '@shared/clock';
import { dateShort } from '@shared/fmt';
import { Pill } from './Pill';
import { CATEGORY_COLOR } from './icons';

export type TimelineRailProps = {
  events: TimelineEvent[];
  showToday?: boolean;
  compact?: boolean;
  onSelect?: (e: TimelineEvent) => void;
};

export function TimelineRail({ events, showToday = true, compact, onSelect }: TimelineRailProps) {
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));
  const years = new Map<string, TimelineEvent[]>();
  for (const e of sorted) {
    const y = e.date.slice(0, 4);
    if (!years.has(y)) years.set(y, []);
    years.get(y)!.push(e);
  }
  const rows = Array.from(years.entries());
  if (rows.length === 0 && !showToday) return <div className="rail__empty">No events in this category.</div>;
  return (
    <div className="rail">
      {rows.map(([year, evs]) => (
        <div className="rail__row" key={year}>
          <div className="rail__year">{year}</div>
          <div className="rail__spine"><span className="rail__dot" style={{ background: CATEGORY_COLOR[evs[0]?.category ?? 'other'], boxShadow: `0 0 0 1.5px ${CATEGORY_COLOR[evs[0]?.category ?? 'other']}` }} /></div>
          <div className="rail__cards">
            {evs.map((e) => (
              <div className="rail__card" key={e.id} onClick={() => onSelect?.(e)} style={onSelect ? { cursor: 'pointer' } : undefined}>
                <div className="rail__card-title">{e.title}</div>
                {!compact && e.detail && <div className="rail__card-detail">{e.detail}</div>}
                <div className="rail__card-meta">
                  <Pill variant="outline" sm>{e.category}</Pill>
                  <span className="tiny faint">{dateShort(e.date)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {showToday && (
        <div className="rail__row">
          <div className="rail__year rail__year--today">Today</div>
          <div className="rail__spine"><span className="rail__dot" /></div>
          <div className="rail__cards"><div className="rail__card" style={{ background: 'var(--accent-soft)', borderColor: 'transparent', color: 'var(--accent-strong)' }}><div className="rail__card-title">{dateShort(DEMO_TODAY)} — your health signature as of today</div></div></div>
        </div>
      )}
    </div>
  );
}
