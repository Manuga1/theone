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
  return (
    <div className="lineage">
      {steps.map((s, i) => {
        const Icon = ICON[s.key] ?? Database;
        return (
          <span key={s.key + i} style={{ display: 'contents' }}>
            <div className="lineage__step">
              <div className="lineage__icon"><Icon /></div>
              <div className="lineage__label">{s.label}</div>
              {s.detail && <div className="lineage__detail">{s.detail}</div>}
            </div>
            {i < steps.length - 1 && <span className="lineage__arrow"><ArrowRight /></span>}
          </span>
        );
      })}
    </div>
  );
}
