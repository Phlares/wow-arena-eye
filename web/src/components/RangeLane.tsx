import { useState } from 'react';
import type { RangePoint, RangeTarget } from '../api.js';
import { classColor } from '../classColors.js';

const MELEE_YD = 8;

/** Distance-to-target over time, as an SVG line on the shared time axis. Null points break the
 *  line into separate segments (range was unknown — never interpolated through). When `targets`
 *  is given, a dropdown re-targets the lane to any player (default = the primary threat); the line
 *  takes the target's class color. Falls back to the plain `series` prop when no targets. */
export function RangeLane({ series, targets, matchEnd, maxYd = 40, label = 'Range to primary threat (yd)' }:
  { series?: RangePoint[]; targets?: RangeTarget[]; matchEnd: number; maxYd?: number; label?: string }) {
  // targets are sorted threat-first server-side, so targets[0] is the default selection.
  const [sel, setSel] = useState<string>(targets?.[0]?.unitId ?? '');
  // tolerate a stale selection from a previous match: fall back to the default target.
  const active = targets?.find((t) => t.unitId === sel) ?? targets?.[0];
  const data = active ? active.series : (series ?? []);
  const lineColor = active ? classColor(active.className) : undefined;

  const W = 1000, H = 60;
  const x = (t: number) => (t / matchEnd) * W;
  const y = (d: number) => H - (Math.min(d, maxYd) / maxYd) * H;
  const segs: string[] = [];
  let cur: string[] = [];
  for (const pStep of data) {
    if (pStep.dist === null) { if (cur.length) { segs.push(cur.join(' ')); cur = []; } }
    else cur.push(`${x(pStep.tSec)},${y(pStep.dist)}`);
  }
  if (cur.length) segs.push(cur.join(' '));

  return (
    <div className="tl-lane">
      <div className="tl-name">
        {targets && targets.length > 0 ? (
          <select className="range-target" aria-label="Range target" value={active?.unitId ?? ''} onChange={(e) => setSel(e.target.value)}>
            {targets.map((t) => (
              <option key={t.unitId} value={t.unitId}>Range to {t.name}{t.isPrimaryThreat ? ' ★' : ''}</option>
            ))}
          </select>
        ) : label}
      </div>
      <div className="tl-track">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="range-svg">
          <line className="melee-ref" x1={0} x2={W} y1={y(MELEE_YD)} y2={y(MELEE_YD)} />
          {segs.map((pts, i) => <polyline key={i} points={pts} fill="none" style={lineColor ? { stroke: lineColor } : undefined} />)}
        </svg>
      </div>
    </div>
  );
}
