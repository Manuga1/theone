// "/protocols" (index) and "/protocols/:slug" (one printable sheet). A sheet is a single page on A4 or Letter with the
// watermark from shared/brand.ts across its body, on screen and in print. No population counts appear here.
import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Printer } from 'lucide-react';
import { BRAND } from '@shared/brand';
import { BrandMark } from '../components/Brand';
import { SiteLayout } from './SiteLayout';
import { PROTOCOL_SHEETS, findSheet, type ProtocolSheet } from './protocols-data';

export function ProtocolsIndex() {
  return (
    <SiteLayout title="Protocol sheets">
      <section className="site-hero site-hero--page">
        <h1 className="site-h1">Protocol sheets</h1>
        <p className="site-lead">Three simple pilots, each on one page: who takes part, what is measured, the schedule, what you receive and what you provide. They are examples to start a conversation, not offers.</p>
      </section>
      <section className="site-section">
        <div className="site-offers">
          {PROTOCOL_SHEETS.map((s) => (
            <Link className="site-offer site-offer--link" key={s.slug} to={`/protocols/${s.slug}`} data-testid={`sheet-link-${s.slug}`}>
              {s.tag && <p className="site-offer__for">{s.tag}</p>}
              <h2 className="site-h3">{s.title}</h2>
              <p>{s.summary}</p>
              <span className="site-path__go">Open the sheet <ArrowRight aria-hidden="true" /></span>
            </Link>
          ))}
        </div>
        <p className="site-p site-muted">{BRAND.watermark}</p>
      </section>
    </SiteLayout>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="sheet__block">
      <h2 className="sheet__h">{title}</h2>
      {children}
    </section>
  );
}
function Rows({ rows }: { rows: { when: string; what: string }[] }) {
  return (
    <dl className="sheet__rows">
      {rows.map((r) => (
        <div key={r.when + r.what}><dt>{r.when}</dt><dd>{r.what}</dd></div>
      ))}
    </dl>
  );
}

export function Sheet({ sheet }: { sheet: ProtocolSheet }) {
  return (
    <article className="sheet" data-testid="protocol-sheet">
      {/* three copies: the middle one shows on wide screens and in print, all three on a long phone-width sheet */}
      <div className="sheet__watermark" aria-hidden="true" data-testid="watermark">
        <span className="sheet__wm-extra">{BRAND.watermark}</span>
        <span>{BRAND.watermark}</span>
        <span className="sheet__wm-extra">{BRAND.watermark}</span>
      </div>
      <header className="sheet__head">
        <div className="sheet__brand"><BrandMark size={22} /> {BRAND.name}</div>
        <div className="sheet__kind">Protocol sheet{sheet.tag ? ` · ${sheet.tag}` : ''}</div>
      </header>
      <h1 className="sheet__title">{sheet.title}</h1>
      <p className="sheet__summary">{sheet.summary}</p>
      <div className="sheet__grid">
        <Block title="Who takes part"><ul>{sheet.whoTakesPart.map((x) => <li key={x}>{x}</li>)}</ul></Block>
        <Block title="Measures"><ul>{sheet.measures.map((x) => <li key={x}>{x}</li>)}</ul></Block>
        <Block title="Schedule"><Rows rows={sheet.schedule} /></Block>
        <Block title="What you receive"><ul>{sheet.deliverable.map((x) => <li key={x}>{x}</li>)}</ul></Block>
        <Block title="Planned timeline"><Rows rows={sheet.timeline} /></Block>
        <Block title="What you provide"><ul>{sheet.buyerProvides.map((x) => <li key={x}>{x}</li>)}</ul></Block>
      </div>
      <p className="sheet__fee"><strong>Service fee: quoted per study.</strong> Participant payments and devices are paid for by you directly and are not part of the fee.</p>
      <footer className="sheet__foot">
        <p>{BRAND.statusLine} {BRAND.notAffiliated}</p>
        <p>This sheet is an illustration of a possible pilot, not an offer. Any study runs only under the research team&rsquo;s own approved protocol.</p>
      </footer>
    </article>
  );
}

export function ProtocolSheetPage() {
  const { slug } = useParams();
  const sheet = findSheet(slug);
  if (!sheet) return <Navigate to="/protocols" replace />;
  return (
    <SiteLayout title={sheet.title}>
      <div className="sheet-bar no-print">
        <Link to="/protocols" className="site-back"><ArrowLeft aria-hidden="true" /> All protocol sheets</Link>
        <button type="button" className="site-btn" onClick={() => window.print()}><Printer aria-hidden="true" /> Print this sheet</button>
      </div>
      <Sheet sheet={sheet} />
    </SiteLayout>
  );
}
