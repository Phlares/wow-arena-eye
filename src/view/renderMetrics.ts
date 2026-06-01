import { escapeHtml } from './html.js';
import type { MatchMetrics, PlayerGroup, TeamGroup, UnitMetrics, TimelineEvent, CoordinationSummary } from '../metrics/types.js';

const TEAM_LABEL: Record<string, string> = { friendly: 'Your team', enemy: 'Enemy team', neutral: 'Neutral' };

function tallyStr(t: { spellName: string; count: number }[]): string {
  return t.length ? t.map((x) => `${escapeHtml(x.spellName)}×${x.count}`).join(', ') : '—';
}

function unitRow(u: UnitMetrics, label: string): string {
  return `<tr><td>${escapeHtml(label)}${escapeHtml(u.name)}</td>` +
    `<td>${u.casts}</td><td>${u.interruptsLanded}${u.interruptsLandedBySpell.length ? ' (' + tallyStr(u.interruptsLandedBySpell) + ')' : ''}</td>` +
    `<td>${u.purges}/${u.cleanses}${u.purgesBySpell.length ? ' (' + tallyStr(u.purgesBySpell) + ')' : ''}</td>` +
    `<td>${u.spellsteals}</td><td>${u.deaths}</td><td>${u.distanceMoved} (${u.timeStationarySec}s still)</td>` +
    `<td>${u.damageDone}</td><td>${u.healingDone}</td>` +
    `<td>CC recv: ${u.ccReceived.timeSec}s (${u.ccReceived.castDenialSec}/${u.ccReceived.hardCcSec}/${u.ccReceived.rootSec})<br>` +
    `CC done: ${u.ccDone.timeSec}s (${u.ccDone.castDenialSec}/${u.ccDone.hardCcSec}/${u.ccDone.rootSec})<br>` +
    `immuned recv ${u.immuneReceived.ccImmuned}cc/${u.immuneReceived.damageImmuned}dmg · done ${u.immuneDone.ccImmuned}cc/${u.immuneDone.damageImmuned}dmg</td>` +
    `<td>${u.deathsWhileCcd}</td><td>${u.defensivesUsed}/${u.defensivesIntoBurst}</td></tr>`;
}

function playerGroupBlock(pg: PlayerGroup, isYou: boolean): string {
  const c = pg.combined;
  const head = `<tr class="pg-head"><td><b>${isYou ? '★ ' : ''}${escapeHtml(pg.player.name)}</b>${pg.player.spec ? ' (' + escapeHtml(pg.player.spec) + ')' : ''}${pg.pets.length ? ` [+${pg.pets.length} pet]` : ''}</td>` +
    `<td>${c.casts}</td><td>${c.interruptsLanded}${c.interruptsLandedBySpell.length ? ' (' + tallyStr(c.interruptsLandedBySpell) + ')' : ''}</td>` +
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
  <table><tr><th>unit</th><th>casts</th><th>interrupts</th><th>purge/cleanse</th><th>steals</th><th>deaths</th><th>move</th><th>dmg</th><th>heal</th><th>CC recv/done · immuned</th><th>died-CC</th><th>defensives (used/burst)</th></tr>${rows}</table>`;
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

export function metricsBlock(mm: MatchMetrics | undefined): string {
  if (!mm) return '';
  return `<h4>Metrics (per player)</h4>
  ${mm.teams.map((t) => teamBlock(t, mm.playerUnitId)).join('')}
  ${coordinationBlock(mm.coordination)}
  ${timelineBlock(mm.timeline)}`;
}
