import { useState } from 'react';
import type { RangePoint, RangeTarget } from '../api.js';
import { classColor } from '../classColors.js';
import { TimeSeriesChart, type ChartSeries } from './TimeSeriesChart.js';

const CUTOFFS = [
  { value: 8, label: '8 melee' }, { value: 10, label: '10' }, { value: 20, label: '20' },
  { value: 30, label: '30' }, { value: 40, label: '40' },
];
const ANCHOR_COLOR = '#9aa2b1';

const colorOf = (t: RangeTarget): string => (t.className ? classColor(t.className) ?? ANCHOR_COLOR : ANCHOR_COLOR);

/** The range track: a spacious multi-select chart of the player's distance to any set of targets
 *  (other players + the Demon Circle anchor), superimposed in class colors over dotted yardage
 *  cut-offs — so kiting direction (toward my healer, away from melee) reads at a glance. Falls
 *  back to the plain primary-threat series for matches stored before re-targetable ranges. */
export function RangeTrack({ targets, series, matchEnd }:
  { targets?: RangeTarget[]; series?: RangePoint[]; matchEnd: number }) {
  const ts = targets ?? [];
  // targets are sorted threat-first server-side, so the default selection is the primary threat.
  const [sel, setSel] = useState<Set<string>>(() => new Set(ts.length ? [ts[0].unitId] : []));
  const toggle = (id: string): void => {
    setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const toPoints = (pts: RangePoint[]): { tSec: number; v: number | null }[] =>
    pts.map((p) => ({ tSec: p.tSec, v: p.dist }));
  const charted: ChartSeries[] = ts.length
    ? ts.filter((t) => sel.has(t.unitId)).map((t) => ({ id: t.unitId, label: t.name, color: colorOf(t), points: toPoints(t.series) }))
    : [{ id: 'primary', label: 'Primary threat', points: toPoints(series ?? []) }];
  return (
    <div className="range-track">
      <div className="range-track-head">
        <span className="range-track-title">Range (yd)</span>
        {ts.map((t) => (
          <button key={t.unitId} className="range-chip" aria-pressed={sel.has(t.unitId)} onClick={() => toggle(t.unitId)}
            style={sel.has(t.unitId) ? { borderColor: colorOf(t), color: colorOf(t) } : undefined}>
            {t.name}{t.isPrimaryThreat ? ' ★' : ''}{t.isHealer ? ' ✚' : ''}
          </button>
        ))}
      </div>
      <div className="range-track-body">
        <TimeSeriesChart series={charted} thresholds={CUTOFFS} matchEnd={matchEnd} yMax={44} unit="yd" />
      </div>
    </div>
  );
}
