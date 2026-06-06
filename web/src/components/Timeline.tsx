import type { MatchDetail, DetailTimelineEvent } from '../api.js';

/** Per-lane: how a timeline event maps to a marker class in that lane (null = not in this lane). */
const LANES: { key: string; label: string; pick: (e: DetailTimelineEvent, playerId?: string) => string | null }[] = [
  { key: 'cast', label: 'You · casts', pick: (e, p) => (e.kind === 'cast' && e.unitId === p ? 'cast' : null) },
  { key: 'kick', label: 'Kicks', pick: (e, p) => (e.kind === 'interrupt' ? (e.unitId === p ? 'kick' : e.targetId === p ? 'kicked' : null) : null) },
  { key: 'cc', label: 'CC', pick: (e, p) => (e.kind === 'cc' ? (e.unitId === p ? 'cc' : e.targetId === p ? 'ccd' : null) : null) },
  { key: 'death', label: 'Deaths', pick: (e) => (e.kind === 'death' ? 'death' : null) },
];

export function Timeline({ detail, onSelectWindow }: { detail: MatchDetail; onSelectWindow: (i: number) => void }) {
  const { timeline, offensiveWindows: wins, playerUnitId: p } = detail.metrics;
  const matchEnd = Math.max(1, ...timeline.map((e) => e.tSec), ...wins.map((w) => w.endSec), ...detail.rangeSeries.map((r) => r.tSec));
  const pct = (t: number) => `${(t / matchEnd) * 100}%`;
  const lethal = (w: { startSec: number; endSec: number }) => timeline.some((e) => e.kind === 'death' && e.tSec >= w.startSec && e.tSec <= w.endSec);
  return (
    <div className="tl">
      <div className="tl-bands">
        {wins.map((w, i) => (
          <div key={i} data-testid={`go-band-${i}`} className={`go-band ${lethal(w) ? 'lethal' : 'handled'}`}
            style={{ left: pct(w.startSec), width: `${((w.endSec - w.startSec) / matchEnd) * 100}%` }}
            onClick={() => onSelectWindow(i)} title={`GO ${i + 1}`}>
            <span className="go-lbl">GO {i + 1}</span>
          </div>
        ))}
      </div>
      {LANES.map((lane) => (
        <div key={lane.key} className="tl-lane">
          <div className="tl-name">{lane.label}</div>
          <div className="tl-track">
            {timeline.map((e, j) => {
              const c = lane.pick(e, p);
              return c ? <span key={j} className={`ev ${c}`} style={{ left: pct(e.tSec) }} title={`${e.unitName} · ${e.spell ?? ''} · ${e.tSec}s`} /> : null;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
