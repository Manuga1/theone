// The product demo (simulated data): participant routes under /p, buyer routes under /b. Loaded lazily from App.tsx so
// the public pages do not carry the demo's code. /b/admin and /b/analytics exist only in admin mode (?admin).
import { useEffect, type ReactNode } from 'react';
import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import type { ParticipantHome } from '@shared/api-types';
import { BRAND } from '@shared/brand';
import { useApi } from './hooks';
import { useAdmin } from './admin';
import { Shell } from './components/Shell';
import './styles/components.css';

import PHome from './participant/Home';
import PSignature from './participant/Signature';
import PNodeDetail from './participant/NodeDetail';
import PTimeline from './participant/Timeline';
import PSources from './participant/Sources';
import POpportunities from './participant/Opportunities';
import POpportunityReview from './participant/OpportunityReview';
import PEarnings from './participant/Earnings';
import PPermissions from './participant/Permissions';
import PProfile from './participant/Profile';
import POnboarding from './participant/Onboarding';

import BHome from './buyer/Home';
import BCohortBuilder from './buyer/CohortBuilder';
import BFunnelPage from './buyer/FunnelPage';
import BMissingData from './buyer/MissingData';
import BCoverage from './buyer/Coverage';
import BExpand from './buyer/Expand';
import BProposal from './buyer/Proposal';
import BStudies from './buyer/Studies';
import BStudy from './buyer/Study';
import BCampaigns from './buyer/Campaigns';
import BDatasets from './buyer/Datasets';
import BDataset from './buyer/Dataset';
import BWorkspace from './buyer/Workspace';
import BRequestVariable from './buyer/RequestVariable';
import BAnalytics from './buyer/Analytics';
import BAdmin from './buyer/Admin';

function useDemoTitle(): void {
  useEffect(() => {
    document.title = `${BRAND.name} demo (simulated data)`;
  }, []);
}

/**
 * Gate every /p/* screen on onboarding: HomeExtras.onboardingCompleted (served by /participant/home, which the
 * current API already fills) is false after "Restart onboarding" → redirect to /p/onboarding. Unknown (older API,
 * schema-only database, request failed) → no gating. Children render while the flag loads so pages never wait on it.
 */
function OnboardingGate({ children }: { children: ReactNode }) {
  const q = useApi<ParticipantHome>('/participant/home');
  const loc = useLocation();
  if (q.data && q.data.onboardingCompleted === false && !q.data.empty) return <Navigate to="/p/onboarding" replace state={{ from: loc.pathname }} />;
  return <>{children}</>;
}

function ParticipantLayout() {
  return (
    <Shell side="participant" title="My Health Asset">
      <OnboardingGate>
        <Outlet />
      </OnboardingGate>
    </Shell>
  );
}
function BuyerLayout() {
  return (
    <Shell side="buyer" title="Research workspace" wide>
      <Outlet />
    </Shell>
  );
}

/** Admin-mode screens: without ?admin they do not exist, so the URL goes back to the buyer home. */
function AdminOnly({ children }: { children: ReactNode }) {
  return useAdmin() ? <>{children}</> : <Navigate to="/b" replace />;
}

/** Mounted at /p/*. */
export function ParticipantRoutes() {
  useDemoTitle();
  return (
    <Routes>
      {/* Focused flow outside the shell; the participant layout redirects here while onboarding is incomplete. */}
      <Route path="onboarding" element={<POnboarding />} />
      <Route element={<ParticipantLayout />}>
        <Route index element={<PHome />} />
        <Route path="signature" element={<PSignature />} />
        <Route path="signature/:domain" element={<PSignature />} />
        <Route path="node/:slug" element={<PNodeDetail />} />
        <Route path="timeline" element={<PTimeline />} />
        <Route path="sources" element={<PSources />} />
        <Route path="opportunities" element={<POpportunities />} />
        <Route path="opportunities/:id" element={<POpportunityReview />} />
        <Route path="earnings" element={<PEarnings />} />
        <Route path="permissions" element={<PPermissions />} />
        <Route path="profile" element={<PProfile />} />
        <Route path="*" element={<Navigate to="/p" replace />} />
      </Route>
    </Routes>
  );
}

/** Mounted at /b/*. */
export function BuyerRoutes() {
  useDemoTitle();
  return (
    <Routes>
      <Route element={<BuyerLayout />}>
        <Route index element={<BHome />} />
        <Route path="cohorts/new" element={<BCohortBuilder />} />
        <Route path="cohorts/:id" element={<Navigate to="define" replace />} />
        <Route path="cohorts/:id/define" element={<BCohortBuilder />} />
        <Route path="cohorts/:id/funnel" element={<BFunnelPage />} />
        <Route path="cohorts/:id/missing" element={<BMissingData />} />
        <Route path="cohorts/:id/coverage" element={<BCoverage />} />
        <Route path="cohorts/:id/expand" element={<BExpand />} />
        <Route path="cohorts/:id/proposal" element={<BProposal />} />
        <Route path="studies" element={<BStudies />} />
        <Route path="studies/:id" element={<BStudy />} />
        <Route path="studies/:id/request-variable" element={<BRequestVariable />} />
        <Route path="campaigns" element={<BCampaigns />} />
        <Route path="datasets" element={<BDatasets />} />
        <Route path="datasets/:id" element={<BDataset />} />
        <Route path="datasets/:id/workspace" element={<BWorkspace />} />
        <Route path="analytics" element={<AdminOnly><BAnalytics /></AdminOnly>} />
        <Route path="admin" element={<AdminOnly><BAdmin /></AdminOnly>} />
        <Route path="*" element={<Navigate to="/b" replace />} />
      </Route>
    </Routes>
  );
}
