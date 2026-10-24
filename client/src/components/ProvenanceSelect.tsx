// Buyer-side provenance control: the minimum provenance rank a modality must have to count as "has data".
import { PROVENANCE_CLASSES, PROVENANCE_LABEL, PROVENANCE_RANK } from '@shared/provenance';

const OPTIONS = Array.from(new Map(PROVENANCE_CLASSES.map((c) => [PROVENANCE_RANK[c], c])).entries())
  .sort((a, b) => a[0] - b[0])
  .map(([rank]) => ({
    rank,
    label: PROVENANCE_CLASSES.filter((c) => PROVENANCE_RANK[c] === rank).map((c) => PROVENANCE_LABEL[c]).join(' / '),
  }));

export function ProvenanceSelect({ value, onChange, label, small }: { value: number; onChange: (rank: number) => void; label?: string; small?: boolean }) {
  return (
    <label className="field">
      {label && <span className="field__label">{label}</span>}
      <select className={`select${small ? ' select--sm' : ''}`} value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {OPTIONS.map((o) => (
          <option key={o.rank} value={o.rank}>
            ≥ {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
