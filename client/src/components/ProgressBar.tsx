import type { ReactNode } from 'react';
import { pct } from '@shared/fmt';

export type BarTone = 'accent' | 'green' | 'amber' | 'purple' | 'teal' | 'red';

export function ProgressBar({ value, tone = 'accent', thick, thin, color }: { value: number; tone?: BarTone; thick?: boolean; thin?: boolean; color?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={`bar${thick ? ' bar--thick' : ''}${thin ? ' bar--thin' : ''}`} role="progressbar" aria-valuenow={v}>
      <div className={`bar__fill${tone !== 'accent' ? ` bar__fill--${tone}` : ''}`} style={{ width: `${v}%`, ...(color ? { background: color } : {}) }} />
    </div>
  );
}

/** Labelled bar row: label | bar | value. Used by coverage bars and study coverage. */
export function BarRow({ label, value, display, tone, color, labelWidth }: { label: ReactNode; value: number; display?: ReactNode; tone?: BarTone; color?: string; labelWidth?: number }) {
  return (
    <div className="bar-row" style={labelWidth ? { gridTemplateColumns: `${labelWidth}px 1fr 44px` } : undefined}>
      <span className="bar-row__label">{label}</span>
      <ProgressBar value={value} tone={tone} color={color} />
      <span className="bar-row__value">{display ?? pct(value)}</span>
    </div>
  );
}
