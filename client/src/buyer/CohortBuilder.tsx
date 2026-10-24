// B2 Cohort Builder: criteria form (Demographics / Clinical / Genomics / Longitudinal / Physiology / Behavior) with a live
// preview (POST cohorts/preview, debounced 300 ms) and Save cohort. /b/cohorts/:id/define loads a saved cohort.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Save, Users, Stethoscope, Dna, Clock, HeartPulse, Footprints, Repeat } from 'lucide-react';
import type { CohortPreview, SavedCohortDetail } from '@shared/api-types';
import { DEFAULT_CRITERIA, type CohortCriteria } from '@shared/criteria';
import { api } from '../api';
import { useApi } from '../hooks';
import { useAction } from '../useAction';
import { Card, Funnel, ProvenanceSelect, KNum, ErrorBox } from '../components';
import { CohortStepBar, useOntologyLeaves, BlockedBanner } from './shared';

type Modality = CohortCriteria['modalities'][number];

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="form-section">
      <div className="form-section__title"><span className="list__icon">{icon}</span>{title}</div>
      {children}
    </div>
  );
}

function ModalityRow({ slug, label, criteria, setCriteria, unit, step, defaultSpan, defaultRank }: { slug: string; label: string; criteria: CohortCriteria; setCriteria: (c: CohortCriteria) => void; unit: 'years' | 'months' | 'days'; step: number; defaultSpan: number; defaultRank: number }) {
  const m = criteria.modalities.find((x) => x.slug === slug);
  const factor = unit === 'years' ? 365 : unit === 'months' ? 30 : 1;
  const set = (next: Modality | null) => setCriteria({ ...criteria, modalities: next ? [...criteria.modalities.filter((x) => x.slug !== slug), next].sort((a, b) => a.slug.localeCompare(b.slug)) : criteria.modalities.filter((x) => x.slug !== slug) });
  return (
    <div className="row gap-8 row--wrap" style={{ minHeight: 28 }}>
      <label className="check" style={{ width: 150 }}>
        <input type="checkbox" checked={!!m} onChange={(e) => set(e.target.checked ? { slug, minSpanDays: defaultSpan, minProvRank: defaultRank } : null)} />
        {label}
      </label>
      {m && (
        <>
          <span className="small muted">≥</span>
          <input className="input input--sm input--inline" type="number" min={0} step={step} value={Math.round(m.minSpanDays / factor)} onChange={(e) => set({ ...m, minSpanDays: Math.max(0, Number(e.target.value)) * factor })} />
          <span className="small muted">{unit}</span>
          <ProvenanceSelect small value={m.minProvRank} onChange={(rank) => set({ ...m, minProvRank: rank })} />
        </>
      )}
    </div>
  );
}

export default function CohortBuilderPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const saved = useApi<SavedCohortDetail>(id ? `/buyer/cohorts/${id}` : null);
  const ont = useOntologyLeaves();
  const [criteria, setCriteria] = useState<CohortCriteria>(DEFAULT_CRITERIA);
  const [name, setName] = useState('');
  const [preview, setPreview] = useState<CohortPreview | null>(null);
  const [previewError, setPreviewError] = useState<Error | null>(null);
  const [pending, setPending] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (saved.data) {
      setCriteria(saved.data.criteria);
      setName(saved.data.name);
    }
  }, [saved.data]);
  // Pre-tick a modality when arriving from search (?concept=slug).
  useEffect(() => {
    const c = params.get('concept');
    if (c && !criteria.modalities.some((m) => m.slug === c)) setCriteria((cr) => ({ ...cr, modalities: [...cr.modalities, { slug: c, minSpanDays: 0, minProvRank: 2 }] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  // Live preview, debounced 300 ms; stale responses are dropped.
  useEffect(() => {
    setPending(true);
    const mine = ++seq.current;
    const t = setTimeout(() => {
      api.query<CohortPreview>('/buyer/cohorts/preview', criteria)
        .then((p) => { if (mine === seq.current) { setPreview(p); setPreviewError(null); } })
        .catch((e: Error) => { if (mine === seq.current) setPreviewError(e); })
        .finally(() => { if (mine === seq.current) setPending(false); });
    }, 300);
    return () => clearTimeout(t);
  }, [criteria]);

  const save = useAction(async () => {
    const r = await api.post<SavedCohortDetail>('/buyer/cohorts', { name: name || criteria.purpose.slice(0, 60), criteria });
    navigate(`/b/cohorts/${r.id}/funnel`);
  }, { success: 'Cohort saved' });

  const conditions = useMemo(() => ont.leaves.filter((l) => l.slug.startsWith('clinical.diagnoses.') && l.slug !== 'clinical.diagnoses.problem_list'), [ont.leaves]);
  const labs = useMemo(() => ont.leaves.filter((l) => l.slug.startsWith('clinical.labs.')), [ont.leaves]);
  const demo = criteria.demographics;
  const setDemo = (patch: Partial<CohortCriteria['demographics']>) => setCriteria({ ...criteria, demographics: { ...demo, ...patch } });
  const toggleCondition = (slug: string, on: boolean) => setCriteria({ ...criteria, conditions: on ? [...criteria.conditions, slug] : criteria.conditions.filter((c) => c !== slug) });
  const lab = criteria.labs[0];

  if (saved.error) return <ErrorBox error={saved.error} />;
  return (
    <div className="col gap-16">
      <div className="page-head--row" style={{ marginBottom: 0 }}>
        <div><h1 className="h1">{id ? saved.data?.name ?? 'Cohort' : 'Cohort Builder'}</h1><div className="sub">Define your population; the match preview updates as you type.</div></div>
        <CohortStepBar id={id} active="define" />
      </div>
      <div className="grid gap-16" style={{ gridTemplateColumns: 'minmax(0, 1fr) 400px' }}>
        <Card title="Define population">
          <label className="field mb-12"><span className="field__label">Research purpose</span><input className="input" value={criteria.purpose} onChange={(e) => setCriteria({ ...criteria, purpose: e.target.value })} /></label>
          <Section icon={<Users />} title="Demographics">
            <div className="form-grid">
              <span className="l">Age</span>
              <span className="row gap-6"><input className="input input--sm input--inline" type="number" value={demo.ageMin ?? ''} placeholder="min" onChange={(e) => setDemo({ ageMin: e.target.value === '' ? undefined : Number(e.target.value) })} /><span className="muted">–</span><input className="input input--sm input--inline" type="number" value={demo.ageMax ?? ''} placeholder="max" onChange={(e) => setDemo({ ageMax: e.target.value === '' ? undefined : Number(e.target.value) })} /></span>
              <span className="l">Sex</span>
              <select className="select select--sm" style={{ width: 160 }} value={demo.sex} onChange={(e) => setDemo({ sex: e.target.value as 'any' | 'female' | 'male' })}><option value="any">Any</option><option value="female">Female</option><option value="male">Male</option></select>
              <span className="l">Region</span>
              <select className="select select--sm" style={{ width: 160 }} value={demo.country ?? ''} onChange={(e) => setDemo({ country: e.target.value || undefined })}><option value="">Any country</option><option value="US">United States</option><option value="GB">United Kingdom</option><option value="DE">Germany</option><option value="CA">Canada</option></select>
            </div>
          </Section>
          <Section icon={<Stethoscope />} title="Clinical">
            <div className="grid grid--3" style={{ gap: 4 }}>
              {(conditions.length ? conditions : criteria.conditions.map((c) => ({ slug: c, name: c.split('.').pop()!.replace(/_/g, ' ') }))).map((c) => (
                <label className="check" key={c.slug}><input type="checkbox" checked={criteria.conditions.includes(c.slug)} onChange={(e) => toggleCondition(c.slug, e.target.checked)} />{c.name}</label>
              ))}
            </div>
            <div className="row gap-6 row--wrap mt-8">
              <label className="check"><input type="checkbox" checked={!!lab} onChange={(e) => setCriteria({ ...criteria, labs: e.target.checked ? [{ slug: labs[0]?.slug ?? 'clinical.labs.hba1c', op: '>', value: 7 }] : [] })} />Lab threshold</label>
              {lab && (
                <>
                  <select className="select select--sm" value={lab.slug} onChange={(e) => setCriteria({ ...criteria, labs: [{ ...lab, slug: e.target.value }] })}>{(labs.length ? labs : [{ slug: lab.slug, name: lab.slug }]).map((l) => <option key={l.slug} value={l.slug}>{l.name}</option>)}</select>
                  <select className="select select--sm" value={lab.op} onChange={(e) => setCriteria({ ...criteria, labs: [{ ...lab, op: e.target.value as typeof lab.op }] })}>{['>', '>=', '<', '<='].map((o) => <option key={o}>{o}</option>)}</select>
                  <input className="input input--sm input--inline" type="number" step={0.1} value={lab.value} onChange={(e) => setCriteria({ ...criteria, labs: [{ ...lab, value: Number(e.target.value) }] })} />
                  <span className="small muted">%</span>
                </>
              )}
            </div>
          </Section>
          <Section icon={<Dna />} title="Genomics"><ModalityRow slug="biology.genomics.exome" label="Exome required" criteria={criteria} setCriteria={setCriteria} unit="days" step={1} defaultSpan={0} defaultRank={3} /></Section>
          <Section icon={<Clock />} title="Longitudinal requirements"><ModalityRow slug="clinical.encounters.ehr_history" label="EHR history" criteria={criteria} setCriteria={setCriteria} unit="years" step={1} defaultSpan={365 * 3} defaultRank={4} /></Section>
          <Section icon={<HeartPulse />} title="Physiology">
            <ModalityRow slug="physiology.cardiovascular.blood_pressure" label="Blood pressure" criteria={criteria} setCriteria={setCriteria} unit="months" step={1} defaultSpan={365} defaultRank={3} />
            <ModalityRow slug="physiology.metabolic.cgm" label="CGM" criteria={criteria} setCriteria={setCriteria} unit="days" step={1} defaultSpan={14} defaultRank={3} />
          </Section>
          <Section icon={<Footprints />} title="Behavior"><ModalityRow slug="behavior.nutrition.food_log" label="Nutrition log" criteria={criteria} setCriteria={setCriteria} unit="days" step={1} defaultSpan={30} defaultRank={2} /></Section>
          <Section icon={<Repeat />} title="Consent">
            <label className="check"><input type="checkbox" checked={criteria.requireRecontact} onChange={(e) => setCriteria({ ...criteria, requireRecontact: e.target.checked })} />Require recontact opt-in (collection campaigns)</label>
          </Section>
        </Card>
        <div className="col gap-16 sticky-aside" style={{ alignSelf: 'start' }}>
          <Card title="Population match" sub={preview ? `${pending ? 'updating…' : `computed in ${Math.round(preview.timingMs)} ms`}` : 'Computing…'} right={preview ? <span className="big-num" style={{ fontSize: 20 }}><KNum n={preview.readyNow} /></span> : null}>
            {previewError && <ErrorBox error={previewError} />}
            {preview && <BlockedBanner consent={preview.consent} />}
            {preview ? <Funnel stages={preview.funnel} readyNow={preview.readyNow} maxWidth={340} minPct={64} /> : <div className="faint small">Loading…</div>}
          </Card>
          <Card title="Save cohort">
            <label className="field mb-8"><span className="field__label">Cohort name</span><input className="input" placeholder="e.g. Type 2 diabetes + hypertension" value={name} onChange={(e) => setName(e.target.value)} /></label>
            <button className="btn btn--primary btn--block" disabled={save.busy || !!preview?.consent.blocked} onClick={() => save.run()}><Save /> {id ? 'Save as new cohort' : 'Save cohort'} & review</button>
            {id && <div className="tiny faint mt-8">Saved cohorts are immutable; saving creates a new version.</div>}
          </Card>
        </div>
      </div>
    </div>
  );
}
