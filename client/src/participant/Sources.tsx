// P5 Add / Connect Data: 8 source cards (Connect / Disconnect simulate integrations) + missing dimensions with actions.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Link as LinkIcon, Unplug, Bell, BellRing, Plus, HeartPulse, FlaskConical, Watch, Dna, Image, Utensils, Activity, ClipboardList, Database, Check } from 'lucide-react';
import type { ParticipantSources, SourceCard, MissingDimension } from '@shared/api-types';
import { useApi } from '../hooks';
import { api } from '../api';
import { useAction } from '../useAction';
import { Card, Pill, ErrorBox, leafIcon } from '../components';

const KIND_STYLE: Record<string, { icon: typeof HeartPulse; color: string }> = {
  ehr: { icon: HeartPulse, color: '#d64545' },
  lab: { icon: FlaskConical, color: '#1397a8' },
  wearable: { icon: Watch, color: '#1d6ef5' },
  genomics: { icon: Dna, color: '#7b55d6' },
  imaging: { icon: Image, color: '#5b6b85' },
  nutrition: { icon: Utensils, color: '#e09a1e' },
  bp_device: { icon: Activity, color: '#1a9e5c' },
  survey: { icon: ClipboardList, color: '#1559c9' },
};

function SourceTile({ s }: { s: SourceCard }) {
  const st = KIND_STYLE[s.kind] ?? { icon: Database, color: '#5b6b85' };
  const Icon = st.icon;
  const connected = s.status === 'connected';
  const act = useAction(async () => api.post(`/participant/sources/${s.id}/${connected ? 'disconnect' : 'connect'}`), { success: connected ? `${s.label} disconnected` : `${s.label} connected` });
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
        {connected && s.lastSyncRelative && <span>synced {s.lastSyncRelative}</span>}
      </div>
      <div className="source-card__foot">
        <span className="tiny faint">{connected && s.connectedAt ? `since ${s.connectedAt}` : s.vendor}</span>
        <button className={`btn btn--sm${connected ? '' : ' btn--primary'}`} disabled={act.busy} onClick={() => act.run()}>
          {connected ? <><Unplug /> Disconnect</> : <><LinkIcon /> Connect</>}
        </button>
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

export default function SourcesPage() {
  const q = useApi<ParticipantSources>('/participant/sources');
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data;
  const connected = d?.sources.filter((s) => s.status === 'connected').length ?? 0;
  return (
    <div className="col gap-16">
      <div className="page-head--row" style={{ marginBottom: 0 }}>
        <div><h1 className="h1">Grow Your Health Asset</h1><div className="sub">Connect new data sources to make your profile more complete and unlock new opportunities.</div></div>
        {d && <span className="pill pill--verified">{connected} of {d.sources.length} connected</span>}
      </div>
      <div className="grid grid--4">
        {(d?.sources ?? []).map((s) => <SourceTile key={s.id} s={s} />)}
        {d && d.sources.length === 0 && <div className="rail__empty">No sources available.</div>}
      </div>
      <div className="grid gap-16" style={{ gridTemplateColumns: 'minmax(0, 1fr) 360px' }}>
        <Card title="Missing dimensions" sub="Adding these could make your profile more complete.">
          {(d?.missing ?? []).map((m) => <MissingRow key={m.slug} m={m} />)}
          {d && d.missing.length === 0 && <div className="rail__empty">Nothing missing — your signature is complete.</div>}
        </Card>
        <Card title="What connecting does" soft>
          <div className="why">
            <p>Connecting a source imports verified observations and keeps them synced. Disconnecting stops new data and soft-deletes what that source contributed; datasets already licensed keep their rows until the term ends.</p>
            <p><strong>Notify me</strong> adds a watch: when a study requests that variable, the node flips to an opportunity and you are told first.</p>
            <p><strong>Add data</strong> records a self-report, which counts as partial until a verified source confirms it.</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
