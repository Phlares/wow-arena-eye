import { useState } from 'react';

export interface ChartPoint { tSec: number; v: number | null }
export interface ChartSeries { id: string; label: string; color?: string; points: ChartPoint[] }
export interface ChartThreshold { value: number; label: string }

interface HoverEntry { label: string; color?: string; v: number; tSec: number }
interface Hover { tSec: number; xFrac: number; entries: HoverEntry[] }

const W = 1000;

/** Generic over-time chart primitive: superimposed series (null points break a line into separate
 *  segments — never interpolated through), labeled dotted threshold lines, and a hover readout
 *  that snaps each series to its nearest data point at-or-before the cursor. Reused for range
 *  today and DPS-over-time style metrics later — nothing domain-specific lives here. */
export function TimeSeriesChart({ series, thresholds = [], matchEnd, yMax, height = 220, unit = '' }:
  { series: ChartSeries[]; thresholds?: ChartThreshold[]; matchEnd: number; yMax: number; height?: number; unit?: string }) {
  const [hover, setHover] = useState<Hover | null>(null);
  const H = height;
  const x = (t: number) => (t / matchEnd) * W;
  const y = (v: number) => H - (Math.min(v, yMax) / yMax) * H;
  const yPct = (v: number) => `${(1 - Math.min(v, yMax) / yMax) * 100}%`;

  const segsOf = (s: ChartSeries): string[] => {
    const segs: string[] = [];
    let cur: string[] = [];
    for (const p of s.points) {
      if (p.v === null) { if (cur.length) { segs.push(cur.join(' ')); cur = []; } }
      else cur.push(`${x(p.tSec)},${y(p.v)}`);
    }
    if (cur.length) segs.push(cur.join(' '));
    return segs;
  };

  const onMove = (e: React.MouseEvent<HTMLDivElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const xFrac = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    const t = xFrac * matchEnd;
    const entries: HoverEntry[] = [];
    for (const s of series) {
      let last: ChartPoint | undefined;
      for (const p of s.points) { if (p.tSec <= t) last = p; else break; }
      if (last && last.v !== null) entries.push({ label: s.label, color: s.color, v: last.v, tSec: last.tSec });
    }
    setHover({ tSec: t, xFrac, entries });
  };

  return (
    <div className="ts-chart" style={{ height: H }}>
      {thresholds.map((th) => (
        <span key={th.value} className="ts-threshold-lbl" style={{ top: yPct(th.value) }}>{th.label}</span>
      ))}
      <div className="ts-hover" data-testid="ts-hover" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="ts-svg">
          {thresholds.map((th) => (
            <line key={th.value} className="ts-threshold" x1={0} x2={W} y1={y(th.value)} y2={y(th.value)} strokeDasharray="4 6" />
          ))}
          {series.map((s) => segsOf(s).map((pts, i) => (
            <polyline key={`${s.id}-${i}`} points={pts} fill="none" style={s.color ? { stroke: s.color } : undefined} />
          )))}
        </svg>
        {hover && (
          <>
            <div className="ts-cursor" style={{ left: `${hover.xFrac * 100}%` }} />
            <div className="ts-tooltip" data-testid="ts-tooltip" style={{ left: `${Math.min(hover.xFrac * 100, 80)}%` }}>
              <div className="ts-tooltip-t">{hover.tSec.toFixed(1)}s</div>
              {hover.entries.map((en) => (
                <div key={en.label} className="ts-tooltip-row">
                  <span className="ts-dot" style={en.color ? { background: en.color } : undefined} />
                  {en.label}: {Math.round(en.v * 10) / 10} {unit} ({en.tSec}s)
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
