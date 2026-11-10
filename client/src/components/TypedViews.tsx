// Node-detail renderers by valueKind: boolean strip, text log, one_time fact card + history, categorical variant breakdown,
// and the "classified by rules/Claude · confidence" line.
import { Link } from 'react-router-dom';
import { Bot, ListChecks, GitBranch } from 'lucide-react';
import type { NodeDetail, NodeHistoryRow, NodeVariant, ClassifierName } from '@shared/api-types';
import { dateShort, dateLong } from '@shared/fmt';
import { Pill } from './Pill';
import { Num } from './Fmt';

export function BooleanStrip({ cells }: { cells: { date: string; value: boolean | null }[] }) {
  if (cells.length === 0) return <div className="rail__empty">No yes/no entries yet.</div>;
  const yes = cells.filter((c) => c.value === true).length;
  const no = cells.filter((c) => c.value === false).length;
  return (
    <div>
      <div className="bstrip" role="img" aria-label={`${yes} yes, ${no} no over ${cells.length} days`}>
        {cells.map((c) => <span key={c.date} className={`bstrip__cell${c.value === true ? ' bstrip__cell--yes' : c.value === false ? ' bstrip__cell--no' : ''}`} title={`${dateShort(c.date)}: ${c.value === null ? 'no entry' : c.value ? 'yes' : 'no'}`} />)}
      </div>
      <div className="bstrip__legend">
        <span><span className="bstrip__cell bstrip__cell--yes" /> yes · <Num n={yes} /></span>
        <span><span className="bstrip__cell bstrip__cell--no" /> no · <Num n={no} /></span>
        <span><span className="bstrip__cell" /> no entry</span>
        <span className="faint">{dateShort(cells[0].date)} – {dateShort(cells[cells.length - 1].date)}</span>
      </div>
    </div>
  );
}

export function TextLog({ items }: { items: NonNullable<NodeDetail['textLog']> }) {
  if (items.length === 0) return <div className="rail__empty">No notes yet.</div>;
  return (
    <div className="textlog">
      {items.map((t) => (
        <div className="textlog__item" key={t.id}>
          <div className="textlog__when">{dateLong(t.observedAt)}</div>
          <div>{t.text}</div>
          {Object.keys(t.attributes ?? {}).length > 0 && (
            <div className="textlog__attrs">{Object.entries(t.attributes).map(([k, v]) => <Pill key={k} variant="outline" sm>{k}: {v}</Pill>)}</div>
          )}
        </div>
      ))}
    </div>
  );
}

export function FactCard({ history, unit }: { history: NodeHistoryRow[]; unit: string | null }) {
  const current = history.find((h) => h.current) ?? history[0];
  if (!current) return <div className="rail__empty">No value recorded yet. Updates append; nothing is overwritten.</div>;
  const versions = history.length;
  return (
    <div className="fact">
      <div className="tiny faint" style={{ fontWeight: 600 }}>Current value</div>
      <div className="fact__value">{current.valueLabel}{unit ? <span className="small muted"> {unit}</span> : null}</div>
      <div className="fact__meta">
        Valid since {current.validFrom ? dateLong(current.validFrom) : dateLong(current.observedAt)} · {current.provenance} · {current.verification}
        {versions > 1 && <> · <Num n={versions} /> versions kept</>}
      </div>
    </div>
  );
}

export function HistoryTable({ history, unit }: { history: NodeHistoryRow[]; unit: string | null }) {
  if (history.length === 0) return <div className="rail__empty">No versions yet.</div>;
  return (
    <div className="table-wrap">
      <table className="table table--compact">
        <thead><tr><th>Value</th><th>Valid from</th><th>Valid to</th><th>Recorded</th><th>Provenance</th><th>Verification</th></tr></thead>
        <tbody>
          {history.map((h) => (
            <tr key={h.id} className={h.current ? 'strong' : undefined}>
              <td>{h.valueLabel}{unit ? ` ${unit}` : ''} {h.current && <Pill variant="verified" sm>current</Pill>}</td>
              <td className="muted num">{h.validFrom ? dateShort(h.validFrom) : '—'}</td>
              <td className="muted num">{h.validTo ? dateShort(h.validTo) : <span className="faint">open</span>}</td>
              <td className="muted num">{dateShort(h.observedAt)}</td>
              <td className="muted">{h.provenance}</td>
              <td className="muted">{h.verification}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function VariantBreakdown({ variants, total }: { variants: NodeVariant[]; total: number }) {
  if (variants.length === 0) return <div className="rail__empty">No sub-branches yet — the first new answer (a brand, a drink, an activity) creates one.</div>;
  const max = Math.max(1, ...variants.map((v) => v.nObs));
  return (
    <div className="variants">
      {variants.map((v) => (
        <div className="variant" key={v.slug}>
          <div className="variant__name">
            <GitBranch style={{ width: 11, height: 11, color: 'var(--text-3)', flex: '0 0 11px' }} />
            <Link to={`/p/node/${v.slug}`}>{v.name}</Link>
            {v.isNew && <span className="pill pill--new pill--sm">new</span>}
          </div>
          <div className="bar bar--thin"><div className="bar__fill" style={{ width: `${(v.nObs / max) * 100}%` }} /></div>
          <div className="right small num"><Num n={v.nObs} />{total > 0 && <span className="faint"> · {Math.round((v.nObs / total) * 100)}%</span>}</div>
        </div>
      ))}
    </div>
  );
}

export function ClassifiedLine({ classified }: { classified: { n: number; meanConfidence: number | null; classifier: ClassifierName | null } | undefined }) {
  if (!classified || classified.n === 0) return null;
  const who = classified.classifier === 'claude' ? 'Claude' : classified.classifier === 'rules' ? 'rules' : 'the classifier';
  return (
    <span className="classified" title="Observations filed automatically from quick logs, uploads and check-ins">
      {classified.classifier === 'claude' ? <Bot /> : <ListChecks />}
      <Num n={classified.n} /> classified by {who}{classified.meanConfidence !== null ? <> · confidence {Math.round(classified.meanConfidence * 100)}%</> : null}
    </span>
  );
}
