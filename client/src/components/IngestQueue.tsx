// Ingestion queue table (status, proposed branch + confidence, actions) and the review box for needs_review items:
// Accept / File under (concept picker) / Create branch / Discard → POST /participant/ingest/:id/review.
import { useState } from 'react';
import { Check, FolderInput, GitBranch, Trash2, FileText, Image, Mic, Keyboard, Smartphone, ClipboardList, Bot, ListChecks } from 'lucide-react';
import type { IngestItem, IngestStatus, IngestKind, ReviewAction, ReviewResult, ValueKind } from '@shared/api-types';
import { api } from '../api';
import { useAction } from '../useAction';
import { pushToast } from '../toast';
import type { ConceptOption } from '../useConcepts';
import { ConceptPath } from './ConceptPath';
import { ConceptPicker } from './ConceptPicker';
import { Pill } from './Pill';
import { formatBytes } from '../digest';
import { money } from '@shared/fmt';
import { VALUE_KIND_LABEL } from './ValueKind';

export const STATUS_LABEL: Record<IngestStatus, string> = { queued: 'Queued', auto_filed: 'Auto-filed', needs_review: 'Needs review', accepted: 'Accepted', discarded: 'Discarded' };
const STATUS_VARIANT: Record<IngestStatus, 'verified' | 'partial' | 'missing' | 'neutral' | 'accent'> = { queued: 'neutral', auto_filed: 'verified', needs_review: 'partial', accepted: 'verified', discarded: 'missing' };

function kindIcon(k: IngestKind, mime: string | null) {
  if (k === 'photo' || (mime ?? '').startsWith('image/')) return <Image />;
  if (k === 'voice') return <Mic />;
  if (k === 'quicklog') return <Keyboard />;
  if (k === 'apple_health') return <Smartphone />;
  if (k === 'checkin') return <ClipboardList />;
  return <FileText />;
}

export function Confidence({ value, threshold }: { value: number; threshold: number }) {
  const pct = Math.round(value * 100);
  return (
    <span className="conf" title={`confidence ${pct}% (auto-file threshold ${Math.round(threshold * 100)}%)`}>
      <span className="conf__bar"><span className={`conf__fill${value < threshold ? ' conf__fill--low' : ''}`} style={{ width: `${pct}%`, display: 'block' }} /></span>
      {pct}%
    </span>
  );
}

export function ReviewBox({ item, concepts, groups = [], onDone }: { item: IngestItem; concepts: ConceptOption[]; groups?: ConceptOption[]; onDone?: (r: ReviewResult) => void }) {
  const p = item.proposal;
  const [mode, setMode] = useState<'none' | 'move' | 'create'>('none');
  const [target, setTarget] = useState<string | null>(p?.conceptSlug ?? null);
  const [newName, setNewName] = useState(p?.newConcept?.name ?? '');
  const [newParent, setNewParent] = useState<string | null>(p?.newConcept?.parentSlug ?? p?.conceptSlug ?? null);
  const [newKind, setNewKind] = useState<ValueKind>(p?.newConcept?.valueKind ?? 'categorical');
  const [newUnit, setNewUnit] = useState(p?.newConcept?.unit ?? '');
  // A group parent creates a new variable under it; a variable (leaf) parent creates a sub-branch of that variable
  // (the server requires a group for a new leaf, or `isVariantOf` for a sub-branch).
  const parentIsLeaf = !!newParent && concepts.some((c) => c.slug === newParent);
  const createAction = (): ReviewAction | null => {
    if (!newName.trim() || !newParent) return null;
    return { action: 'create_branch', newConcept: { name: newName.trim(), parentSlug: newParent, valueKind: newKind, unit: newUnit.trim() || null, isVariantOf: p?.newConcept?.isVariantOf ?? (parentIsLeaf ? newParent : null) } };
  };
  const act = useAction(async (action: ReviewAction) => {
    const r = await api.post<ReviewResult>(`/participant/ingest/${item.id}/review`, action);
    const where = r.createdConcept ? `new branch ${r.createdConcept.path.join(' › ')}` : r.item.conceptName ? `filed under ${r.item.conceptName}` : STATUS_LABEL[r.item.status].toLowerCase();
    pushToast('success', `${item.filename ?? item.text?.slice(0, 40) ?? 'Item'}: ${where}${r.rewardCents > 0 ? ` · +${money(r.rewardCents, { cents: true })} reward` : ''}`);
    onDone?.(r);
    return r;
  }, { errorPrefix: 'Review' });

  return (
    <div className="review-box">
      <div className="review-box__title">{item.reviewReason ?? 'Needs your decision'}</div>
      {p && (
        <div className="small">
          {p.conceptSlug ? <>Best guess: <ConceptPath path={p.path} /></> : p.newConcept ? <>Proposed new branch: <strong>{p.newConcept.name}</strong> under <ConceptPath path={p.path} /> ({VALUE_KIND_LABEL[p.newConcept.valueKind]})</> : 'No branch proposed.'}
          {p.rationale && <div className="tiny faint mt-8">{p.classifier === 'claude' ? <Bot style={{ width: 10, height: 10 }} /> : <ListChecks style={{ width: 10, height: 10 }} />} {p.rationale}</div>}
          {p.alternatives.length > 0 && (
            <div className="chip-row mt-8">
              {p.alternatives.map((a) => <button key={a.conceptSlug} type="button" className={`chip${target === a.conceptSlug && mode === 'move' ? ' chip--active' : ''}`} onClick={() => { setTarget(a.conceptSlug); setMode('move'); }}>{a.conceptName} <span className="chip__n">{Math.round(a.confidence * 100)}%</span></button>)}
            </div>
          )}
        </div>
      )}
      <div className="review-box__actions">
        {p?.conceptSlug && <button className="btn btn--sm btn--primary" disabled={act.busy} onClick={() => act.run({ action: 'accept' })}><Check /> Accept</button>}
        {p?.newConcept && mode !== 'create' && <button className="btn btn--sm btn--primary" disabled={act.busy} onClick={() => act.run({ action: 'create_branch', newConcept: p.newConcept! })}><GitBranch /> Create branch "{p.newConcept.name}"</button>}
        <button className={`btn btn--sm${mode === 'move' ? ' btn--ghost' : ''}`} disabled={act.busy} onClick={() => setMode(mode === 'move' ? 'none' : 'move')}><FolderInput /> File under…</button>
        <button className={`btn btn--sm${mode === 'create' ? ' btn--ghost' : ''}`} disabled={act.busy} onClick={() => setMode(mode === 'create' ? 'none' : 'create')}><GitBranch /> New branch…</button>
        <button className="btn btn--sm btn--danger" disabled={act.busy} onClick={() => act.run({ action: 'discard' })}><Trash2 /> Discard</button>
      </div>
      {mode === 'move' && (
        <div className="col gap-6">
          <ConceptPicker concepts={concepts} value={target} onChange={setTarget} />
          <div className="row gap-6"><button className="btn btn--sm btn--primary" disabled={act.busy || !target} onClick={() => target && act.run({ action: 'move', conceptSlug: target })}><FolderInput /> File here</button><span className="tiny faint">{target ?? 'pick a branch'}</span></div>
        </div>
      )}
      {mode === 'create' && (
        <form className="col gap-6" onSubmit={(e) => { e.preventDefault(); const a = createAction(); if (a) act.run(a); }} data-testid="new-branch-form">
          <div className="row gap-6 row--wrap">
            <input className="input input--sm" placeholder="Branch name (e.g. a brand)" value={newName} onChange={(e) => setNewName(e.target.value)} required aria-label="New branch name" />
            <select className="select select--sm" value={newKind} onChange={(e) => setNewKind(e.target.value as ValueKind)} aria-label="Value kind">
              {(Object.keys(VALUE_KIND_LABEL) as ValueKind[]).map((k) => <option key={k} value={k}>{VALUE_KIND_LABEL[k]}</option>)}
            </select>
            {(newKind === 'continuous' || newKind === 'float') && <input className="input input--sm" style={{ width: 90 }} placeholder="Unit (°C, bpm…)" value={newUnit} onChange={(e) => setNewUnit(e.target.value)} aria-label="Unit" />}
          </div>
          <div className="tiny faint">Parent branch{newParent ? `: ${newParent}${parentIsLeaf ? ' (creates a sub-branch of this variable)' : ' (creates a new variable in this group)'}` : ' — pick a group (new variable) or a variable (new sub-branch) below'}</div>
          <ConceptPicker concepts={[...groups, ...concepts]} value={newParent} onChange={setNewParent} />
          <div><button className="btn btn--sm btn--primary" type="submit" disabled={act.busy || !newName.trim() || !newParent}><GitBranch /> Create branch</button></div>
        </form>
      )}
    </div>
  );
}

export function IngestTable({ items, threshold, concepts, groups, onReviewed }: { items: IngestItem[]; threshold: number; concepts: ConceptOption[]; groups?: ConceptOption[]; onReviewed?: (r: ReviewResult) => void }) {
  const [open, setOpen] = useState<number | null>(null);
  if (items.length === 0) return <div className="rail__empty">Nothing here yet.</div>;
  return (
    <div className="table-wrap">
      <table className="table table--compact table--inbox">
        <thead><tr><th>Item</th><th>Status</th><th>Proposed branch</th><th className="num">Confidence</th><th className="num">Reward</th><th>When</th></tr></thead>
        <tbody>
          {items.map((it) => {
            const p = it.proposal;
            const reviewable = it.status === 'needs_review' || it.status === 'queued';
            const isOpen = open === it.id;
            return [
              <tr key={it.id} className={`${reviewable ? 'row--click' : ''}${isOpen ? ' row--open' : ''}`} onClick={reviewable ? () => setOpen(isOpen ? null : it.id) : undefined} data-testid="inbox-row" data-status={it.status}>
                <td>
                  <div className="row gap-8"><span className="list__icon">{kindIcon(it.kind, it.mime)}</span><div style={{ minWidth: 0 }}><div className="strong" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>{it.filename ?? it.text ?? it.kind}</div><div className="tiny faint">{it.kind}{it.bytes !== null ? ` · ${formatBytes(it.bytes)}` : ''}{it.mime ? ` · ${it.mime}` : ''}{it.observationCount > 0 ? ` · ${it.observationCount} obs` : ''}</div></div></div>
                </td>
                <td><Pill variant={STATUS_VARIANT[it.status]} sm>{STATUS_LABEL[it.status]}</Pill></td>
                <td>{it.conceptName && it.status !== 'needs_review' ? <ConceptPath path={p?.path?.length ? p.path : [it.conceptName]} leafOnly={!p?.path?.length} /> : p?.conceptSlug ? <ConceptPath path={p.path} /> : p?.newConcept ? <span className="row gap-4"><GitBranch style={{ width: 10, height: 10 }} /> new: {p.newConcept.name}</span> : <span className="faint">—</span>}</td>
                <td className="num">{p ? <Confidence value={p.confidence} threshold={threshold} /> : <span className="faint">—</span>}</td>
                <td className="num">{it.rewardCents > 0 ? money(it.rewardCents, { cents: true }) : <span className="faint">—</span>}</td>
                <td className="muted" style={{ whiteSpace: 'nowrap' }}>{it.relative}</td>
              </tr>,
              isOpen ? (
                <tr key={`${it.id}-review`} className="ledger-detail"><td colSpan={6}><ReviewBox item={it} concepts={concepts} groups={groups} onDone={(r) => { setOpen(null); onReviewed?.(r); }} /></td></tr>
              ) : null,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
