// "/" — what Padma is, its true status, and the two ways in. No numbers, no demo link, no API calls.
import { Link } from 'react-router-dom';
import { ArrowRight, ShieldOff } from 'lucide-react';
import { BRAND } from '@shared/brand';
import { PROHIBITED_USES } from '@shared/ontology';
import { SiteLayout, StatusLine } from './SiteLayout';

const STEPS = [
  { title: 'You join the registry', body: 'A short form: your contact details, your age band, where you live, the devices you own and the kinds of study you would consider. No health information.' },
  { title: 'A research team asks us to pass on an invitation', body: 'Only for a study that an ethics board has approved. We send the invitation to members who said they are open to that kind of study.' },
  { title: 'You decide, one study at a time', body: 'Every study has its own consent form and says up front what it involves and what it pays. You can say no, and you can leave the registry at any time.' },
];

export default function Landing() {
  return (
    <SiteLayout>
      <section className="site-hero">
        <h1 className="site-h1">Health research that asks first.</h1>
        <p className="site-lead">
          {BRAND.name} is a registry of adults who want to be invited to paid health research studies.
          It also helps research teams reach those people, one approved study at a time.
        </p>
        <StatusLine className="site-status--box" />
        <div className="site-paths">
          <Link to="/researchers" className="site-path" data-testid="path-researchers">
            <span className="site-path__kicker">I run studies</span>
            <span className="site-path__title">Reach adults who asked to be invited</span>
            <span className="site-path__go">For researchers <ArrowRight aria-hidden="true" /></span>
          </Link>
          <Link to="/join" className="site-path" data-testid="path-join">
            <span className="site-path__kicker">I want to take part</span>
            <span className="site-path__title">Hear about studies you might fit</span>
            <span className="site-path__go">Join the registry <ArrowRight aria-hidden="true" /></span>
          </Link>
        </div>
      </section>

      <section className="site-section" aria-labelledby="how">
        <h2 className="site-h2" id="how">How it works</h2>
        <ol className="site-steps">
          {STEPS.map((s, i) => (
            <li className="site-step" key={s.title}>
              <span className="site-step__n" aria-hidden="true">{i + 1}</span>
              <div>
                <h3 className="site-h3">{s.title}</h3>
                <p>{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="site-section" aria-labelledby="never">
        <h2 className="site-h2" id="never">What {BRAND.name} will never allow</h2>
        <p className="site-p">Whatever a study collects, and whatever the registry holds, these uses are ruled out for every member and every research team:</p>
        <ul className="site-never" data-testid="banned-uses">
          {PROHIBITED_USES.map((p) => (
            <li key={p.key}><ShieldOff aria-hidden="true" /> <span>{p.label}</span></li>
          ))}
        </ul>
      </section>
    </SiteLayout>
  );
}
