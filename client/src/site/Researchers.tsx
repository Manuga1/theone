// "/researchers" — what is offered today (the plan's offer table, without prices), the money rule, what a team has to
// bring, the protocol sheets, ONE call to action, and the only link from the public site into the simulated demo.
import { Link } from 'react-router-dom';
import { ArrowRight, FileText } from 'lucide-react';
import { BRAND } from '@shared/brand';
import { SiteLayout, StatusLine } from './SiteLayout';
import { FormEmbed } from './FormEmbed';
import { SITE } from './config';

const OFFERS = [
  {
    key: 'referral',
    title: 'Referral campaign',
    forWhom: 'For academic labs',
    points: [
      'We send your approved study notice to registry members who opted in to that kind of study.',
      'You get a referral report: how many notices went out and how many people asked to hear more.',
      'We do not screen, consent or see study data. Your team does all of that.',
    ],
  },
  {
    key: 'pilot',
    title: 'Pilot cohort',
    forWhom: 'For startups and labs',
    points: [
      '15–25 completers on a simple protocol: surveys, daily logs and data from the participant’s own wearable.',
      'Run under your approved protocol and your consent form.',
      'Data is captured in your approved data-capture tool. You get CSV exports, a data dictionary and a completion report from us.',
    ],
  },
  {
    key: 'design',
    title: 'Design partner',
    forWhom: 'For funded startups',
    points: [
      '10 participants, one protocol, and a weekly call while it runs.',
      'For teams that hold an approved protocol, or whose counsel treats the work as product feedback.',
      'You help shape how the service works; we learn what you actually need.',
    ],
  },
];

export default function Researchers() {
  return (
    <SiteLayout title="For researchers">
      <section className="site-hero site-hero--page">
        <h1 className="site-h1">Reach adults who asked to be invited.</h1>
        <p className="site-lead">
          {BRAND.name} keeps a registry of adults who want to hear about paid health research, and passes on invitations for approved studies.
          We are small and new, so we start with small, simple studies.
        </p>
        <StatusLine className="site-status--box" />
      </section>

      <section className="site-section" aria-labelledby="offers">
        <h2 className="site-h2" id="offers">What we offer today</h2>
        <div className="site-offers">
          {OFFERS.map((o) => (
            <article className="site-offer" key={o.key} data-testid={`offer-${o.key}`}>
              <p className="site-offer__for">{o.forWhom}</p>
              <h3 className="site-h3">{o.title}</h3>
              <ul className="site-list">{o.points.map((p) => <li key={p}>{p}</li>)}</ul>
              <p className="site-offer__fee">Service fee: quoted per study.</p>
            </article>
          ))}
        </div>
        <p className="site-p site-muted">The registry is just opening. Before you commit to anything, we will tell you how many members have opted in to your kind of study.</p>
      </section>

      <section className="site-section site-cols" aria-label="How money and paperwork work">
        <div>
          <h2 className="site-h2" id="money">How the money works</h2>
          <ul className="site-list">
            <li>You pay participants directly, at the rate your protocol states.</li>
            <li>You buy and ship any devices directly.</li>
            <li>{BRAND.name} never holds participant money and never buys devices.</li>
            <li>{BRAND.name} invoices only a service fee. Every quote shows the two lines separately.</li>
            <li>{BRAND.name} is not yet a company. Until it is, a scope goes out as a written proposal and nothing is signed or invoiced.</li>
          </ul>
        </div>
        <div>
          <h2 className="site-h2" id="need">What we need from you</h2>
          <ul className="site-list">
            <li>An amendment to your approved protocol that names {BRAND.name} as a recruitment source.</li>
            <li>Your approved study notice: the wording your ethics board signed off, which we send unchanged.</li>
            <li>For a pilot cohort: your approved protocol and consent form, and a contact on your team for participant questions.</li>
          </ul>
        </div>
      </section>

      <section className="site-section" aria-labelledby="sheets">
        <h2 className="site-h2" id="sheets">Protocol sheets</h2>
        <p className="site-p">Three one-page examples of what a simple pilot can measure, how long it takes and what you receive. Each prints on a single page.</p>
        <p><Link className="site-btn" to="/protocols"><FileText aria-hidden="true" /> See the protocol sheets</Link></p>
      </section>

      <section className="site-section site-cta" aria-labelledby="talk" data-testid="pilot-cta">
        <h2 className="site-h2" id="talk">Talk to us about a pilot</h2>
        {(SITE.pilotFormUrl || SITE.contactEmail) && <p className="site-p">Tell us what you are studying and what you need. One of the founders will reply.</p>}
        <FormEmbed
          url={SITE.pilotFormUrl}
          email={SITE.contactEmail}
          title="Talk to us about a pilot"
          emailSubject={`${BRAND.name} pilot enquiry`}
          closedText="Pilot enquiries open soon."
          testId="pilot-form"
        />
      </section>

      <section className="site-section site-demo" aria-label="Product demo">
        <p className="site-p">
          We have also built a working model of the software on simulated data. It shows the idea; it contains no real people and says nothing about how many participants {BRAND.name} can reach.
        </p>
        <p><Link className="site-link-strong" to="/b" data-testid="demo-link">See the simulated product demo <ArrowRight aria-hidden="true" /></Link></p>
      </section>
    </SiteLayout>
  );
}
