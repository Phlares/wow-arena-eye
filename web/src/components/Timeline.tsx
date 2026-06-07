import type { MatchDetail, DetailTimelineEvent } from '../api.js';
import { RangeLane } from './RangeLane.js';
import { GoTracks } from './GoTracks.js';

/** Per-lane: how a timeline event maps to a marker class in that lane (null = not in this lane). */
const LANES: { key: string; label: string; pick: (e: DetailTimelineEvent, playerId?: string) => string | null }[] = [
  { key: 'cast', label: 'You · casts', pick: (e, p) => (e.kind === 'cast' && e.unitId === p ? 'cast' : null) },
  { key: 'kickLanded', label: 'Kicks landed', pick: (e, p) => (e.kind === 'interrupt' && e.unitId === p ? 'kick' : null) },
  { key: 'kickTaken', label: 'Kicks taken', pick: (e, p) => (e.kind === 'interrupt' && e.targetId === p ? 'kicked' : null) },
  { key: 'cc', label: 'CC', pick: (e, p) => (e.kind === 'cc' ? (e.unitId === p ? 'cc' : e.targetId === p ? 'ccd' : null) : null) },
  { key: 'death', label: 'Deaths', pick: (e) => (e.kind === 'death' ? 'death' : null) },
];

export function Timeline({ detail, onSelectWindow }: { detail: MatchDetail; onSelectWindow: (i: number) => void }) {
  const { timeline, offensiveWindows: wins, playerUnitId: p } = detail.metrics;
  const matchEnd = Math.max(1, ...timeline.map((e) => e.tSec), ...wins.map((w) => w.endSec), ...detail.rangeSeries.map((r) => r.tSec));
  const pct = (t: number) => `${(t / matchEnd) * 100}%`;
  return (
    <div className="tl">
      <div className="tl-bands">
        {wins.map((w, i) => {
          const ours = w.attackingTeam === 'friendly';
          return (
          <div key={i} data-testid={`go-band-${i}`} className={`go-band ${ours ? 'friendly-go' : 'enemy-go'}`}
            style={{ left: pct(w.startSec), width: `${((w.endSec - w.startSec) / matchEnd) * 100}%` }}
            onClick={() => onSelectWindow(i)} title={`GO ${i + 1} · ${ours ? 'our offense' : 'enemy offense'}`}>
            <span className="go-lbl">GO {i + 1}</span>
          </div>
          );
        })}
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
      <div className="tl-lane">
        <div className="tl-name">LoS / smoke</div>
        <div className="tl-track">
          {detail.metrics.losDisruptors.map((d, k) => (
            <span key={k} className="ev los" style={{ left: pct(d.startSec ?? 0) }} title={`${d.kind ?? 'LoS'} · ${d.startSec ?? 0}s`} />
          ))}
        </div>
      </div>
      <GoTracks tracks={detail.goTracks} matchEnd={matchEnd} />
      <RangeLane series={detail.rangeSeries} targets={detail.rangeTargets} matchEnd={matchEnd} />
    </div>
  );
}
