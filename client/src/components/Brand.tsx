// Brand mark, the demo banner and the two small honesty labels used across the demo. All wording that describes the
// project's status comes from shared/brand.ts.
import { BRAND } from '@shared/brand';

/** A simple lotus (the name means lotus): five petals, drawn inline so no asset is fetched. */
export function LotusGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M12 3.2c-2.6 3-3.4 6.3-3.4 8.6 0 2.6 1.3 5 3.4 6.6 2.1-1.6 3.4-4 3.4-6.6 0-2.3-.8-5.6-3.4-8.6z" />
      <path d="M5.3 7.4c-.5 3.4.3 6.2 1.9 8.1 1.2 1.5 2.9 2.5 4.6 2.9-2.4-1.9-3.9-4.4-4.1-7.4-1-1.5-1.7-2.7-2.4-3.6z" opacity=".72" />
      <path d="M18.7 7.4c.5 3.4-.3 6.2-1.9 8.1-1.2 1.5-2.9 2.5-4.6 2.9 2.4-1.9 3.9-4.4 4.1-7.4 1-1.5 1.7-2.7 2.4-3.6z" opacity=".72" />
      <path d="M1.8 12.6c1.1 3 3.1 4.9 5.4 5.8 1.5.6 3 .7 4.4.5-2.2-.6-4.2-1.8-5.5-3.6-1.6-.9-3-1.8-4.3-2.7z" opacity=".5" />
      <path d="M22.2 12.6c-1.1 3-3.1 4.9-5.4 5.8-1.5.6-3 .7-4.4.5 2.2-.6 4.2-1.8 5.5-3.6 1.6-.9 3-1.8 4.3-2.7z" opacity=".5" />
      <path d="M5 20.3h14v1.3H5z" opacity=".5" />
    </svg>
  );
}

/** The mark in its rounded tile (sidebar, top bar, onboarding header, public site header). */
export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size, flexBasis: size }}>
      <LotusGlyph size={Math.round(size * 0.72)} />
    </span>
  );
}

/** Persistent strip on every demo screen, at every width. */
export function DemoBanner() {
  return (
    <div className="demo-banner" role="note" data-testid="demo-banner">
      <span className="demo-banner__tag">Demo</span>
      <span className="demo-banner__text">{BRAND.demoBanner}</span>
    </div>
  );
}

/** Caption for dollar figures in the participant demo: one per card or table. */
export function Illustrative({ className = '' }: { className?: string }) {
  const label = BRAND.illustrativeLabel;
  return <span className={`illus${className ? ` ${className}` : ''}`} data-testid="illustrative">{label.charAt(0).toUpperCase() + label.slice(1)}</span>;
}

export const DEMO_ONLY_HINT = 'Demo only. Do not enter real health information.';
/** Shown next to every place the demo accepts typed or uploaded input. */
export function DemoOnlyHint({ className = '' }: { className?: string }) {
  return <div className={`demo-only${className ? ` ${className}` : ''}`} data-testid="demo-only-hint">{DEMO_ONLY_HINT}</div>;
}
