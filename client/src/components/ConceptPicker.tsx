// Searchable leaf picker (File under … / move an inbox item). Options come from useConcepts().
import { useMemo, useState } from 'react';
import type { ConceptOption } from '../useConcepts';
import { ConceptPath } from './ConceptPath';
import { ValueKindGlyph } from './ValueKind';

export function ConceptPicker({ concepts, value, onChange, exclude }: { concepts: ConceptOption[]; value: string | null; onChange: (slug: string) => void; exclude?: string | null }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = concepts.filter((c) => c.slug !== exclude);
    if (!needle) return base.slice(0, 60);
    return base.filter((c) => `${c.name} ${c.slug} ${c.path.join(' ')}`.toLowerCase().includes(needle)).slice(0, 60);
  }, [concepts, q, exclude]);
  return (
    <div className="picker">
      <input className="input input--sm" placeholder="Search a branch…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search branches" />
      <div className="picker__list" role="listbox">
        {list.map((c) => (
          <div key={c.slug} role="option" aria-selected={c.slug === value} className={`picker__item${c.slug === value ? ' picker__item--active' : ''}`} onClick={() => onChange(c.slug)} data-slug={c.slug} data-level={c.level}>
            {c.level === 'group' ? <span className="pill pill--neutral pill--sm">group</span> : <ValueKindGlyph kind={c.valueKind} />}
            <ConceptPath path={c.path} />
          </div>
        ))}
        {list.length === 0 && <div className="picker__item faint">No branch matches.</div>}
      </div>
    </div>
  );
}
