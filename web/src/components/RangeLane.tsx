import type { RangePoint } from '../api.js';

const MELEE_YD = 8;

/** Distance-to-primary-threat over time, as an SVG line on the shared time axis. Null points
 *  break the line into separate segments (range was unknown — never interpolated through). */
export function RangeLane({ series, matchEnd, maxYd = 40, label = 'Range to primary threat (yd)' }: { series: RangePoint[]; matchEnd: number; maxYd?: number; label?: string }) {
  const W = 1000, H = 60;
  const x = (t: number) => (t / matchEnd) * W;
  const y = (d: number) => H - (Math.min(d, maxYd) / maxYd) * H;
  const segs: string[] = [];
  let cur: string[] = [];
  for (const pStep of series) {
    if (pStep.dist === null) { if (cur.length) { segs.push(cur.join(' ')); cur = []; } }
    else cur.push(`${x(pStep.tSec)},${y(pStep.dist)}`);
  }
  if (cur.length) segs.push(cur.join(' '));
  return (
    <div className="tl-lane">
      <div className="tl-name">{label}</div>
      <div className="tl-track">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="range-svg">
          <line className="melee-ref" x1={0} x2={W} y1={y(MELEE_YD)} y2={y(MELEE_YD)} />
          {segs.map((pts, i) => <polyline key={i} points={pts} fill="none" />)}
        </svg>
      </div>
    </div>
  );
}
