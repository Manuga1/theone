// "/privacy" — the registry notice in plain language. Founder names and the deletion address come from build-time
// settings; with neither set the page still reads correctly.
import { BRAND } from '@shared/brand';
import { SiteLayout } from './SiteLayout';
import { ELIGIBILITY, NOTICE_DATE, NOTICE_VERSION, SITE, joinNames, mailto, runBy } from './config';

export default function Privacy() {
  const founders = [...SITE.founders];
  const email = SITE.contactEmail;
  const keepers = founders.length > 0 ? joinNames(founders) : 'the two founders';
  return (
    <SiteLayout title="Privacy" narrow>
      <article className="site-prose" data-testid="registry-notice">
        <h1 className="site-h1">Registry privacy notice</h1>
        <p className="site-lead">This notice covers the {BRAND.name} registry: the list of people who asked to be invited to research studies. It is short on purpose. Please read it before you sign up.</p>

        <h2 className="site-h2">Who runs {BRAND.name}</h2>
        <p>{BRAND.name} is a student project {runBy(founders)}. It is not yet a company. {BRAND.notAffiliated}</p>

        <h2 className="site-h2">What we collect, and why</h2>
        <p>When you join we ask for:</p>
        <ul className="site-list">
          <li>your name and email address, so we can write to you;</li>
          <li>your age band, the state you live in and the state you would be in during a study, because studies have rules about who can take part and where;</li>
          <li>the devices you own and the kinds of study you would consider, so we only send invitations that could fit you.</li>
        </ul>
        <p>We do not ask for health information, and we ask you not to send any.</p>
        <p>We will email you when a study might fit you. Now and then we may also send a short check-in asking you to confirm your details are still right. It never asks about your health, and you can ignore it.</p>

        <h2 className="site-h2">Studies, consent and pay</h2>
        <p>Joining the registry does not put you in a study. Each study has its own consent form and states its pay before you decide. Nothing is guaranteed: you may not be invited, a study may be full, and no payment is promised by joining.</p>

        <h2 className="site-h2">Who sees your details</h2>
        <p>Your details are never sold. A study team receives them only if you say yes to that study. Until then they stay with us.</p>

        <h2 className="site-h2">No advertising trackers</h2>
        <p>We do not use advertising trackers on this site or in the registry. The sign-up form is run by a form service, which operates under its own terms.</p>

        <h2 className="site-h2">How your details are kept</h2>
        <p>They are kept in a restricted spreadsheet protected by two-factor sign-in. Two named people can open it: {keepers}. Nobody else has access.</p>

        <h2 className="site-h2">Leaving and deletion</h2>
        <p data-testid="deletion-contact">
          You can leave at any time. {email
            ? <>Email <a href={mailto(email, `Delete my ${BRAND.name} registry details`)}>{email}</a> and we will delete your details within 7 days.</>
            : <>Reply to any email from {BRAND.name} asking us to delete your details, and we will do so within 7 days.</>}
        </p>

        <h2 className="site-h2">If {BRAND.name} becomes a company</h2>
        <p>If the project becomes a company, we will tell you before your details move to it, so you can leave first if you prefer.</p>

        <h2 className="site-h2">Who can join</h2>
        <p>{ELIGIBILITY}</p>

        <p className="site-version" data-testid="notice-version">Registry notice version {NOTICE_VERSION}, {NOTICE_DATE}.</p>
      </article>
    </SiteLayout>
  );
}
