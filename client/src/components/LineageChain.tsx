// Horizontal data-lineage chain: device → raw → verified → standardized → trajectory.
import { ArrowRight, Watch, FileText, ShieldCheck, Layers, ChartLine, Database, Camera, FlaskConical, Microscope, type LucideProps } from 'lucide-react';
import type { ComponentType } from 'react';
import type { LineageStep } from '@shared/api-types';

const ICON: Record<string, ComponentType<LucideProps>> = {
  device: Watch,
  source: Database,
  raw: FileText,
  photo: Camera,
  lab: FlaskConical,
  sequencing: Microscope,
  verified: ShieldCheck,
  standardized: Layers,
  observation: Layers,
  derived: ChartLine,
  trajectory: ChartLine,
};

export function LineageChain({ steps }: { steps: LineageStep[] }) {
  if (steps.length === 0) return <div className="rail__empty">No lineage recorded.</div>;
  // Two-row grid: icons (and arrows) on row 1 share one baseline; labels wrap on row 2 without moving the icons.
  const columns = steps.map((_, i) => (i < steps.length - 1 ? 'minmax(56px, 1fr) 18px' : 'minmax(56px, 1fr)')).join(' ');
  return (
    <div className="lineage" style={{ gridTemplateColumns: columns }}>
      {steps.map((s, i) => {
        const Icon = ICON[s.key] ?? Database;
        const col = i * 2 + 1;
        return (
          <span key={s.key + i} style={{ display: 'contents' }}>
            <div className="lineage__icon" style={{ gridRow: 1, gridColumn: col }}><Icon /></div>
            {i < steps.length - 1 && <span className="lineage__arrow" style={{ gridRow: 1, gridColumn: col + 1 }}><ArrowRight /></span>}
            <div className="lineage__step" style={{ gridRow: 2, gridColumn: col }}>
              <div className="lineage__label">{s.label}</div>
              {s.detail && <div className="lineage__detail">{s.detail}</div>}
            </div>
          </span>
        );
      })}
    </div>
  );
}
