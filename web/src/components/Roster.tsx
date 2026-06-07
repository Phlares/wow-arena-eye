import type { RosterEntry } from '../api.js';
import { classColor } from '../classColors.js';

function chip(r: RosterEntry) {
  return (
    <span key={`${r.team}-${r.name}`} className={`roster-chip ${r.isHealer ? 'healer' : ''}`} style={{ color: classColor(r.className) }}>
      {r.name} <span className="roster-spec">{r.specLabel}{r.isHealer ? ' ✚' : ''}</span>
    </span>
  );
}

/** Both teams' combatants as class-colored chips (name + spec); the healer is marked. */
export function Roster({ roster }: { roster: RosterEntry[] }) {
  const team = (t: string) => roster.filter((r) => r.team === t);
  return (
    <div className="roster">
      <div className="roster-team"><span className="roster-lbl">You</span>{team('friendly').map(chip)}</div>
      <div className="roster-team"><span className="roster-lbl">Enemy</span>{team('enemy').map(chip)}</div>
    </div>
  );
}
