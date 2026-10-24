// Expandable domain → group → leaf tree with ✓/◐/○ glyphs, % chips, Opportunity and $ pills, and a legend.
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { TreeNode, ParticipantSignature } from '@shared/api-types';
import { StateGlyph } from './StatusDot';
import { Pill } from './Pill';
import { domainStyle } from './icons';

export type ConceptTreeProps = {
  domains: TreeNode[];
  legend?: ParticipantSignature['legend'];
  /** slugs expanded initially; defaults to domains that are not 100 % complete */
  defaultOpen?: string[];
  selected?: string | null;
  onSelectLeaf?: (leaf: TreeNode) => void;
  onSelectDomain?: (domain: TreeNode) => void;
  showLegend?: boolean;
};

function PctChip({ pct }: { pct: number }) {
  const tone = pct >= 80 ? 'high' : pct >= 50 ? 'mid' : 'low';
  return <span className={`ctree__pct ctree__pct--${tone}`}>{Math.round(pct)}%</span>;
}

function Leaf({ node, selected, onSelect }: { node: TreeNode; selected: boolean; onSelect?: (n: TreeNode) => void }) {
  return (
    <div className={`ctree__leaf${selected ? ' ctree__leaf--selected' : ''}`} onClick={() => onSelect?.(node)} role="button">
      <span className="ctree__leaf-name">{node.name}</span>
      {node.overlay.demand && <Pill variant="demand" sm>$</Pill>}
      {node.overlay.opportunity && <Pill variant="opportunity" sm>Opportunity</Pill>}
      <StateGlyph state={node.state} />
    </div>
  );
}

function Group({ node, selected, onSelect, open, toggle }: { node: TreeNode; selected: string | null | undefined; onSelect?: (n: TreeNode) => void; open: boolean; toggle: () => void }) {
  const hasChildren = node.children.length > 0;
  return (
    <div>
      <div className="ctree__group" onClick={toggle} role="button">
        <span className="ctree__chev">{hasChildren ? open ? <ChevronDown /> : <ChevronRight /> : <span style={{ width: 12 }} />}</span>
        <span className="ctree__group-name">{node.name}</span>
        <PctChip pct={node.pct} />
      </div>
      {open && node.children.map((leaf) => (leaf.children.length ? (
        <GroupRec key={leaf.slug} node={leaf} selected={selected} onSelect={onSelect} />
      ) : (
        <Leaf key={leaf.slug} node={leaf} selected={selected === leaf.slug} onSelect={onSelect} />
      )))}
    </div>
  );
}

function GroupRec({ node, selected, onSelect }: { node: TreeNode; selected: string | null | undefined; onSelect?: (n: TreeNode) => void }) {
  const [open, setOpen] = useState(true);
  return <Group node={node} selected={selected} onSelect={onSelect} open={open} toggle={() => setOpen((o) => !o)} />;
}

export function ConceptTree({ domains, legend, defaultOpen, selected, onSelectLeaf, onSelectDomain, showLegend = true }: ConceptTreeProps) {
  const initial = defaultOpen ?? domains.filter((d) => d.pct < 100 && d.children.length > 0).slice(0, 2).map((d) => d.slug);
  const [open, setOpen] = useState<Set<string>>(() => new Set(initial));
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(domains.flatMap((d) => d.children.map((g) => g.slug))));

  const toggleDomain = (d: TreeNode) => {
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(d.slug)) n.delete(d.slug);
      else n.add(d.slug);
      return n;
    });
    onSelectDomain?.(d);
  };
  const toggleGroup = (slug: string) =>
    setOpenGroups((s) => {
      const n = new Set(s);
      if (n.has(slug)) n.delete(slug);
      else n.add(slug);
      return n;
    });

  const legendItems = legend ?? [
    { key: 'verified' as const, label: 'Verified' },
    { key: 'partial' as const, label: 'Partial / self-reported' },
    { key: 'missing' as const, label: 'Missing' },
    { key: 'opportunity' as const, label: 'Opportunity' },
    { key: 'demand' as const, label: 'Requested by research' },
  ];

  return (
    <div className="ctree">
      {domains.map((d) => {
        const style = domainStyle(d.slug);
        const Icon = style.icon;
        const isOpen = open.has(d.slug);
        return (
          <div key={d.slug}>
            <div className={`ctree__domain${isOpen ? ' ctree__domain--open' : ''}`} onClick={() => toggleDomain(d)} role="button">
              <span className="ctree__domain-icon" style={{ background: style.soft, color: style.color }}><Icon /></span>
              <span className="ctree__domain-name">{d.name}</span>
              {d.overlay.demand && <Pill variant="demand" sm>$</Pill>}
              <PctChip pct={d.pct} />
              {d.children.length > 0 && <span className="ctree__chev">{isOpen ? <ChevronDown /> : <ChevronRight />}</span>}
            </div>
            {isOpen && d.children.map((g) => g.level === 'leaf' || g.children.length === 0 ? (
              <Leaf key={g.slug} node={g} selected={selected === g.slug} onSelect={onSelectLeaf} />
            ) : (
              <Group key={g.slug} node={g} selected={selected} onSelect={onSelectLeaf} open={openGroups.has(g.slug)} toggle={() => toggleGroup(g.slug)} />
            ))}
          </div>
        );
      })}
      {showLegend && (
        <div className="ctree__legend">
          {legendItems.map((l) => (
            <span key={l.key}>
              {l.key === 'opportunity' ? <Pill variant="opportunity" sm>Opp.</Pill> : l.key === 'demand' ? <Pill variant="demand" sm>$</Pill> : <StateGlyph state={l.key} />}
              {l.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
