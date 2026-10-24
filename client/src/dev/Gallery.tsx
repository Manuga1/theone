// DEV-ONLY component gallery at /dev/gallery[/:section]. Renders every shared component with fixture props so it can be
// screenshotted and compared with the mockup. Fixtures live in ./fixtures.ts and are never used by product pages.
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Activity, FlaskConical, Moon, Wallet, HeartPulse, Database, ShieldCheck, Sparkles, Check, Link as LinkIcon } from 'lucide-react';
import {
  Card, StatTile, Pill, StatePill, Tabs, StatusDot, StateGlyph, ProgressBar, BarRow, EmptyState, Splash, SearchBar, ProvenanceSelect,
  RevokeDialog, StepBar, RadialSignature, ConceptTree, LazyBPChart, TimelineRail, SwimlaneStrip, LineageChain, Funnel, MissingMatrix, Heatmap,
  CoverageBars, ConsentPanel, LedgerTable, Shell, Money, Num, KNum, Pct, signed,
} from '../components';
import * as fx from './fixtures';

function Item({ title, children, width }: { title: string; children: React.ReactNode; width?: number }) {
  return (
    <div className="gallery__item" id={title.toLowerCase().replace(/\W+/g, '-')} style={width ? { width } : undefined}>
      <div className="gallery__title">{title}</div>
      {children}
    </div>
  );
}

function HomeMock() {
  return (
    <div className="grid grid--main-aside">
      <div className="col gap-16">
        <div>
          <h1 className="h1">Good afternoon, Alex</h1>
          <div className="sub">Your health data is making a difference.</div>
        </div>
        <div className="grid grid--4">
          <StatTile label="Data completeness" icon={<Activity />} value={<Pct x={74} />} delta={`${signed(6, '%')} this month`} tone="up" />
          <StatTile label="Verified sources" icon={<ShieldCheck />} iconTone="green" value={<Num n={12} />} />
          <StatTile label="Lifetime earnings" icon={<Wallet />} iconTone="purple" value={<Money cents={284217} />} />
          <StatTile label="Available opportunities" icon={<Sparkles />} iconTone="amber" value={<Num n={4} />} delta={<>Up to <Money cents={118000} /></>} tone="accent" />
        </div>
        <Card title="Your Health Signature" sub="Click any category to explore your data.">
          <RadialSignature ring={fx.ring} name="Alex Morgan" age={48} width={560} height={380} />
        </Card>
      </div>
      <div className="col gap-16">
        <Card title="What changed this week">
          <div className="list">
            {fx.activity.map((a) => (
              <div className="list__item" key={a.id}>
                <span className={`list__icon${a.amountCents ? ' list__icon--green' : ''}`}>{a.amountCents ? <Wallet /> : <Check />}</span>
                <span className="list__text">{a.text}</span>
                <span className="list__when">{a.relative}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Primitives() {
  const [tab, setTab] = useState<'available' | 'in_progress' | 'past'>('available');
  const [prov, setProv] = useState(3);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  return (
    <>
      <Item title="StatTile">
        <div className="grid grid--4">
          <StatTile label="Data completeness" icon={<Activity />} value={<Pct x={74} />} delta="+6% this month" tone="up" />
          <StatTile label="Verified sources" icon={<ShieldCheck />} iconTone="green" value={<Num n={12} />} />
          <StatTile label="Lifetime earnings" icon={<Wallet />} iconTone="purple" value={<Money cents={284217} />} />
          <StatTile label="Recontactable participants" value={<KNum n={121304} />} small />
        </div>
      </Item>
      <Item title="Pills, dots, glyphs">
        <div className="row row--wrap gap-6">
          <StatePill state="verified" /><StatePill state="partial" /><StatePill state="missing" />
          <Pill variant="opportunity" /><Pill variant="demand" icon>Requested</Pill><Pill variant="neutral">Structured</Pill><Pill variant="accent">Time series</Pill>
          <Pill variant="purple">DICOM</Pill><Pill variant="dark">Pilot</Pill><Pill variant="outline">clinical</Pill>
          <StatusDot tone="verified" /> <StatusDot tone="partial" /> <StatusDot tone="missing" /> <StatusDot tone="accent" lg />
          <StateGlyph state="verified" /> <StateGlyph state="partial" /> <StateGlyph state="missing" />
        </div>
      </Item>
      <Item title="Tabs">
        <div className="col gap-12">
          <Tabs items={[{ key: 'available', label: 'Available', count: 4 }, { key: 'in_progress', label: 'In Progress', count: 1 }, { key: 'past', label: 'Past', count: 5 }]} value={tab} onChange={setTab} />
          <Tabs variant="underline" items={[{ key: 'available', label: 'Overview' }, { key: 'in_progress', label: 'Timeline' }, { key: 'past', label: 'Data Lineage' }]} value={tab} onChange={setTab} />
          <Tabs variant="pills" items={[{ key: 'available', label: 'All' }, { key: 'in_progress', label: 'Clinical' }, { key: 'past', label: 'Labs' }]} value={tab} onChange={setTab} />
        </div>
      </Item>
      <Item title="Progress bars" width={420}>
        <div className="col gap-6">
          <ProgressBar value={74} /><ProgressBar value={96} tone="green" thick /><ProgressBar value={31} tone="amber" thin />
          <BarRow label="BP" value={96} tone="green" /><BarRow label="Nutrition" value={91} /><BarRow label="Imaging" value={12} tone="amber" />
        </div>
      </Item>
      <Item title="Search, provenance select, buttons" width={720}>
        <div className="row row--wrap gap-12">
          <SearchBar value={q} onChange={setQ} />
          <ProvenanceSelect value={prov} onChange={setProv} label="Minimum provenance" small />
          <button className="btn btn--primary">I'm interested</button>
          <button className="btn">View details</button>
          <button className="btn btn--ghost">Notify me</button>
          <button className="btn btn--danger" onClick={() => setOpen(true)}>Revoke</button>
        </div>
        <RevokeDialog open={open} licenseNumber="1842" orgName="Academic Research" studyName="Wearable sleep study" onConfirm={() => setOpen(false)} onCancel={() => setOpen(false)} />
      </Item>
      <Item title="StepBar" width={520}>
        <Card><StepBar active="enrich" /></Card>
      </Item>
      <Item title="EmptyState" width={520}>
        <EmptyState />
      </Item>
    </>
  );
}

function Participant() {
  const [sel, setSel] = useState<string | null>('physiology.cardiovascular.blood_pressure');
  return (
    <>
      <Item title="P1 Home composition" width={1040}><HomeMock /></Item>
      <Item title="RadialSignature" width={560}>
        <Card><RadialSignature ring={fx.ring} name="Alex Morgan" age={48} /></Card>
      </Item>
      <Item title="ConceptTree" width={420}>
        <Card title="Your Health Signature" sub="Click any category to explore your data, see completeness, and find opportunities.">
          <ConceptTree domains={fx.domains} selected={sel} onSelectLeaf={(n) => setSel(n.slug)} defaultOpen={['physiology']} />
        </Card>
      </Item>
      <Item title="BPChart" width={620}>
        <Card title="Blood Pressure" sub="14 months continuous data · 1,482 measurements" right={<StatePill state="verified" />}>
          <LazyBPChart series={fx.bpSeries} title="Blood Pressure" unit="mmHg" yDomain={[60, 180]} />
          <div className="grid grid--2 mt-12">
            <Card soft tight title="Source"><div className="strong">Omron BP7450</div><div className="small muted">Device connected directly</div></Card>
            <Card soft tight title="Verification"><div className="strong">Device verified</div><div className="small muted">Last synced: 1 day ago</div></Card>
          </div>
        </Card>
      </Item>
      <Item title="LineageChain" width={620}>
        <Card title="Data lineage"><LineageChain steps={fx.lineage} /></Card>
      </Item>
      <Item title="TimelineRail" width={420}>
        <Card><TimelineRail events={fx.events} /></Card>
      </Item>
      <Item title="SwimlaneStrip" width={520}>
        <Card title="Trailing 6 months"><SwimlaneStrip swimlane={fx.swimlane} /></Card>
      </Item>
      <Item title="ConsentPanel" width={720}>
        <Card title="Review & consent" sub="Metabolic Monitoring Study · Example BioPharma"><ConsentPanel consent={fx.consent} /></Card>
      </Item>
      <Item title="LedgerTable" width={1100}>
        <Card title="Asset ledger"><LedgerTable entries={fx.ledger} onRevoke={() => undefined} /></Card>
      </Item>
      <Item title="Source cards" width={520}>
        <div className="grid grid--2">
          {[['Medical Records', 'Connect MyChart', '#d64545', HeartPulse], ['Labs', 'Connect Lab', '#1397a8', FlaskConical], ['Wearables', 'Garmin', '#1d6ef5', Moon], ['Blood Pressure', 'Connect device', '#1a9e5c', Database]].map(([name, action, color, Icon]) => {
            const I = Icon as typeof HeartPulse;
            return (
              <Card key={String(name)} tight className="source-card">
                <span className="source-card__icon" style={{ background: String(color) }}><I /></span>
                <div><div className="source-card__name">{String(name)}</div><div className="source-card__action"><LinkIcon size={10} /> {String(action)}</div></div>
              </Card>
            );
          })}
        </div>
      </Item>
    </>
  );
}

function Buyer() {
  const [prov, setProv] = useState(3);
  return (
    <>
      <Item title="Funnel" width={420}>
        <Card title="Population match"><Funnel stages={fx.funnel} readyNow={fx.preview.readyNow} /></Card>
      </Item>
      <Item title="MissingMatrix" width={460}>
        <Card title="Where are the gaps?" sub="Many eligible participants are missing one or more variables.">
          <MissingMatrix matrix={fx.preview.matrix} readyNow={fx.preview.readyNow} action={<button className="btn btn--primary btn--block">Expand Cohort</button>} />
        </Card>
      </Item>
      <Item title="Heatmap + CoverageBars" width={460}>
        <Card title="Data coverage by variable" sub="Overview of data availability in your target population." right={<ProvenanceSelect value={prov} onChange={setProv} small />}>
          <Heatmap heatmap={fx.preview.heatmap} />
          <div className="divider" />
          <CoverageBars bars={fx.preview.bars} />
        </Card>
      </Item>
      <Item title="Buyer tiles" width={760}>
        <div className="grid grid--3">
          <StatTile label="Available participants" value={<KNum n={128420} />} />
          <StatTile label="Longitudinal profiles" value={<KNum n={112810} />} />
          <StatTile label="Genomics available" value={<KNum n={48921} />} />
        </div>
      </Item>
    </>
  );
}

function ShellDemo() {
  return (
    <>
      <Item title="Participant shell" width={1200}>
        <div style={{ height: 520, overflow: 'hidden', border: '1px solid var(--border)', borderRadius: 12 }}>
          <Shell side="participant" title="My Health Asset" state={fx.demoState} health={fx.health}><HomeMock /></Shell>
        </div>
      </Item>
      <Item title="Buyer shell" width={1200}>
        <div style={{ height: 420, overflow: 'hidden', border: '1px solid var(--border)', borderRadius: 12 }}>
          <Shell side="buyer" title="Research workspace" wide state={{ ...fx.demoState, persona: 'buyer:1' }} health={fx.health}>
            <div className="page-head"><h1 className="h1">Welcome back</h1><div className="sub">Research workspace</div></div>
            <div className="grid grid--3" style={{ maxWidth: 720 }}>
              <StatTile label="Available participants" value={<KNum n={128420} />} />
              <StatTile label="Longitudinal profiles" value={<KNum n={112810} />} />
              <StatTile label="Genomics available" value={<KNum n={48921} />} />
            </div>
          </Shell>
        </div>
      </Item>
      <Item title="Empty / Splash" width={1200}>
        <div style={{ height: 300, overflow: 'hidden', border: '1px solid var(--border)', borderRadius: 12 }}>
          <Shell side="participant" state={{ ...fx.demoState, seeded: false }} health={{ ...fx.health, seeded: false }}><div /></Shell>
        </div>
        <div style={{ height: 160, overflow: 'hidden', border: '1px solid var(--border)', borderRadius: 12, position: 'relative', marginTop: 12 }}>
          <div style={{ position: 'absolute', inset: 0 }}><div className="splash" style={{ position: 'absolute' }}><div className="splash__box"><div className="spinner" /><div className="h2">Preparing demo data…</div></div></div></div>
        </div>
      </Item>
    </>
  );
}

export default function Gallery() {
  const { section } = useParams();
  const show = (s: string) => !section || section === s || section === 'all';
  return (
    <div className="gallery">
      <div className="row gap-12 small">
        <strong>Component gallery (dev)</strong>
        {['primitives', 'participant', 'buyer', 'shell'].map((s) => <a key={s} href={`/dev/gallery/${s}`}>{s}</a>)}
      </div>
      {show('primitives') && <Primitives />}
      {show('participant') && <Participant />}
      {show('buyer') && <Buyer />}
      {show('shell') && <ShellDemo />}
      {!show('primitives') && !show('participant') && !show('buyer') && !show('shell') && <Splash title="Unknown section" />}
    </div>
  );
}
