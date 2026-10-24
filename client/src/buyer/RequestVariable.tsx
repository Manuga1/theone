// Request additional variable (B8 → S11): concept picker or new concept, protocol, evidence requirement, target N,
// compensation, with a live estimate; submit creates a child campaign and notifies watchers.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Send } from 'lucide-react';
import type { StudyDetail, VariablePreview, VariableRequest } from '@shared/api-types';
import type { ProtocolRequirement } from '@shared/requirement';
import { api } from '../api';
import { useApi } from '../hooks';
import { useAction } from '../useAction';
import { Card, ProvenanceSelect, ErrorBox, KNum, Money, MoneyK, money } from '../components';
import { useOntologyLeaves, defaultProtocol } from './shared';

const METHODS: ProtocolRequirement['method'][] = ['device', 'protocol', 'kit', 'photo', 'survey', 'upload'];

export default function RequestVariablePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const ont = useOntologyLeaves();
  const study = useApi<StudyDetail>(id ? `/buyer/studies/${id}` : null);
  const enrichable = useMemo(() => ont.leaves.filter((l) => l.enrichable), [ont.leaves]);
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [concept, setConcept] = useState('');
  const [newName, setNewName] = useState('');
  const [parentSlug, setParentSlug] = useState('');
  const [unit, setUnit] = useState('');
  const [method, setMethod] = useState<ProtocolRequirement['method']>('protocol');
  const [durationDays, setDurationDays] = useState(1);
  const [trials, setTrials] = useState(3);
  const [device, setDevice] = useState('');
  const [minProvRank, setMinProvRank] = useState(3);
  const [targetN, setTargetN] = useState(0);
  const [compCents, setCompCents] = useState(0);
  const [preview, setPreview] = useState<VariablePreview | null>(null);
  const [err, setErr] = useState<Error | null>(null);
  const seq = useRef(0);

  const groups = useMemo(() => {
    const out: { slug: string; name: string }[] = [];
    const walk = (nodes: typeof ont.leaves, path: string) => nodes.forEach((n) => { if (n.level === 'group') out.push({ slug: n.slug, name: `${path} › ${n.name}` }); if (n.children.length) walk(n.children, n.level === 'domain' ? n.name : `${path} › ${n.name}`); });
    if (ont.data) walk(ont.data.domains, '');
    return out.map((g) => ({ ...g, name: g.name.replace(/^ › /, '') }));
  }, [ont.data, ont.leaves]);

  // Variables the study already collects or reuses (coverage rows + root/child campaign variables when served).
  const collected = useMemo(() => {
    const set = new Set<string>();
    type Loose = Omit<StudyDetail, 'campaigns'> & { campaigns?: { variables?: { conceptSlug: string }[] }[] };
    const d = study.data as Loose | null;
    d?.coverage.forEach((c) => set.add(c.slug));
    d?.campaigns?.forEach((cp) => cp.variables?.forEach((v) => set.add(v.conceptSlug)));
    return set;
  }, [study.data]);
  // Default = first enrichable concept the study does not already hold (e.g. Gut microbiome); never one it collects.
  // Waits for the study (or its error) so the default is not chosen before coverage is known.
  useEffect(() => {
    if (concept || !enrichable.length || (study.loading && !study.data && !study.error)) return;
    const pick = enrichable.find((l) => !collected.has(l.slug)) ?? enrichable[0];
    setConcept(pick.slug);
  }, [enrichable, concept, collected, study.loading, study.data, study.error]);
  useEffect(() => {
    const leaf = ont.bySlug.get(concept);
    if (!leaf || mode !== 'existing') return;
    const p = defaultProtocol(leaf, 3);
    setMethod(p.method);
    setDurationDays(p.durationDays);
    setCompCents(leaf.compCents ?? 0);
    setMinProvRank(p.minProvRank);
  }, [concept, mode, ont.bySlug]);
  useEffect(() => {
    if (!parentSlug && groups.length) setParentSlug(groups[0].slug);
  }, [groups, parentSlug]);
  // Default target N: the parent study's target (a stored value, not a literal).
  useEffect(() => {
    if (targetN === 0 && study.data && study.data.targetN > 0) setTargetN(study.data.targetN);
  }, [study.data, targetN]);

  const conceptParam = mode === 'existing' ? concept : newName.trim() ? `new:${newName.trim()}` : '';
  useEffect(() => {
    if (!id || !conceptParam || targetN <= 0) return;
    const mine = ++seq.current;
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ concept: conceptParam, durationDays: String(durationDays), minProvRank: String(minProvRank), targetN: String(targetN), compCents: String(compCents) });
      api.get<VariablePreview>(`/buyer/studies/${id}/variables/preview?${qs}`)
        .then((p) => { if (mine === seq.current) { setPreview(p); setErr(null); } })
        .catch((e: Error) => { if (mine === seq.current) setErr(e); });
    }, 300);
    return () => clearTimeout(t);
  }, [id, conceptParam, durationDays, minProvRank, targetN, compCents]);

  const submit = useAction(async () => {
    const body: VariableRequest = {
      concept: mode === 'existing' ? concept : { name: newName.trim(), parentSlug, unit: unit || undefined, method },
      protocol: { method, durationDays, trials: method === 'protocol' ? trials : undefined, device: device || undefined },
      minProvRank,
      targetN,
      compCents,
    };
    await api.post(`/buyer/studies/${id}/variables`, body);
    navigate(`/b/studies/${id}`);
  }, { success: 'Variable requested — child campaign created and watchers notified', errorPrefix: 'Request failed' });

  const leaf = ont.bySlug.get(concept);
  return (
    <div className="col gap-16">
      <div className="page-head--row" style={{ marginBottom: 0 }}>
        <div>
          <div className="breadcrumb"><Link to="/b/studies">My Studies</Link><span>›</span><Link to={`/b/studies/${id}`}>{study.data?.name ?? `Study #${id}`}</Link></div>
          <h1 className="h1">Request additional variable</h1>
          <div className="sub">Define what to collect and from whom. Participants who asked to be notified about this variable are told first.</div>
        </div>
      </div>
      <div className="grid gap-16" style={{ gridTemplateColumns: 'minmax(0, 1fr) 400px' }}>
        <Card title="Variable">
          {ont.error && <ErrorBox error={ont.error} />}
          <div className="tabs mb-12"><button className={`tab${mode === 'existing' ? ' tab--active' : ''}`} onClick={() => setMode('existing')}>Existing concept</button><button className={`tab${mode === 'new' ? ' tab--active' : ''}`} onClick={() => setMode('new')}>New concept</button></div>
          {mode === 'existing' ? (
            <div className="form-grid">
              <span className="l">Concept</span>
              <select className="select" value={concept} onChange={(e) => setConcept(e.target.value)}>
                {enrichable.map((l) => <option key={l.slug} value={l.slug}>{l.name} — {l.slug.split('.').slice(0, 2).join(' › ')}{collected.has(l.slug) ? ' (already in study)' : ''}</option>)}
                {ont.leaves.filter((l) => !l.enrichable).map((l) => <option key={l.slug} value={l.slug}>{l.name} (no standard protocol)</option>)}
              </select>
              {leaf && <><span className="l">Default</span><span className="small muted">{leaf.collectionMethod ?? '—'} · comp {money(leaf.compCents ?? 0)} · device {money(leaf.deviceCostCents ?? 0)}{leaf.unit ? ` · ${leaf.unit}` : ''}</span></>}
            </div>
          ) : (
            <div className="form-grid">
              <span className="l">Name</span><input className="input" placeholder="e.g. Gut microbiome (16S)" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <span className="l">Parent group</span><select className="select" value={parentSlug} onChange={(e) => setParentSlug(e.target.value)}>{groups.map((g) => <option key={g.slug} value={g.slug}>{g.name}</option>)}</select>
              <span className="l">Unit</span><input className="input" placeholder="optional" value={unit} onChange={(e) => setUnit(e.target.value)} />
            </div>
          )}
          <div className="divider" />
          <div className="section-title">Protocol</div>
          <div className="form-grid">
            <span className="l">Method</span><select className="select" value={method} onChange={(e) => setMethod(e.target.value as ProtocolRequirement['method'])}>{METHODS.map((m) => <option key={m} value={m}>{m}</option>)}</select>
            <span className="l">Duration</span><span className="row gap-6"><input className="input input--inline" type="number" min={1} value={durationDays} onChange={(e) => setDurationDays(Math.max(1, Number(e.target.value)))} /><span className="small muted">days</span></span>
            {method === 'protocol' && <><span className="l">Trials</span><input className="input input--inline" type="number" min={1} value={trials} onChange={(e) => setTrials(Math.max(1, Number(e.target.value)))} /></>}
            {(method === 'device' || method === 'protocol' || method === 'kit') && <><span className="l">Device / kit</span><input className="input" placeholder="e.g. Jamar dynamometer" value={device} onChange={(e) => setDevice(e.target.value)} /></>}
            <span className="l">Evidence</span><ProvenanceSelect value={minProvRank} onChange={setMinProvRank} />
          </div>
          <div className="divider" />
          <div className="section-title">Recruitment</div>
          <div className="form-grid">
            <span className="l">Target N</span><input className="input input--inline" type="number" min={1} step={10} value={targetN || ''} onChange={(e) => setTargetN(Math.max(0, Number(e.target.value)))} />
            <span className="l">Compensation</span><span className="row gap-6"><span className="small muted">$</span><input className="input input--inline" type="number" min={0} step={5} value={Math.round(compCents / 100)} onChange={(e) => setCompCents(Math.max(0, Math.round(Number(e.target.value) * 100)))} /><span className="small muted">net per participant</span></span>
          </div>
        </Card>
        <div className="col gap-16">
          <Card title="Live estimate" sub={preview ? `${preview.conceptName}${preview.isNewConcept ? ' (new concept)' : ''}` : 'Enter a variable to estimate'}>
            {err && <ErrorBox error={err} />}
            {preview && (
              <div className="estimate-rows">
                <div><span>Members missing it</span><span className="v"><KNum n={preview.missingN} /></span></div>
                <div><span>Recruitable</span><span className="v"><KNum n={preview.recruitableN} /></span></div>
                <div><span>Participants to contact</span><span className="v"><KNum n={preview.estimate.contacts} /></span></div>
                <div><span>Expected acceptance</span><span className="v"><KNum n={preview.estimate.accepted} /></span></div>
                <div><span>Expected completion</span><span className="v"><KNum n={preview.estimate.completed} /></span></div>
                {preview.estimate.costLines.map((l) => <div key={l.key}><span>{l.label}</span><span className="v"><MoneyK cents={l.cents} /></span></div>)}
                <div><span className="strong">Total</span><span className="v v--total"><Money cents={preview.estimate.totalCents} /></span></div>
                <div><span>Timeline</span><span className="v">{preview.estimate.weeksLow}–{preview.estimate.weeksHigh} weeks</span></div>
              </div>
            )}
            <button className="btn btn--primary btn--block mt-12" disabled={submit.busy || !conceptParam || targetN <= 0} onClick={() => submit.run()}><Send /> Request variable</button>
          </Card>
          <Card title="What happens next" soft>
            <div className="why">
              <p>A child campaign is created over study members and matching participants lacking the variable. Each receives an opportunity; participants watching this variable are notified and their node flips from missing to opportunity. Verified contributions extend their license and the dataset is re-versioned.</p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
