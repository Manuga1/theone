// P2 Explore My Health Signature: the full concept tree with legend, a "why this matters" panel and a focus card.
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import type { ParticipantSignature, TreeNode } from '@shared/api-types';
import { useApi } from '../hooks';
import { Card, ConceptTree, ErrorBox, Pill, StatePill, Pct, domainStyle } from '../components';

function findNode(domains: TreeNode[], slug: string): TreeNode | null {
  for (const d of domains) {
    if (d.slug === slug) return d;
    const stack = [...d.children];
    while (stack.length) {
      const n = stack.pop()!;
      if (n.slug === slug) return n;
      stack.push(...n.children);
    }
  }
  return null;
}
function countLeaves(n: TreeNode): { verified: number; partial: number; missing: number; opp: number; demand: number } {
  const c = { verified: 0, partial: 0, missing: 0, opp: 0, demand: 0 };
  const walk = (x: TreeNode) => {
    if (x.level === 'leaf' || x.children.length === 0) {
      c[x.state]++;
      if (x.overlay.opportunity) c.opp++;
      if (x.overlay.demand) c.demand++;
    } else x.children.forEach(walk);
  };
  walk(n);
  return c;
}

export default function SignaturePage() {
  const { domain } = useParams();
  const navigate = useNavigate();
  const q = useApi<ParticipantSignature>('/participant/signature');
  const [selected, setSelected] = useState<string | null>(null);
  const domains = q.data?.domains ?? [];
  const focus = useMemo(() => (selected ? findNode(domains, selected) : domain ? findNode(domains, domain) : null), [domains, selected, domain]);
  const stats = useMemo(() => (focus ? countLeaves(focus) : null), [focus]);
  const totals = useMemo(() => domains.reduce((a, d) => { const c = countLeaves(d); return { verified: a.verified + c.verified, partial: a.partial + c.partial, missing: a.missing + c.missing, opp: a.opp + c.opp, demand: a.demand + c.demand }; }, { verified: 0, partial: 0, missing: 0, opp: 0, demand: 0 }), [domains]);

  if (q.error) return <ErrorBox error={q.error} />;
  return (
    <div className="grid grid--aside-main gap-16" style={{ gridTemplateColumns: '440px minmax(0, 1fr)' }}>
      <Card title="Your Health Signature" sub="Click any category to explore your data, see completeness, and find opportunities.">
        {q.data ? (
          <ConceptTree
            key={domain ?? 'all'}
            domains={domains}
            legend={q.data.legend}
            defaultOpen={domain ? [domain] : undefined}
            selected={selected ?? (domain && focus?.level === 'leaf' ? domain : null)}
            onSelectLeaf={(leaf) => { setSelected(leaf.slug); navigate(`/p/node/${leaf.slug}`); }}
            onSelectDomain={(d) => setSelected(d.slug)}
          />
        ) : <div className="faint small">Loading…</div>}
      </Card>
      <div className="col gap-16">
        {focus ? (
          <Card
            title={<span className="row gap-8">{(() => { const s = domainStyle(focus.slug); const I = s.icon; return <span className="ctree__domain-icon" style={{ background: s.soft, color: s.color }}><I /></span>; })()}{focus.name}</span>}
            sub={focus.level === 'domain' ? 'Domain' : focus.level === 'group' ? 'Group' : 'Variable'}
            right={<span className="row gap-6"><StatePill state={focus.state} />{focus.overlay.opportunity && <Pill variant="opportunity" />}{focus.overlay.demand && <Pill variant="demand" icon>Requested</Pill>}</span>}
          >
            <div className="row gap-16" style={{ alignItems: 'baseline' }}>
              <span className="big-num"><Pct x={focus.pct} /></span>
              <span className="small muted">complete</span>
            </div>
            {stats && (
              <div className="kv-grid mt-12">
                <div><span className="k">Verified</span><span className="v">{stats.verified}</span></div>
                <div><span className="k">Partial</span><span className="v">{stats.partial}</span></div>
                <div><span className="k">Missing</span><span className="v">{stats.missing}</span></div>
                <div><span className="k">Opportunities</span><span className="v">{stats.opp}</span></div>
                <div><span className="k">Requested by research</span><span className="v">{stats.demand}</span></div>
              </div>
            )}
            {(focus.level === 'leaf' || focus.children.length === 0) && (
              <button className="btn btn--primary mt-12" onClick={() => navigate(`/p/node/${focus.slug}`)}>Open {focus.name} <ArrowRight /></button>
            )}
          </Card>
        ) : (
          <Card title="Across your signature">
            <div className="kv-grid">
              <div><span className="k">Verified variables</span><span className="v">{totals.verified}</span></div>
              <div><span className="k">Partial</span><span className="v">{totals.partial}</span></div>
              <div><span className="k">Missing</span><span className="v">{totals.missing}</span></div>
              <div><span className="k">Open opportunities</span><span className="v">{totals.opp}</span></div>
              <div><span className="k">Requested by research</span><span className="v">{totals.demand}</span></div>
            </div>
          </Card>
        )}
        <Card title="Why this matters" soft>
          <div className="why">
            <p><strong>Verified</strong> means the value came straight from a clinical system or a connected device and spans long enough to be useful. <strong>Partial</strong> data is self-reported or too short; <strong>missing</strong> dimensions have no data yet.</p>
            <p>Every node you complete makes you eligible for more studies. <Pill variant="opportunity" sm /> marks variables an open study will pay you to collect; <Pill variant="demand" sm>$</Pill> marks variables an active campaign is requesting right now.</p>
            <p>Verification is provenance, not a diagnosis: the platform records where each value came from and never scores your health.</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
