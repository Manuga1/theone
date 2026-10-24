import type { ReactNode } from 'react';

export type TabItem<K extends string = string> = { key: K; label: ReactNode; count?: number | string | null };
export type TabsProps<K extends string> = {
  items: TabItem<K>[];
  value: K;
  onChange: (k: K) => void;
  variant?: 'segmented' | 'underline' | 'pills';
};

export function Tabs<K extends string>({ items, value, onChange, variant = 'segmented' }: TabsProps<K>) {
  const cls = ['tabs', variant === 'underline' && 'tabs--underline', variant === 'pills' && 'tabs--pills'].filter(Boolean).join(' ');
  return (
    <div className={cls} role="tablist">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          role="tab"
          aria-selected={it.key === value}
          className={`tab${it.key === value ? ' tab--active' : ''}`}
          onClick={() => onChange(it.key)}
        >
          {it.label}
          {it.count !== undefined && it.count !== null && <span className="tab__count">{typeof it.count === 'number' ? `(${it.count})` : it.count}</span>}
        </button>
      ))}
    </div>
  );
}
