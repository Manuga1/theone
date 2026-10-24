// B5 bottom: share of the base population with any data per modality.
import type { CohortPreview } from '@shared/api-types';
import { BarRow } from './ProgressBar';

export type CoverageBarsProps = { bars: CohortPreview['bars']; title?: string; /** one-line semantics shown under the title and as a tooltip */ sub?: string; labelWidth?: number };

export function CoverageBars({ bars, title = 'Coverage counts', sub, labelWidth = 72 }: CoverageBarsProps) {
  return (
    <div title={sub}>
      {title && <div className="section-title" style={sub ? { marginBottom: 2 } : undefined}>{title}</div>}
      {sub && <div className="tiny faint" style={{ marginBottom: 8 }}>{sub}</div>}
      <div className="col gap-6">
        {bars.map((b) => (
          <BarRow key={b.slug} label={b.label} value={b.pct} labelWidth={labelWidth} tone={b.pct >= 90 ? 'green' : b.pct >= 40 ? 'accent' : 'amber'} />
        ))}
        {bars.length === 0 && <div className="rail__empty">No coverage data.</div>}
      </div>
    </div>
  );
}
