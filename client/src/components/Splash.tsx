export function Splash({ title = 'Preparing demo data…', sub = 'Generating the synthetic health graph. This takes a few seconds.' }: { title?: string; sub?: string }) {
  return (
    <div className="splash">
      <div className="splash__box">
        <div className="spinner" />
        <div className="h2">{title}</div>
        <div className="sub">{sub}</div>
      </div>
    </div>
  );
}
