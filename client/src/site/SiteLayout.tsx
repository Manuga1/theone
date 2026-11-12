// Shared frame for the public pages: a small header (brand + three links) and a footer that always carries the
// project's true status and the no-affiliation line. Nothing here talks to the API or links into the demo.
import { useEffect, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { BRAND } from '@shared/brand';
import { BrandMark } from '../components/Brand';
import '../styles/site.css';

const LINKS = [
  { to: '/researchers', label: 'For researchers' },
  { to: '/join', label: 'Take part' },
  { to: '/privacy', label: 'Privacy' },
];

/** Tab title for a public page: "For researchers · Padma" (the landing page is just the name). */
export function usePageTitle(title?: string): void {
  useEffect(() => {
    document.title = title ? `${title} · ${BRAND.name}` : BRAND.name;
  }, [title]);
}

export function StatusLine({ className = '' }: { className?: string }) {
  return <p className={`site-status${className ? ` ${className}` : ''}`} data-testid="status-line">{BRAND.statusLine}</p>;
}

export function SiteLayout({ title, narrow, children }: { title?: string; narrow?: boolean; children: ReactNode }) {
  usePageTitle(title);
  const { pathname } = useLocation();
  // a new page starts at its top (client-side navigation keeps the scroll position otherwise)
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return (
    <div className="site">
      <header className="site-header">
        <div className="site-header__inner">
          <Link to="/" className="site-brand" aria-label={`${BRAND.name} home`}><BrandMark size={28} /> <span>{BRAND.name}</span></Link>
          <nav className="site-nav" aria-label="Site">
            {LINKS.map((l) => <NavLink key={l.to} to={l.to} className={({ isActive }) => `site-nav__link${isActive ? ' site-nav__link--active' : ''}`}>{l.label}</NavLink>)}
          </nav>
        </div>
      </header>
      <main className={`site-main${narrow ? ' site-main--narrow' : ''}`}>{children}</main>
      <footer className="site-footer">
        <div className="site-footer__inner">
          <p className="site-footer__status" data-testid="footer-status">{BRAND.statusLine}</p>
          <p>{BRAND.notAffiliated}</p>
          <nav className="site-footer__links" aria-label="Footer">
            <Link to="/">Home</Link>
            <Link to="/researchers">For researchers</Link>
            <Link to="/join">Take part</Link>
            <Link to="/protocols">Protocol sheets</Link>
            <Link to="/privacy">Privacy</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
