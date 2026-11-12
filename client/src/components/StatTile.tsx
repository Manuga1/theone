import type { ReactNode } from 'react';

export type StatTileProps = {
  label: ReactNode;
  value: ReactNode;
  /** small line under the value, e.g. "+6% this month" */
  delta?: ReactNode;
  tone?: 'neutral' | 'up' | 'down' | 'accent';
  icon?: ReactNode;
  iconTone?: 'accent' | 'green' | 'amber' | 'purple';
  small?: boolean;
  /** small caption under the tile, e.g. the "illustrative" label on dollar figures */
  note?: ReactNode;
};

export function StatTile({ label, value, delta, tone = 'neutral', icon, iconTone = 'accent', small, note }: StatTileProps) {
  return (
    <div className="stat">
      <div className="stat__label">
        {icon && <span className={`stat__icon stat__icon--${iconTone}`}>{icon}</span>}
        {label}
      </div>
      <div className={`stat__value${small ? ' stat__value--sm' : ''}`}>{value}</div>
      {delta !== undefined && delta !== null && <div className={`stat__delta${tone !== 'neutral' ? ` stat__delta--${tone}` : ''}`}>{delta}</div>}
      {note !== undefined && note !== null && <div className="stat__note">{note}</div>}
    </div>
  );
}
