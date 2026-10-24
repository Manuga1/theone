// B3 cohort funnel: stacked narrowing bars, one per stage, and a "ready now" callout. Buyer counts are k-floored.
import type { FunnelStage } from '@shared/api-types';
import { kfloor } from '@shared/fmt';

export type FunnelProps = { stages: FunnelStage[]; readyNow?: number | null; readyLabel?: string; maxWidth?: number; minPct?: number };

const COLORS = ['#1d6ef5', '#2b7cf0', '#3a8aeb', '#4a98e3', '#2fa0b8', '#22a98f', '#1a9e5c'];

export function Funnel({ stages, readyNow = null, readyLabel = 'Ready now', maxWidth = 340, minPct = 42 }: FunnelProps) {
  const n = Math.max(1, stages.length - 1);
  return (
    <div className="funnel" style={{ maxWidth: '100%' }}>
      {stages.map((s, i) => {
        const w = 100 - (i / n) * (100 - minPct);
        const color = COLORS[Math.min(i, COLORS.length - 1)];
        return (
          <div key={s.key} className="funnel__stage" style={{ width: `${(w / 100) * maxWidth}px`, maxWidth: '100%', background: color }} title={`${s.label}: ${kfloor(s.n)}`}>
            <span className="num" style={{ fontWeight: 700 }}>{kfloor(s.n)}</span>&nbsp;<span style={{ opacity: 0.9, fontWeight: 500 }}>{s.label}</span>
          </div>
        );
      })}
      {readyNow !== null && (
        <div className="funnel__ready">
          <div className="funnel__ready-label">{readyLabel.toUpperCase()}</div>
          <div className="funnel__ready-n">{kfloor(readyNow)} participants</div>
        </div>
      )}
      {stages.length === 0 && <div className="rail__empty">No cohort defined.</div>}
    </div>
  );
}
