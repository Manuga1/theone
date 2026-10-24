// Recharts line chart for a time series (systolic / diastolic by default) with a range selector.
// The range is cut relative to the series window's `to` date (the demo clock), never the wall clock.
import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { NodeDetail } from '@shared/api-types';
import { addMonths, addDays } from '@shared/clock';
import { dateLong } from '@shared/fmt';
import { StatusDot } from './StatusDot';

export type ChartRange = '3m' | '6m' | '12m' | 'all';
const RANGES: { key: ChartRange; label: string; months: number | null }[] = [
  { key: '3m', label: 'Last 3 months', months: 3 },
  { key: '6m', label: 'Last 6 months', months: 6 },
  { key: '12m', label: 'Last 12 months', months: 12 },
  { key: 'all', label: 'All data', months: null },
];
// Validated with the dataviz palette checker (light surface): adjacent pairs pass CVD + normal-vision separation.
const SERIES_COLORS = ['#1d6ef5', '#c2410c', '#0e8a6b', '#b8700e'];

export type BPChartProps = {
  series: NodeDetail['series'];
  title?: string;
  unit?: string | null;
  height?: number;
  defaultRange?: ChartRange;
  yDomain?: [number, number] | 'auto';
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthLabel(iso: string): string {
  return MONTHS[Number(iso.slice(5, 7)) - 1] ?? iso;
}

export function BPChart({ series, title, unit, height = 220, defaultRange = '12m', yDomain = 'auto' }: BPChartProps) {
  const [range, setRange] = useState<ChartRange>(defaultRange);
  const keys = series.keys.map((k, i) => ({ ...k, color: k.color ?? SERIES_COLORS[i % SERIES_COLORS.length] }));

  const data = useMemo(() => {
    const r = RANGES.find((x) => x.key === range)!;
    const from = r.months === null ? '0000-00-00' : addMonths(series.window.to, -r.months);
    return series.points
      .filter((p) => p.t >= from)
      .map((p) => ({ t: p.t, ...p.values }));
  }, [series, range]);

  const ticks = useMemo(() => {
    // one tick per month start, from the first point's month
    if (data.length === 0) return [];
    const out: string[] = [];
    let seen = '';
    for (const d of data) {
      const m = d.t.slice(0, 7);
      if (m !== seen) {
        seen = m;
        out.push(d.t);
      }
    }
    return out.length > 14 ? out.filter((_, i) => i % Math.ceil(out.length / 12) === 0) : out;
  }, [data]);

  const domain = yDomain === 'auto' ? (['auto', 'auto'] as const) : yDomain;

  return (
    <div>
      <div className="row row--between mb-8">
        <div className="row gap-12">
          {title && <span className="h3">{title}{unit ? <span className="muted"> ({unit})</span> : null}</span>}
          {keys.length > 1 && keys.map((k) => (
            <span key={k.key} className="row gap-4 small muted"><StatusDot color={k.color} /> {k.label}</span>
          ))}
        </div>
        <select className="select select--sm" value={range} onChange={(e) => setRange(e.target.value as ChartRange)}>
          {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
      </div>
      {data.length === 0 ? (
        <div className="rail__empty" style={{ height }}>No observations in this window.</div>
      ) : (
        <div style={{ width: '100%', height }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid vertical={false} stroke="#eef2f7" />
              <XAxis dataKey="t" ticks={ticks} tickFormatter={monthLabel} tick={{ fontSize: 11, fill: '#8d99b0' }} axisLine={{ stroke: '#e3e8f0' }} tickLine={false} minTickGap={16} />
              <YAxis domain={domain as [number | string, number | string]} tick={{ fontSize: 11, fill: '#8d99b0' }} axisLine={false} tickLine={false} width={48} />
              <Tooltip
                cursor={{ stroke: '#cfd7e3', strokeDasharray: '3 3' }}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e3e8f0', boxShadow: '0 4px 12px rgba(16,24,40,.08)' }}
                labelFormatter={(l) => dateLong(String(l))}
                formatter={(v, name) => [`${typeof v === 'number' ? Math.round(v * 10) / 10 : v}${unit ? ' ' + unit : ''}`, String(name)]}
              />
              {keys.map((k) => (
                <Line key={k.key} type="monotone" dataKey={k.key} name={k.label} stroke={k.color} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="tiny faint mt-8">{data.length > 0 ? `${data.length} points · ${dateLong(data[0].t)} – ${dateLong(data[data.length - 1].t)}` : `Window ends ${dateLong(addDays(series.window.to, 0))}`}</div>
    </div>
  );
}
