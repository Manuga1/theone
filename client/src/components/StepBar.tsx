import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';

export type Step = { key: string; label: string; href?: string };
export const COHORT_STEPS: Step[] = [
  { key: 'define', label: 'Define' },
  { key: 'review', label: 'Review' },
  { key: 'enrich', label: 'Enrich' },
  { key: 'proposal', label: 'Proposal' },
];

export function StepBar({ steps = COHORT_STEPS, active }: { steps?: Step[]; active: string }) {
  const idx = Math.max(0, steps.findIndex((s) => s.key === active));
  return (
    <div className="steps">
      {steps.map((s, i) => {
        const state = i < idx ? 'done' : i === idx ? 'active' : 'todo';
        const inner = (
          <>
            <span className="steps__n">{state === 'done' ? <Check size={11} strokeWidth={3} /> : i + 1}</span>
            <span>{s.label}</span>
          </>
        );
        return (
          <span key={s.key} style={{ display: 'contents' }}>
            <span className={`steps__item steps__item--${state}`}>{s.href ? <Link to={s.href} className="row gap-6">{inner}</Link> : inner}</span>
            {i < steps.length - 1 && <span className="steps__line" />}
          </span>
        );
      })}
    </div>
  );
}
