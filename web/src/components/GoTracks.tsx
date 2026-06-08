import type { GoTrack } from '../api.js';
import { classColor } from '../classColors.js';

/** Per-attacker GO tracks on the shared time axis: enemy attackers on top, yours below, each a
 *  class-colored line filled across that attacker's offensive (GO) intervals. Two lit enemy rows
 *  at the same time = both enemies going. */
export function GoTracks({ tracks, matchEnd }: { tracks: GoTrack[]; matchEnd: number }) {
  const ts = tracks ?? [];
  const ordered = [...ts.filter((t) => t.team === 'enemy'), ...ts.filter((t) => t.team === 'friendly')];
  const pct = (t: number) => `${(t / matchEnd) * 100}%`;
  return (
    <div className="go-tracks">
      {ordered.map((t) => (
        <div key={`${t.team}-${t.unitId}`} className="go-track">
          <div className="tl-name" style={{ color: classColor(t.className) }}>{t.name}</div>
          <div className="tl-track">
            {t.intervals.map((iv, j) => (
              <span key={j} className="go-seg" title={`${t.name}${iv.spell ? ` · ${iv.spell}` : ''} · ${iv.startSec}–${iv.endSec}s`}
                style={{ left: pct(iv.startSec), width: pct(iv.endSec - iv.startSec), background: classColor(t.className) }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
