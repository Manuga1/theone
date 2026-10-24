// Route table (see plan § Frontend). Participant routes live under /p, buyer routes under /b; "/" redirects by persona.
import { lazy, Suspense, type ReactNode } from 'react';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { usePersona } from './hooks';
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

const Gallery = lazy(() => import('./dev/Gallery'));

function ParticipantLayout() {
  return (
    <Shell side="participant" title="My Health Asset">
      <Outlet />
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
function Fallback({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="faint small" style={{ padding: 20 }}>Loading…</div>}>{children}</Suspense>;
}

export default function App() {
  const [persona] = usePersona();
  return (
    <Routes>
      <Route path="/" element={<Navigate to={persona === 'participant' ? '/p' : '/b'} replace />} />

      <Route path="/p" element={<ParticipantLayout />}>
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

      <Route path="/b" element={<BuyerLayout />}>
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
        <Route path="analytics" element={<BAnalytics />} />
        <Route path="admin" element={<BAdmin />} />
        <Route path="*" element={<Navigate to="/b" replace />} />
      </Route>

      {/* Dev-only component gallery with fixture props (the one place sample numbers are allowed). */}
      <Route path="/dev/gallery" element={<Fallback><Gallery /></Fallback>} />
      <Route path="/dev/gallery/:section" element={<Fallback><Gallery /></Fallback>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
