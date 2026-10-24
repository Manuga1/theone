// Trailing-months swimlanes: one lane per variable, dots for point observations, bars for intervals (e.g. a medication).
import type { ParticipantTimeline } from '@shared/api-types';
import { daysBetween } from '@shared/clock';

export type SwimlaneStripProps = { swimlane: ParticipantTimeline['swimlane']; title?: string };

export function SwimlaneStrip({ swimlane }: SwimlaneStripProps) {
  const { window, months, lanes } = swimlane;
  const total = Math.max(1, daysBetween(window.from, window.to));
  const x = (date: string) => Math.max(0, Math.min(100, (daysBetween(window.from, date) / total) * 100));
  const cols = Math.max(1, months.length);
  return (
    <div className="swim">
      <div className="swim__head">
        <span />
        <div className="swim__months" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {months.map((m) => <span key={m}>{m}</span>)}
        </div>
      </div>
      {lanes.map((lane) => (
        <div className="swim__lane" key={lane.key}>
          <span className="swim__lane-label">{lane.label}</span>
          <div className="swim__track">
            <div className="swim__grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
              {months.map((m) => <span key={m} />)}
            </div>
            {lane.points.map((p, i) =>
              p.kind === 'bar' ? (
                <span key={i} className="swim__bar" style={{ left: `${x(p.date)}%`, width: `${Math.max(1, x(p.barUntil ?? window.to) - x(p.date))}%`, background: lane.color }} title={`${lane.label} ${p.date} → ${p.barUntil ?? window.to}`} />
              ) : (
                <span key={i} className="swim__dot" style={{ left: `${x(p.date)}%`, background: lane.color }} title={`${lane.label} ${p.date}${p.value !== undefined ? `: ${p.value}` : ''}`} />
              ),
            )}
          </div>
        </div>
      ))}
      {lanes.length === 0 && <div className="rail__empty">No recent observations.</div>}
    </div>
  );
}
