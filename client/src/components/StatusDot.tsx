export type DotTone = 'verified' | 'partial' | 'missing' | 'complete' | 'accent' | 'purple' | 'muted' | 'green' | 'amber' | 'red';

export function StatusDot({ tone = 'muted', lg, title, color }: { tone?: DotTone; lg?: boolean; title?: string; color?: string }) {
  return <span className={`dot dot--${tone}${lg ? ' dot--lg' : ''}`} title={title} style={color ? { background: color } : undefined} />;
}

/** ✓ / ◐ / ○ glyph used by the concept tree. */
export function StateGlyph({ state }: { state: 'verified' | 'partial' | 'missing' }) {
  return (
    <span className={`glyph glyph--${state}`} aria-label={state} role="img">
      {state === 'verified' ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7" /></svg>
      ) : state === 'partial' ? (
        <svg width="12" height="12" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.5" /><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" /></svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2.5" /></svg>
      )}
    </span>
  );
}
