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
    `<td>${u.damageDone}</td><td>${u.healingDone}</td><td>${u.ccTaken}</td><td>${u.deathsWhileCcd}</td><td>${u.defensivesUsed}/${u.defensivesIntoBurst}</td></tr>`;
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
  <table><tr><th>unit</th><th>casts</th><th>interrupts</th><th>purge/cleanse</th><th>steals</th><th>deaths</th><th>move</th><th>dmg</th><th>heal</th><th>ccTaken</th><th>died-CC</th><th>def(u/burst)</th></tr>${rows}</table>`;
}

function timelineBlock(tl: TimelineEvent[]): string {
  if (!tl.length) return '';
  const rows = tl.map((e) => `<tr><td>${e.tSec}s</td><td>${escapeHtml(e.unitName)}</td><td>${escapeHtml(e.kind)}</td><td>${escapeHtml(e.spell ?? '')}${e.extra ? ' → ' + escapeHtml(e.extra) : ''}</td></tr>`).join('');
  return `<details><summary>spell-use timeline (${tl.length} events)</summary>
  <table><tr><th>t</th><th>unit</th><th>action</th><th>spell</th></tr>${rows}</table></details>`;
}

function coordinationBlock(coord: MatchMetrics['coordination']): string {
  if (!coord?.length) return '';
  return coord.map((c) => `<p class="coord">${escapeHtml(c.team)} coordination — focus-fire windows: ${c.summary.focusFireWindows}, top target: ${escapeHtml(c.summary.topFocusTarget ?? '—')}, healer pressure: ${c.summary.healerPressureDamage}, swaps: ${c.summary.swaps}</p>`).join('');
}

export function metricsBlock(mm: MatchMetrics | undefined): string {
  if (!mm) return '';
  return `<h4>Metrics (per player)</h4>
  ${mm.teams.map((t) => teamBlock(t, mm.playerUnitId)).join('')}
  ${coordinationBlock(mm.coordination)}
  ${timelineBlock(mm.timeline)}`;
}
