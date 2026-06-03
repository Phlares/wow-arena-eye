import { escapeHtml } from './html.js';
import type { MatchMetrics, PlayerGroup, TeamGroup, UnitMetrics, TimelineEvent, CoordinationSummary } from '../metrics/types.js';

const TEAM_LABEL: Record<string, string> = { friendly: 'Your team', enemy: 'Enemy team', neutral: 'Neutral' };

function tallyStr(t: { spellName: string; count: number }[]): string {
  return t.length ? t.map((x) => `${escapeHtml(x.spellName)}×${x.count}`).join(', ') : '—';
}

const optTally = (t: { spellName: string; count: number }[]): string => (t.length ? ' (' + tallyStr(t) + ')' : '');

function cdUsageStr(cds: UnitMetrics['cdUsage']): string {
  const def = cds.filter((c) => c.category === 'defensive' || c.category === 'external' || c.category === 'trinket');
  if (!def.length) return '—';
  return def.map((c) => `${escapeHtml(c.name)}×${c.casts} (avail ${c.availableSec}s)`).join(', ');
}

function unitRow(u: UnitMetrics, label: string): string {
  return `<tr><td>${escapeHtml(label)}${escapeHtml(u.name)}</td>` +
    `<td>${u.casts}</td><td>${u.interruptsLanded}${optTally(u.interruptsLandedBySpell)}</td>` +
    `<td>${u.purges}/${u.cleanses}${optTally(u.purgesBySpell)}</td>` +
    `<td>${u.spellsteals}</td><td>${u.deaths}</td>` +
    `<td>${u.distanceMoved} (${u.timeStationarySec}s still)<br>melee ${u.spacing.meleeRangeSec}s · iso ${u.spacing.isolatedSec}s</td>` +
    `<td>${u.damageDone}</td><td>${u.healingDone}</td>` +
    `<td>CC recv: ${u.ccReceived.timeSec}s (${u.ccReceived.castDenialSec}/${u.ccReceived.hardCcSec}/${u.ccReceived.rootSec})<br>` +
    `CC done: ${u.ccDone.timeSec}s (${u.ccDone.castDenialSec}/${u.ccDone.hardCcSec}/${u.ccDone.rootSec})<br>` +
    `immuned recv ${u.immuneReceived.ccImmuned}cc${u.immuneReceived.spellsImmuned.length ? ' · spells: ' + tallyStr(u.immuneReceived.spellsImmuned) : ''} · ` +
    `done ${u.immuneDone.ccImmuned}cc${u.immuneDone.spellsImmuned.length ? ' · spells: ' + tallyStr(u.immuneDone.spellsImmuned) : ''}</td>` +
    `<td>${u.deathsWhileCcd}</td><td>${cdUsageStr(u.cdUsage)}</td></tr>`;
}

function playerGroupBlock(pg: PlayerGroup, isYou: boolean): string {
  const c = pg.combined;
  const head = `<tr class="pg-head"><td><b>${isYou ? '★ ' : ''}${escapeHtml(pg.player.name)}</b>${pg.player.spec ? ' (' + escapeHtml(pg.player.spec) + ')' : ''}${pg.pets.length ? ` [+${pg.pets.length} pet]` : ''}</td>` +
    `<td>${c.casts}</td><td>${c.interruptsLanded}${optTally(c.interruptsLandedBySpell)}</td>` +
    `<td>${c.purges}/${c.cleanses}</td><td>${c.spellsteals}</td><td>${c.deaths}</td><td></td>` +
    `<td>${c.damageDone}</td><td>${c.healingDone}</td><td></td><td></td><td></td></tr>`;
  const own = unitRow(pg.player, '↳ self: ');
  const pets = pg.pets.map((p) => unitRow(p, '↳ pet: ')).join('');
  return head + own + pets;
}

function teamBlock(tg: TeamGroup, playerUnitId: string | undefined): string {
  const rows = tg.players.map((pg) => playerGroupBlock(pg, pg.player.unitId === playerUnitId)).join('') +
    tg.unownedPets.map((p) => unitRow(p, '(unowned) ')).join('');
  return `<h5>${escapeHtml(TEAM_LABEL[tg.team] ?? tg.team)}</h5>
  <table><tr><th>unit</th><th>casts</th><th>interrupts</th><th>purge/cleanse</th><th>steals</th><th>deaths</th><th>move</th><th>dmg</th><th>heal</th><th>CC recv/done · immuned</th><th>died-CC</th><th>defensives (cast / up)</th></tr>${rows}</table>`;
}

function timelineBlock(tl: TimelineEvent[]): string {
  if (!tl.length) return '';
  const rows = tl.map((e) => `<tr><td>${e.tSec}s</td><td>${escapeHtml(e.unitName)}</td><td>${escapeHtml(e.kind)}</td><td>${escapeHtml(e.spell ?? '')}${e.extra ? ' → ' + escapeHtml(e.extra) : ''}</td></tr>`).join('');
  return `<details><summary>spell-use timeline (${tl.length} events)</summary>
  <table><tr><th>t</th><th>unit</th><th>action</th><th>spell</th></tr>${rows}</table></details>`;
}

function attackerFocusRows(af: CoordinationSummary['attackerFocus']): string {
  if (!af?.length) return '';
  const rows = af.map((a) => `<tr><td>${escapeHtml(a.attackerName)}</td><td>${a.swaps}</td><td>${escapeHtml(a.topTarget ?? '—')}</td><td>${a.topTargetSec}s</td><td>${a.engagedSec}s</td></tr>`).join('');
  return `<details><summary>per-attacker focus</summary>
  <table><tr><th>player</th><th>swaps</th><th>top target</th><th>on target</th><th>engaged</th></tr>${rows}</table></details>`;
}

function coordinationBlock(coord: MatchMetrics['coordination']): string {
  if (!coord?.length) return '';
  return coord.map((c) => {
    const s = c.summary;
    return `<p class="coord">${escapeHtml(TEAM_LABEL[c.team] ?? c.team)} coordination — swaps: ${s.swaps}, alignment: ${Math.round(s.alignmentFraction * 100)}% (${s.alignedTimeSec}s), top target: ${escapeHtml(s.topFocusTarget ?? '—')}, healer pressure: ${s.healerPressureDamage}</p>${attackerFocusRows(s.attackerFocus)}`;
  }).join('');
}

/** One offensive window's positioning cell: threat distance (start→min), healer/spread, and
 *  an escape indicator. Distances are numeric (no escaping needed); '—' for unresolved fields. */
function positioningCell(p: MatchMetrics['offensiveWindows'][number]['positioning']): string {
  if (!p) return '—';
  const escape = p.escape ? ` · escape ${p.escape.anchorPlaced ? '✓' : '✗'}${p.escape.escapeAvailable ? '(rdy)' : ''}` : '';
  return `threat ${p.threatDistanceStartYd ?? '—'}→${p.threatDistanceMinYd ?? '—'}y · heal ${p.nearestHealerYd ?? '—'}y · spread ${p.teamSpreadYd ?? '—'}y${escape}`;
}

function offensiveWindowsBlock(windows: MatchMetrics['offensiveWindows']): string {
  if (!windows?.length) return '';
  const rows = windows
    .slice()
    .sort((a, b) => b.teamDamageTaken - a.teamDamageTaken)
    .map((w) => {
      const openers = w.openedBy.map((o) => escapeHtml(o.spellName)).join(', ');
      const used = w.mitigation.used.length;
      const avail = w.mitigation.available.length;
      const cc = w.counterPlay.ccOnDefenders.length;
      const imm = w.counterPlay.threatImmuneAuras.length;
      return `<tr><td>${w.startSec}-${w.endSec}s</td><td>${escapeHtml(TEAM_LABEL[w.attackingTeam] ?? w.attackingTeam)}</td>` +
        `<td>${openers}</td><td>${w.teamDamageTaken}</td><td>${used}/${avail}</td><td>${cc}${imm ? ` · immune:${imm}` : ''}</td><td>${positioningCell(w.positioning)}</td></tr>`;
    })
    .join('');
  return `<details><summary>offensive windows (${windows.length})</summary>
  <table><tr><th>t</th><th>attacker</th><th>opened by</th><th>dmg taken</th><th>mit CDs used/ready</th><th>counter</th><th>positioning</th></tr>${rows}</table></details>`;
}

export function metricsBlock(mm: MatchMetrics | undefined): string {
  if (!mm) return '';
  return `<h4>Metrics (per player)</h4>
  ${mm.teams.map((t) => teamBlock(t, mm.playerUnitId)).join('')}
  ${coordinationBlock(mm.coordination)}
  ${offensiveWindowsBlock(mm.offensiveWindows)}
  ${timelineBlock(mm.timeline)}`;
}
