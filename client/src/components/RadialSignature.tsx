// Hand-written SVG: 8 domain nodes on a ring around the participant, each an icon circle + label + completeness.
import type { RingNode } from '@shared/api-types';
import { domainStyle } from './icons';

export type RadialSignatureProps = {
  ring: RingNode[];
  name: string;
  age: number | null;
  onSelect?: (slug: string) => void;
  selected?: string | null;
  width?: number;
  height?: number;
};

function pctColor(p: number): string {
  if (p >= 80) return 'var(--green)';
  if (p >= 50) return 'var(--amber)';
  return 'var(--red)';
}

export function RadialSignature({ ring, name, age, onSelect, selected, width = 520, height = 400 }: RadialSignatureProps) {
  const cx = width / 2;
  const cy = height / 2;
  const rx = width * 0.33;
  const ry = height * 0.36;
  const nodeR = 19;
  const centerR = 46;
  const n = Math.max(ring.length, 1);
  const initials = name.split(/\s+/).map((s) => s[0] ?? '').join('').slice(0, 2).toUpperCase();

  return (
    <div className="radial">
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={`Health signature for ${name}`}>
        <defs>
          <linearGradient id="radial-avatar" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#c8d8f5" />
            <stop offset="100%" stopColor="#7fa3e6" />
          </linearGradient>
        </defs>
        {/* connectors */}
        {ring.map((node, i) => {
          const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
          const x = cx + rx * Math.cos(a);
          const y = cy + ry * Math.sin(a);
          const style = domainStyle(node.slug);
          return <line key={`l-${node.slug}`} x1={cx} y1={cy} x2={x} y2={y} stroke={style.color} strokeOpacity={0.35} strokeWidth={1.5} />;
        })}
        {/* ring */}
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke="#e3e8f0" strokeDasharray="3 4" />
        {/* center avatar */}
        <circle cx={cx} cy={cy} r={centerR + 5} fill="#fff" stroke="#e3e8f0" />
        <circle cx={cx} cy={cy} r={centerR} fill="url(#radial-avatar)" />
        <text x={cx} y={cy + 7} textAnchor="middle" fontSize={20} fontWeight={700} fill="#1f3b70">{initials}</text>
        <text x={cx} y={cy + centerR + 22} textAnchor="middle" className="radial__name">{name.split(/\s+/)[0]?.toUpperCase()}</text>
        {age !== null && <text x={cx} y={cy + centerR + 36} textAnchor="middle" className="radial__age">Age {age}</text>}
        {/* nodes */}
        {ring.map((node, i) => {
          const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
          const x = cx + rx * Math.cos(a);
          const y = cy + ry * Math.sin(a);
          const style = domainStyle(node.slug);
          const Icon = style.icon;
          const cos = Math.cos(a);
          const sin = Math.sin(a);
          const labelRight = cos > 0.2 || (Math.abs(cos) <= 0.2 && sin < 0);
          const lx = labelRight ? x + nodeR + 8 : x - nodeR - 8;
          const anchor = labelRight ? 'start' : 'end';
          const isSel = selected === node.slug;
          return (
            <g key={node.slug} className="radial__node" onClick={() => onSelect?.(node.slug)} style={{ cursor: onSelect ? 'pointer' : 'default' }}>
              <circle className="radial__circle" cx={x} cy={y} r={nodeR} fill={style.soft} stroke={isSel ? style.color : '#fff'} strokeWidth={isSel ? 2.5 : 2} />
              <circle cx={x} cy={y} r={nodeR + 2} fill="none" stroke={style.color} strokeOpacity={0.5} strokeWidth={1} />
              <Icon x={x - 8} y={y - 8} width={16} height={16} color={style.color} strokeWidth={2} />
              <text x={lx} y={y - 2} textAnchor={anchor} className="radial__label">{node.name}</text>
              <text x={lx} y={y + 12} textAnchor={anchor} className="radial__pct" fill={pctColor(node.pct)}>{Math.round(node.pct)}%</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
