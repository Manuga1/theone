// B5 bottom: share of the base population with any data per modality.
import type { CohortPreview } from '@shared/api-types';
import { BarRow } from './ProgressBar';

export type CoverageBarsProps = { bars: CohortPreview['bars']; title?: string; labelWidth?: number };

export function CoverageBars({ bars, title = 'Coverage counts', labelWidth = 72 }: CoverageBarsProps) {
  return (
    <div>
      {title && <div className="section-title">{title}</div>}
      <div className="col gap-6">
        {bars.map((b) => (
          <BarRow key={b.slug} label={b.label} value={b.pct} labelWidth={labelWidth} tone={b.pct >= 90 ? 'green' : b.pct >= 40 ? 'accent' : 'amber'} />
        ))}
        {bars.length === 0 && <div className="rail__empty">No coverage data.</div>}
      </div>
    </div>
  );
}
