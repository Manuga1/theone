// "Behavior › Tobacco › Cigarettes" path chips used by the quick-log preview, the ingestion queue and the review box.
import { ChevronRight } from 'lucide-react';

export function ConceptPath({ path, leafOnly }: { path: string[]; leafOnly?: boolean }) {
  if (path.length === 0) return <span className="faint">—</span>;
  const segs = leafOnly ? path.slice(-1) : path;
  return (
    <span className="path">
      {segs.map((p, i) => (
        <span key={`${p}-${i}`} className="row gap-4" style={{ gap: 4 }}>
          {i > 0 && <ChevronRight />}
          <span className={i === segs.length - 1 ? 'path__leaf' : 'path__seg'}>{p}</span>
        </span>
      ))}
    </span>
  );
}
