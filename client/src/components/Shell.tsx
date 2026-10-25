// App shell: participant (light sidebar) and buyer (dark navy sidebar) layouts, persona switch, buyer org selector,
// "Reset demo" button, a splash while the API reports ready=false, and an empty state when the database is unseeded.
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  HeartPulse, Database, Sparkles, Wallet, Clock, Shield, User, Search, FlaskConical, Layers, Megaphone, ChartLine, Settings,
  RotateCcw, ArrowRightLeft,
} from 'lucide-react';
import type { DemoState, Health, Persona } from '@shared/api-types';
import { useApi, usePersona } from '../hooks';
import { api } from '../api';
import { Splash } from './Splash';
import { EmptyState } from './EmptyState';
import { SearchBar } from './SearchBar';
import { Toasts } from '../toast';
import { BlockedBanner, useOrgConsent } from '../buyer/shared';

export type NavItem = { to: string; label: string; icon: ReactNode; end?: boolean };

export const PARTICIPANT_NAV: NavItem[] = [
  { to: '/p', label: 'My Health', icon: <HeartPulse />, end: true },
  { to: '/p/sources', label: 'Data Sources', icon: <Database /> },
  { to: '/p/opportunities', label: 'Opportunities', icon: <Sparkles /> },
  { to: '/p/earnings', label: 'Earnings', icon: <Wallet /> },
  { to: '/p/timeline', label: 'Timeline', icon: <Clock /> },
  { to: '/p/permissions', label: 'Permissions', icon: <Shield /> },
  { to: '/p/profile', label: 'Profile', icon: <User /> },
];
export const BUYER_NAV: NavItem[] = [
  { to: '/b', label: 'Research', icon: <Search />, end: true },
  { to: '/b/studies', label: 'My Studies', icon: <FlaskConical /> },
  { to: '/b/datasets', label: 'Datasets', icon: <Layers /> },
  { to: '/b/campaigns', label: 'Collection Campaigns', icon: <Megaphone /> },
  { to: '/b/analytics', label: 'Analytics', icon: <ChartLine /> },
  { to: '/b/admin', label: 'Admin', icon: <Settings /> },
];

export type ShellProps = {
  side: 'participant' | 'buyer';
  title?: ReactNode;
  wide?: boolean;
  children: ReactNode;
  /** Injected for the dev gallery / tests; otherwise fetched from the API. */
  state?: DemoState | null;
  health?: Health | null;
};

function orgIdOf(p: Persona): number | null {
  return p.startsWith('buyer:') ? Number(p.slice(6)) : null;
}

export function Shell({ side, title, wide, children, state: stateProp, health: healthProp }: ShellProps) {
  const [persona, setPersona] = usePersona();
  const navigate = useNavigate();
  const healthQ = useApi<Health>(healthProp === undefined ? '/health' : null);
  const stateQ = useApi<DemoState>(stateProp === undefined ? '/demo/state' : null);
  const health = healthProp === undefined ? healthQ.data : healthProp;
  const state = stateProp === undefined ? stateQ.data : stateProp;
  const [resetting, setResetting] = useState(false);
  const [q, setQ] = useState('');
  const consent = useOrgConsent();

  // Poll /health while the seed is still running.
  useEffect(() => {
    if (healthProp !== undefined) return;
    if (health && !health.ready) {
      const t = setTimeout(() => healthQ.reload(), 1500);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [health, healthProp, healthQ]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const switchPersona = () => {
    if (side === 'participant') {
      const first = state?.orgs[0]?.id ?? 1;
      setPersona(`buyer:${first}`);
      navigate('/b');
    } else {
      setPersona('participant');
      navigate('/p');
    }
  };
  const chooseOrg = (id: number) => {
    setPersona(`buyer:${id}`);
  };
  const reset = async () => {
    if (!window.confirm('Wipe and regenerate all synthetic demo data?')) return;
    setResetting(true);
    // The page we were on may show an entity the reseed no longer has (e.g. a study or dataset built during the demo).
    // Navigate to the persona home BEFORE the reset: react-router navigates in a transition, so a navigate() issued after
    // the reset would be committed after setResetting(false) and the old page would mount and refetch (404) first.
    navigate(side === 'buyer' ? '/b' : '/p');
    try {
      await api.post('/demo/reset');
      healthQ.reload();
      stateQ.reload();
    } finally {
      setResetting(false);
    }
  };

  if (health && !health.ready) return <Splash />;
  if (resetting) return <Splash title="Resetting demo…" sub="Wiping data/ and regenerating the synthetic population." />;

  const nav = side === 'participant' ? PARTICIPANT_NAV : BUYER_NAV;
  const orgId = orgIdOf(persona);
  const org = state?.orgs.find((o) => o.id === orgId) ?? state?.orgs[0] ?? null;
  const seeded = state?.seeded ?? health?.seeded ?? true;

  return (
    <div className="shell">
      <aside className={`shell__nav${side === 'buyer' ? ' shell__nav--dark' : ''}`}>
        <div className="shell__brand"><span className="shell__brand-mark">H</span> Health Data Asset</div>
        {side === 'participant' ? (
          <div className="shell__me">
            <span className="avatar avatar--md">{state?.participantPseudonym ? 'P' : '–'}</span>
            <div>
              <div className="shell__me-name">Participant</div>
              <div className="shell__me-sub">{state?.participantPseudonym ?? 'no data'}</div>
            </div>
          </div>
        ) : (
          <div className="shell__me">
            <span className="avatar avatar--md" style={{ background: 'var(--dark-2)', color: '#fff' }}>{org?.name?.[0] ?? 'B'}</span>
            <div>
              <div className="shell__me-name" style={{ color: '#fff' }}>{org?.name ?? 'Buyer'}</div>
              <div className="shell__me-sub">{org?.type ?? 'research organization'}</div>
            </div>
          </div>
        )}
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `navlink${isActive ? ' navlink--active' : ''}`}>
            {n.icon}
            {n.label}
          </NavLink>
        ))}
        <div className="shell__nav-spacer" />
        <div className="shell__nav-foot">
          Demo clock {state?.today ?? '—'}
          <br />Synthetic data only
          {state?.hosted ? <><br />Hosted demo: changes live on this server instance and may reset</> : null}
        </div>
      </aside>
      <div className="shell__main">
        <header className="shell__header">
          <span className="shell__header-title">{title ?? (side === 'participant' ? 'Participant' : 'Researcher workspace')}</span>
          {side === 'buyer' && <SearchBar value={q} onChange={setQ} onSubmit={(v) => navigate(`/b?q=${encodeURIComponent(v)}`)} />}
          <span className="shell__header-spacer" />
          {side === 'buyer' && state && state.orgs.length > 0 && (
            <select className="select select--sm" value={org?.id ?? ''} onChange={(e) => chooseOrg(Number(e.target.value))} aria-label="Buyer organization">
              {state.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          <button className="btn btn--sm" onClick={switchPersona} title="Switch persona">
            <ArrowRightLeft /> {side === 'participant' ? 'View as buyer' : 'View as participant'}
          </button>
          <button className="btn btn--sm" onClick={reset} title="Wipe and reseed synthetic data"><RotateCcw /> Reset demo</button>
        </header>
        <main className={`shell__content${wide ? ' shell__content--wide' : ''}`}>
          {!seeded && side === 'participant' ? <EmptyState /> : null}
          {!seeded && side === 'buyer' ? <div className="callout callout--amber mb-16">The database is empty (schema only). Counts read 0 until you run <code>npm run seed</code>.</div> : null}
          {side === 'buyer' && seeded ? <BlockedBanner consent={consent} orgName={org?.name} /> : null}
          {seeded || side === 'buyer' ? children : null}
        </main>
        <Toasts />
      </div>
    </div>
  );
}
