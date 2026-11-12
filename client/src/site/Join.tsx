// "/join" — the participant registry: what it is, what is asked, what is promised, and the sign-up form.
// By design this page shows no dollar amounts and has no link into the product demo.
import { Link } from 'react-router-dom';
import { BRAND } from '@shared/brand';
import { SiteLayout, StatusLine } from './SiteLayout';
import { FormEmbed } from './FormEmbed';
import { ELIGIBILITY, SITE } from './config';

const ASKED = [
  'Your name',
  'Your email address',
  'Your age band',
  'The state you live in, and the state you would be in during a study',
  'The devices you own, such as a phone or a fitness tracker',
  'The kinds of study you would consider',
];

const PROMISES = [
  'Invitations come one study at a time.',
  'You choose each time. Saying no to one study does not affect the next.',
  'Each study states its pay up front, before you decide.',
  'Nothing is guaranteed: not an invitation, not a place in a study, not a payment.',
  'You can leave the registry at any time, and we delete your details.',
];

export default function Join() {
  return (
    <SiteLayout title="Take part">
      <section className="site-hero site-hero--page">
        <h1 className="site-h1">Join the registry.</h1>
        <p className="site-lead">
          The registry is a list of adults who are willing to be invited to paid health research studies.
          Joining means we may email you when a study might fit you. It does not sign you up for any study.
        </p>
        <StatusLine className="site-status--box" />
      </section>

      <section className="site-section site-cols" aria-label="What joining involves">
        <div>
          <h2 className="site-h2" id="asked">What you will be asked</h2>
          <ul className="site-list">{ASKED.map((a) => <li key={a}>{a}</li>)}</ul>
          <p className="site-p site-strong">We do not ask for any health information. Please do not send us any.</p>
        </div>
        <div>
          <h2 className="site-h2" id="promise">What we promise</h2>
          <ul className="site-list">{PROMISES.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      </section>

      <section className="site-section" aria-labelledby="who">
        <h2 className="site-h2" id="who">Who can join</h2>
        <p className="site-p">{ELIGIBILITY}</p>
        <p className="site-p">Before you sign up, please read the <Link to="/privacy">registry privacy notice</Link>. It says who runs {BRAND.name}, what is kept, who can see it and how to have it deleted.</p>
      </section>

      <section className="site-section site-cta" aria-labelledby="signup" data-testid="registry-cta">
        <h2 className="site-h2" id="signup">Sign up</h2>
        <FormEmbed
          url={SITE.registryFormUrl}
          email={SITE.contactEmail}
          title="Ask to join by email"
          emailSubject={`Join the ${BRAND.name} registry`}
          emailNote="Send us your name and we will reply with the short sign-up questions."
          closedText="Sign-ups open soon."
          testId="registry-form"
        />
        <p className="site-p site-muted">By signing up you agree to the <Link to="/privacy">registry privacy notice</Link>.</p>
      </section>
    </SiteLayout>
  );
}
