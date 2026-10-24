// B4 missing-data matrix: for each missing-variable group, how many eligible people lack it and how many are recruitable.
import type { ReactNode } from 'react';
import type { CohortPreview } from '@shared/api-types';
import { kfloor } from '@shared/fmt';

export type MissingMatrixProps = {
  matrix: CohortPreview['matrix'];
  readyNow: number;
  action?: ReactNode;
};

export function MissingMatrix({ matrix, readyNow, action }: MissingMatrixProps) {
  const totalEligible = matrix.groups.reduce((a, g) => a + g.eligible, 0);
  const totalRecruitable = matrix.groups.reduce((a, g) => a + g.recruitable, 0);
  return (
    <div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Missing variable</th>
              <th className="num">Eligible people</th>
              <th className="num">Estimated recruitable</th>
            </tr>
          </thead>
          <tbody>
            {matrix.groups.map((g) => (
              <tr key={g.key}>
                <td className="strong">{g.label}</td>
                <td className="num">{kfloor(g.eligible)}</td>
                <td className="num">{kfloor(g.recruitable)}</td>
              </tr>
            ))}
            {matrix.groups.length === 0 && (
              <tr><td colSpan={3} className="faint center">No enrichable gaps for this cohort.</td></tr>
            )}
          </tbody>
          {matrix.groups.length > 0 && (
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="num">{kfloor(totalEligible)}</td>
                <td className="num">{kfloor(totalRecruitable)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {matrix.notRecruitable.length > 0 && (
        <div className="note mt-8">
          {matrix.notRecruitable.map((n) => (
            <div key={n.label}>{/^not recruitable/i.test(n.label) ? n.label : `Not recruitable — ${n.label}`}: <strong className="num">{kfloor(n.n)}</strong></div>
          ))}
        </div>
      )}
      <div className="mt-16 stack-rows">
        <div><span>Current complete cohort</span><span className="v">{kfloor(readyNow)}</span></div>
        <div>
          <span>Estimated complete cohort after enrichment</span>
          <span className="v" style={{ fontSize: 15 }}>{kfloor(matrix.estimatedAfter.low)} – {kfloor(matrix.estimatedAfter.high)}</span>
        </div>
      </div>
      {action && <div className="mt-12">{action}</div>}
    </div>
  );
}
