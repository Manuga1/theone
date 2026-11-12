// P5 Add / Connect Data: upload dropzone + camera, the ingestion inbox (queue table, Needs review tab with
// Create branch / File under / Discard), integration cards with health, last sync and error (Apple Health: import
// export.xml read client-side and posted as text), and the missing dimensions with actions.
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Link as LinkIcon, Unplug, Bell, BellRing, Plus, HeartPulse, FlaskConical, Watch, Dna, Image, Utensils, Activity, ClipboardList, Database, Check, Smartphone, FileUp, AlertCircle, Bot, ListChecks, RefreshCw } from 'lucide-react';
import type { ParticipantSources, SourceCard, MissingDimension, IngestQueue, AppleHealthImportResult, DemoState } from '@shared/api-types';
import { useApi } from '../hooks';
import { api, ApiRequestError } from '../api';
import { useAction } from '../useAction';
import { pushToast } from '../toast';
import { useConcepts } from '../useConcepts';
import { Card, Pill, Tabs, ErrorBox, leafIcon, UploadDropzone, IngestTable, Num, DemoOnlyHint } from '../components';
import { formatBytes } from '../digest';

const KIND_STYLE: Record<string, { icon: typeof HeartPulse; color: string }> = {
  ehr: { icon: HeartPulse, color: '#d64545' },
  lab: { icon: FlaskConical, color: '#1397a8' },
  wearable: { icon: Watch, color: '#1d6ef5' },
  genomics: { icon: Dna, color: '#7b55d6' },
  imaging: { icon: Image, color: '#5b6b85' },
  nutrition: { icon: Utensils, color: '#e09a1e' },
  bp_device: { icon: Activity, color: '#1a9e5c' },
  survey: { icon: ClipboardList, color: '#1559c9' },
  apple_health: { icon: Smartphone, color: '#16213a' },
  import: { icon: FileUp, color: '#5b6b85' },
};

const APPLE_XML_LIMIT = 25 * 1024 * 1024;

function isAppleHealth(s: SourceCard): boolean {
  return s.kind === 'apple_health' || /apple\s*health/i.test(`${s.label} ${s.vendor}`) || (s.importFormats ?? []).some((f) => /export\.xml/i.test(f));
}

/** "Import export.xml": the file is read in the browser and posted as text ({ xml }) — nothing is stored server-side but the parsed records. */
function AppleHealthImport({ s }: { s: SourceCard }) {
  const ref = useRef<HTMLInputElement>(null);
  const act = useAction(async (file: File) => {
    if (file.size > APPLE_XML_LIMIT) throw new Error(`export.xml is ${formatBytes(file.size)}; this demo imports files up to ${formatBytes(APPLE_XML_LIMIT)}.`);
    const xml = await file.text();
    const r = await api.post<AppleHealthImportResult>('/participant/import/apple-health', { xml });
    const by = r.byConcept.slice(0, 4).map((c) => `${c.conceptName} ${c.n}`).join(', ');
    pushToast('success', `Apple Health: ${r.imported} of ${r.records} records imported${r.skipped > 0 ? ` (${r.skipped} duplicates skipped)` : ''}${by ? ` · ${by}` : ''}`);
    return r;
  }, { errorPrefix: `${s.label} import` });
  return (
    <>
      <input ref={ref} type="file" accept=".xml,text/xml,application/xml" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) act.run(f); e.target.value = ''; }} data-testid="apple-health-input" />
      <button className="btn btn--sm btn--primary" disabled={act.busy} onClick={() => ref.current?.click()} title="Export from the Health app (Profile → Export All Health Data) and pick export.xml"><FileUp /> {act.busy ? 'Importing…' : 'Import export.xml'}</button>
    </>
  );
}

function SourceTile({ s }: { s: SourceCard }) {
  const st = KIND_STYLE[s.kind] ?? KIND_STYLE[s.kindGroup ?? ''] ?? { icon: Database, color: '#5b6b85' };
  const Icon = st.icon;
  const connected = s.status === 'connected';
  const apple = isAppleHealth(s);
  const act = useAction(async () => api.post(`/participant/sources/${s.id}/${connected ? 'disconnect' : 'connect'}`), { success: connected ? `${s.label} disconnected` : `${s.label} connected` });
  const health = s.health ?? (connected ? (s.lastSyncAt ? 'ok' : 'never_synced') : undefined);
  return (
    <Card tight className="source-card">
      <div className="source-card__top">
        <span className="source-card__icon" style={{ background: st.color }}><Icon /></span>
        <div style={{ minWidth: 0 }}>
          <div className="source-card__name">{s.label}</div>
          <div className="source-card__action">{connected ? s.vendor : <><LinkIcon size={10} /> {s.actionLabel}</>}</div>
        </div>
      </div>
      <div className="source-card__meta">
        {connected ? <Pill variant={s.verified ? 'verified' : 'partial'} sm icon>{s.verified ? 'Verified' : 'Unverified'}</Pill> : s.status === 'disconnected' ? <Pill variant="missing" sm>Disconnected</Pill> : <Pill variant="neutral" sm>Not connected</Pill>}
        {connected && health === 'ok' && <span className="source-card__health" style={{ color: 'var(--green)' }}><RefreshCw size={10} /> {s.lastSyncRelative ? `synced ${s.lastSyncRelative}` : 'healthy'}</span>}
        {connected && health === 'needs_attention' && <span className="source-card__health" style={{ color: 'var(--amber)' }}><AlertCircle size={10} /> needs attention{s.lastSyncRelative ? ` · last sync ${s.lastSyncRelative}` : ''}</span>}
        {connected && health === 'never_synced' && <span className="source-card__health faint"><AlertCircle size={10} /> never synced</span>}
      </div>
      {s.errorText && <div className="source-card__err">{s.errorText}</div>}
      {apple && <div className="tiny faint">Apple Health needs a native app for live sync; import the export file for now{s.importFormats?.length ? ` (${s.importFormats.join(', ')})` : ''}.</div>}
      {apple && <DemoOnlyHint />}
      <div className="source-card__foot">
        <span className="tiny faint">{connected && s.connectedAt ? `since ${s.connectedAt}` : s.vendor}</span>
        {apple ? <AppleHealthImport s={s} /> : (
          <button className={`btn btn--sm${connected ? '' : ' btn--primary'}`} disabled={act.busy} onClick={() => act.run()}>
            {connected ? <><Unplug /> Disconnect</> : <><LinkIcon /> Connect</>}
          </button>
        )}
      </div>
    </Card>
  );
}

function SelfReportForm({ m, onDone }: { m: MissingDimension; onDone: () => void }) {
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState('');
  const [note, setNote] = useState('');
  const act = useAction(async () => {
    const num = Number(value);
    await api.post(`/participant/missing/${m.slug}/self-report`, { value: value !== '' && Number.isFinite(num) ? num : value, unit: unit || undefined, note: note || undefined });
    onDone();
  }, { success: `${m.name} recorded as self-report (partial until verified)` });
  return (
    <form className="row gap-6 row--wrap" onSubmit={(e) => { e.preventDefault(); act.run(); }}>
      <input className="input input--sm" placeholder="Value" value={value} onChange={(e) => setValue(e.target.value)} style={{ width: 110 }} required />
      <input className="input input--sm" placeholder="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} style={{ width: 70 }} />
      <input className="input input--sm" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} style={{ width: 150 }} />
      <button className="btn btn--sm btn--primary" type="submit" disabled={act.busy || !value}><Check /> Save</button>
      <button className="btn btn--sm btn--ghost" type="button" onClick={onDone}>Cancel</button>
    </form>
  );
}

function MissingRow({ m }: { m: MissingDimension }) {
  const [adding, setAdding] = useState(false);
  const Icon = leafIcon(m.slug);
  const notify = useAction(async () => api.post(`/participant/missing/${m.slug}/notify`), { success: `We will notify you when a study requests ${m.name}` });
  return (
    <div className="missing-row">
      <span className="missing-row__icon"><Icon /></span>
      <div>
        <div className="missing-row__name">{m.name}</div>
        <Pill variant={m.state} sm icon />
      </div>
      <div className="row gap-6">
        {m.action === 'see_opportunities' && <Link className="btn btn--sm btn--primary" to={m.opportunityId ? `/p/opportunities/${m.opportunityId}` : '/p/opportunities'}>See opportunities</Link>}
        {m.action === 'notify' && <button className="btn btn--sm" disabled={notify.busy} onClick={() => notify.run()}><Bell /> Notify me</button>}
        {m.action === 'watching' && <span className="pill pill--accent"><BellRing style={{ width: 10, height: 10 }} /> Watching</span>}
        {m.action === 'add_data' && !adding && <button className="btn btn--sm" onClick={() => setAdding(true)}><Plus /> Add data</button>}
        {m.action === 'add_data' && adding && <SelfReportForm m={m} onDone={() => setAdding(false)} />}
      </div>
    </div>
  );
}

type InboxTab = 'all' | 'needs_review' | 'auto_filed' | 'accepted' | 'discarded';

function Inbox() {
  // The ingestion routes exist only on servers that report a classifier in /demo/state; older servers would answer 404,
  // which the browser logs as a console error (the e2e screens assert there are none), so the fetch is gated on it.
  const state = useApi<DemoState>('/demo/state');
  const served = state.data ? state.data.classifier !== undefined : null;
  const q = useApi<IngestQueue>(served ? '/participant/ingest' : null);
  const { concepts, groups } = useConcepts();
  const [tab, setTab] = useState<InboxTab>('all');
  const d = q.data;
  const unserved = q.error instanceof ApiRequestError && (q.error.status === 404 || q.error.status === 503);
  const counts = d?.counts;
  const items = (d?.items ?? []).filter((it) => tab === 'all' || it.status === tab || (tab === 'needs_review' && it.status === 'queued'));
  const tabs: { key: InboxTab; label: string; count?: number }[] = [
    { key: 'all', label: 'All', count: d ? d.items.length : undefined },
    { key: 'needs_review', label: 'Needs review', count: counts ? counts.needs_review + counts.queued : undefined },
    { key: 'auto_filed', label: 'Auto-filed', count: counts?.auto_filed },
    { key: 'accepted', label: 'Accepted', count: counts?.accepted },
    { key: 'discarded', label: 'Discarded', count: counts?.discarded },
  ];
  return (
    <Card
      title="Ingestion inbox"
      sub={d ? <>Classified by <strong>{d.classifier === 'claude' ? 'Claude' : 'rules'}</strong> · auto-filed at ≥ {Math.round(d.reviewThreshold * 100)}% confidence · new branches always wait for you</> : 'Uploads, quick logs and check-ins, and where they were filed.'}
      right={d ? <span className="classified">{d.classifier === 'claude' ? <Bot /> : <ListChecks />} {d.classifier}</span> : null}
    >
      <div className="col gap-12">
        <UploadDropzone maxFileBytes={d?.maxFileBytes ?? null} acceptedTypes={d?.acceptedTypes} />
        {(served === false || (q.error && unserved)) && <div className="callout callout--amber">The ingestion inbox is not served by this API yet (<code>/api/participant/ingest</code>{q.error instanceof ApiRequestError ? ` → ${q.error.status}` : ''}). Uploads will queue once it is.</div>}
        {q.error && !unserved && <ErrorBox error={q.error} />}
        {d && (
          <>
            <div className="inbox-tabs">
              <Tabs value={tab} onChange={setTab} items={tabs.map((t) => ({ key: t.key, label: t.label, count: t.count }))} />
              <span className="tiny faint">Files are not stored — only name, size, type and a fingerprint. Max {formatBytes(d.maxFileBytes)} per file.</span>
            </div>
            <IngestTable items={items} threshold={d.reviewThreshold} concepts={concepts} groups={groups} />
            {tab === 'needs_review' && items.length === 0 && <div className="tiny faint">Nothing waiting. Items land here when the classifier is below the threshold or proposes a branch that does not exist yet.</div>}
          </>
        )}
        {!d && !q.error && served !== false && <div className="faint small">Loading inbox…</div>}
      </div>
    </Card>
  );
}

export default function SourcesPage() {
  const q = useApi<ParticipantSources>('/participant/sources');
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data;
  const connected = d?.sources.filter((s) => s.status === 'connected').length ?? 0;
  const attention = d?.sources.filter((s) => s.status === 'connected' && s.health === 'needs_attention').length ?? 0;
  return (
    <div className="col gap-16">
      <div className="page-head--row" style={{ marginBottom: 0 }}>
        <div><h1 className="h1">Grow Your Health Asset</h1><div className="sub">Upload a folder, snap a photo, speak a note or connect a source — the graph files everything in the right branch.</div></div>
        {d && <span className="row gap-6"><span className="pill pill--verified">{connected} of {d.sources.length} connected</span>{attention > 0 && <span className="pill pill--partial"><AlertCircle style={{ width: 10, height: 10 }} /> <Num n={attention} /> need attention</span>}</span>}
      </div>
      <Inbox />
      <h2 className="h2">Integrations</h2>
      <div className="grid grid--4">
        {(d?.sources ?? []).map((s) => <SourceTile key={s.id} s={s} />)}
        {d && d.sources.length === 0 && <div className="rail__empty">No sources available.</div>}
      </div>
      <div className="grid gap-16 grid--main-aside-360">
        <Card title="Missing dimensions" sub="Adding these could make your profile more complete.">
          {(d?.missing ?? []).map((m) => <MissingRow key={m.slug} m={m} />)}
          {d && d.missing.length === 0 && <div className="rail__empty">Nothing missing — your signature is complete.</div>}
        </Card>
        <Card title="What connecting does" soft>
          <div className="why">
            <p>Connecting a source imports verified observations and keeps them synced. Disconnecting stops new data and soft-deletes what that source contributed; datasets already licensed keep their rows until the term ends.</p>
            <p><strong>Uploads</strong> are classified into existing branches (lab PDF → labs, DICOM → imaging, meal photo → food log, device CSV → the matching variable). Anything new or uncertain waits in the inbox, where you can accept, file it elsewhere, create a branch or discard it.</p>
            <p><strong>Notify me</strong> adds a watch: when a study requests that variable, the node flips to an opportunity and you are told first. <strong>Add data</strong> records a self-report, which counts as partial until a verified source confirms it.</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
