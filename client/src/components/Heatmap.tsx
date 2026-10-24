// B5 coverage heatmap: rows = cohort / missing-data groups, cols = modalities, cell = complete / partial / missing dot.
import type { CohortPreview, HeatCell } from '@shared/api-types';
import { kfloor } from '@shared/fmt';

export type HeatmapProps = { heatmap: CohortPreview['heatmap']; showLegend?: boolean; showN?: boolean };

const LABEL: Record<HeatCell, string> = { complete: 'Complete', partial: 'Partial', missing: 'Missing' };

export function Heatmap({ heatmap, showLegend = true, showN = true }: HeatmapProps) {
  return (
    <div>
      <table className="heat">
        <thead>
          <tr>
            <th />
            {heatmap.columns.map((c) => <th key={c.slug} title={c.slug}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {heatmap.rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}{showN && <span className="heat__n">{kfloor(r.n)}</span>}</td>
              {r.cells.map((c, i) => (
                <td key={i}><span className={`heat__cell heat__cell--${c}`} title={`${heatmap.columns[i]?.label ?? ''}: ${LABEL[c]}`} /></td>
              ))}
            </tr>
          ))}
          {heatmap.rows.length === 0 && <tr><td colSpan={heatmap.columns.length + 1} className="faint">No rows.</td></tr>}
        </tbody>
      </table>
      {showLegend && (
        <div className="legend mt-8">
          <span><span className="heat__cell heat__cell--complete" /> Complete</span>
          <span><span className="heat__cell heat__cell--partial" /> Partial</span>
          <span><span className="heat__cell heat__cell--missing" /> Missing</span>
        </div>
      )}
    </div>
  );
}
