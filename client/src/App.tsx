// Route table. Public site: "/", /researchers, /join, /privacy, /protocols[/:slug] (static pages, no API calls).
// Product demo on simulated data: participant routes under /p, buyer routes under /b (see DemoRoutes.tsx, loaded lazily
// so the public pages stay small). The only link from the public site into the demo is on /researchers.
import { lazy, Suspense, type ReactNode } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

import Landing from './site/Landing';
import Researchers from './site/Researchers';
import Join from './site/Join';
import Privacy from './site/Privacy';
import { ProtocolsIndex, ProtocolSheetPage } from './site/Protocols';

const ParticipantRoutes = lazy(() => import('./DemoRoutes').then((m) => ({ default: m.ParticipantRoutes })));
const BuyerRoutes = lazy(() => import('./DemoRoutes').then((m) => ({ default: m.BuyerRoutes })));
// Dev-only: in production builds the branch is dead code, so neither the route nor the chunk exists.
const Gallery = import.meta.env.DEV ? lazy(() => import('./dev/Gallery')) : null;

function Fallback({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div style={{ padding: 20, fontSize: 13, color: 'var(--text-3)' }}>Loading…</div>}>{children}</Suspense>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/researchers" element={<Researchers />} />
      <Route path="/join" element={<Join />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/protocols" element={<ProtocolsIndex />} />
      <Route path="/protocols/:slug" element={<ProtocolSheetPage />} />

      <Route path="/p/*" element={<Fallback><ParticipantRoutes /></Fallback>} />
      <Route path="/b/*" element={<Fallback><BuyerRoutes /></Fallback>} />

      {/* Dev-only component gallery with fixture props (the one place sample numbers are allowed). */}
      {Gallery && <Route path="/dev/gallery" element={<Fallback><Gallery /></Fallback>} />}
      {Gallery && <Route path="/dev/gallery/:section" element={<Fallback><Gallery /></Fallback>} />}

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
