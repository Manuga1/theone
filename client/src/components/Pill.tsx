import type { ReactNode } from 'react';
import { Check, CircleDot, Circle, DollarSign } from 'lucide-react';
import type { NodeState } from '@shared/api-types';

export type PillVariant = NodeState | 'opportunity' | 'demand' | 'neutral' | 'accent' | 'purple' | 'dark' | 'outline';

export type PillProps = { variant?: PillVariant; children?: ReactNode; icon?: boolean; sm?: boolean; title?: string };

const DEFAULT_LABEL: Record<PillVariant, string> = {
  verified: 'Verified',
  partial: 'Partial',
  missing: 'Missing',
  opportunity: 'Opportunity',
  demand: '$ Requested',
  neutral: '',
  accent: '',
  purple: '',
  dark: '',
  outline: '',
};

function iconFor(v: PillVariant) {
  switch (v) {
    case 'verified': return <Check strokeWidth={3} />;
    case 'partial': return <CircleDot />;
    case 'missing': return <Circle />;
    case 'demand': return <DollarSign strokeWidth={3} />;
    default: return null;
  }
}

export function Pill({ variant = 'neutral', children, icon = false, sm, title }: PillProps) {
  const label = children ?? DEFAULT_LABEL[variant];
  return (
    <span className={`pill pill--${variant}${sm ? ' pill--sm' : ''}`} title={title}>
      {icon && iconFor(variant)}
      {label}
    </span>
  );
}

/** Pill for a node state, with icon by default. */
export function StatePill({ state, sm }: { state: NodeState; sm?: boolean }) {
  return <Pill variant={state} icon sm={sm} />;
}
