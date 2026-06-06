import type { OffensiveWindow } from '../api.js';
import { fmtNum } from '../format.js';

function names(items: { name: string }[]): string {
  return items.length ? items.map((i) => i.name).join(', ') : '';
}

/** Breakdown for one GO window: severity, who took the damage, and mitigation available vs used. */
export function WindowPanel({ window: w, index }: { window: OffensiveWindow; index: number }) {
  return (
    <div className="win-panel">
      <div className="win-head">GO {index + 1} · {w.startSec}–{w.endSec}s · {fmtNum(w.teamDamageTaken)} dmg taken</div>
      {w.damageByTarget.length > 0 && (
        <div className="win-row"><span className="win-k">By target</span>
          <span>{w.damageByTarget.map((d) => `${d.name} ${fmtNum(d.damage)}`).join(' · ')}</span></div>
      )}
      <div className="win-row"><span className="win-k">Mitigation up</span>
        <span>{names(w.mitigation.available) || '—'}</span></div>
      <div className="win-row"><span className="win-k">Mitigation used</span>
        <span>{names(w.mitigation.used) || 'none used'}</span></div>
    </div>
  );
}
