// One-shot verification of the offensive-CD fidelity work against the re-ingested store.
// Usage: node --experimental-sqlite scripts/verify-go-fidelity.mjs [matchIdPrefix]
// Prints, for the target match (default ea8b4f49): per-attacker GO segments (spell + interval)
// and per-window attackerOffenseAvailableCount, so Shadowstep pruning / Soul Rot / pet windows /
// favor inputs can be eyeballed without the viewer.
import { DatabaseSync } from 'node:sqlite';

const prefix = process.argv[2] ?? 'ea8b4f49';
const db = new DatabaseSync('./wow-arena-eye.local.db');
const row = db.prepare("SELECT match_id, metrics_json FROM match_detail WHERE match_id LIKE ?").get(`${prefix}%`);
if (!row) { console.error(`no match_detail for prefix ${prefix}`); process.exit(1); }
const m = JSON.parse(row.metrics_json);
console.log(`match ${row.match_id}`);
console.log('\n— attackerGoTracks —');
for (const t of m.attackerGoTracks ?? []) {
  const segs = t.intervals.map((iv) => `${iv.spell ?? '?'} ${iv.startSec}-${iv.endSec}s`).join(' | ') || '(none)';
  console.log(`${t.team.padEnd(8)} ${t.name}: [${t.intervals.length}] ${segs}`);
}
console.log('\n— offensiveWindows —');
for (const w of m.offensiveWindows ?? []) {
  const opened = (w.openedBy ?? []).map((o) => o.spellName).join(', ');
  console.log(`${w.attackingTeam.padEnd(8)} ${w.startSec}-${w.endSec}s atkOffenseAvail=${w.attackerOffenseAvailableCount} defUp=${w.mitigation?.available?.length} openedBy: ${opened}`);
}
