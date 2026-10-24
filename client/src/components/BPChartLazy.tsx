// Lazy wrapper so recharts (the only heavy chart dependency) stays out of the main bundle until a chart is shown.
import { lazy, Suspense } from 'react';
import type { BPChartProps } from './BPChart';

const Inner = lazy(() => import('./BPChart').then((m) => ({ default: m.BPChart })));

export function LazyBPChart(props: BPChartProps) {
  return (
    <Suspense fallback={<div className="faint small" style={{ height: props.height ?? 220, display: 'grid', placeItems: 'center' }}>Loading chart…</div>}>
      <Inner {...props} />
    </Suspense>
  );
}
