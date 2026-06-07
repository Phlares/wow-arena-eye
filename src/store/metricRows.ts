import type { MatchMetrics, UnitMetrics, Team } from '../metrics/types.js';

export interface CombatantRow { unitId: string; name: string; spec: string; team: Team; isPlayer: boolean; }
export interface MetricRow { scope: string; metricId: string; value: number; }
export interface Extracted { combatants: CombatantRow[]; metrics: MetricRow[]; }

/** Declarative per-unit scalar metric extractors. Add a metric = add one entry.
 *  NOTE: ids consumed by the dataset_export view in schema.ts (its CASE columns) must
 *  stay in sync with the ids here. */
const UNIT_METRICS: { id: string; get: (u: UnitMetrics) => number; combine?: true }[] = [
  { id: 'casts', get: (u) => u.casts },
  { id: 'interruptsLanded', get: (u) => u.interruptsLanded, combine: true },
  { id: 'interruptsSuffered', get: (u) => u.interruptsSuffered },
  // Precognition uptime is player-only (never on a pet) — no combine.
  { id: 'precognitionUptimeSec', get: (u) => u.precognitionUptimeSec },
  { id: 'enemyPrecognitionUptimeSec', get: (u) => u.enemyPrecognitionUptimeSec },
  // null healer distance → NaN → dropped by the Number.isFinite guard (absent, not 0).
  { id: 'avgHealerDistanceYd', get: (u) => u.avgHealerDistanceYd ?? NaN },
  { id: 'dispels', get: (u) => u.dispels, combine: true },
  { id: 'purges', get: (u) => u.purges, combine: true },
  { id: 'cleanses', get: (u) => u.cleanses, combine: true },
  { id: 'spellsteals', get: (u) => u.spellsteals, combine: true },
  { id: 'deaths', get: (u) => u.deaths },
  { id: 'deathsWhileCcd', get: (u) => u.deathsWhileCcd },
  { id: 'distanceMoved', get: (u) => u.distanceMoved },
  { id: 'positionSamples', get: (u) => u.positionSamples },
  { id: 'timeStationarySec', get: (u) => u.timeStationarySec },
  { id: 'defensivesUsed', get: (u) => u.defensivesUsed },
  { id: 'defensivesIntoBurst', get: (u) => u.defensivesIntoBurst },
  // Throughput stays player-only: combining pet damage/healing here would change long-standing
  // numbers and risk double-counting — only pet-performed ACTIONS (above) roll up to the owner.
  { id: 'damageDone', get: (u) => u.damageDone },
  { id: 'healingDone', get: (u) => u.healingDone },
  { id: 'absorbDone', get: (u) => u.absorbDone },
  { id: 'dps', get: (u) => u.dps },
  { id: 'hps', get: (u) => u.hps },
  { id: 'spacing.meleeRangeSec', get: (u) => u.spacing.meleeRangeSec },
  { id: 'spacing.isolatedSec', get: (u) => u.spacing.isolatedSec },
  { id: 'ccDone.timeSec', get: (u) => u.ccDone.timeSec },
  { id: 'ccDone.castDenialSec', get: (u) => u.ccDone.castDenialSec },
  { id: 'ccDone.hardCcSec', get: (u) => u.ccDone.hardCcSec },
  { id: 'ccDone.rootSec', get: (u) => u.ccDone.rootSec },
  { id: 'ccDone.count', get: (u) => u.ccDone.count },
  { id: 'ccReceived.timeSec', get: (u) => u.ccReceived.timeSec },
  { id: 'ccReceived.castDenialSec', get: (u) => u.ccReceived.castDenialSec },
  { id: 'ccReceived.hardCcSec', get: (u) => u.ccReceived.hardCcSec },
  { id: 'ccReceived.rootSec', get: (u) => u.ccReceived.rootSec },
  { id: 'ccReceived.count', get: (u) => u.ccReceived.count },
  { id: 'immuneDone.ccImmuned', get: (u) => u.immuneDone.ccImmuned },
  { id: 'immuneReceived.ccImmuned', get: (u) => u.immuneReceived.ccImmuned },
];

/** Flatten MatchMetrics into combatant identity rows + (scope, metric_id, value) tuples. */
export function extractMetricRows(metrics: MatchMetrics, playerUnitId: string | undefined): Extracted {
  const combatants: CombatantRow[] = [];
  const rows: MetricRow[] = [];
  for (const tg of metrics.teams) {
    for (const pg of tg.players) {
      const u = pg.player;
      combatants.push({ unitId: u.unitId, name: u.name, spec: u.spec ?? '', team: tg.team, isPlayer: u.unitId === playerUnitId });
      for (const ex of UNIT_METRICS) {
        const petSum = ex.combine
          ? pg.pets.reduce((acc, p) => { const pv = ex.get(p); return acc + (Number.isFinite(pv) ? pv : 0); }, 0)
          : 0;
        const v = ex.get(u) + petSum;
        if (typeof v === 'number' && Number.isFinite(v)) rows.push({ scope: u.unitId, metricId: ex.id, value: v });
      }
    }
  }
  for (const c of metrics.coordination) {
    const scope = `team:${c.team}`;
    const s = c.summary;
    rows.push({ scope, metricId: 'alignmentFraction', value: s.alignmentFraction });
    rows.push({ scope, metricId: 'alignedTimeSec', value: s.alignedTimeSec });
    rows.push({ scope, metricId: 'swaps', value: s.swaps });
    rows.push({ scope, metricId: 'healerPressureDamage', value: s.healerPressureDamage });
  }
  return { combatants, metrics: rows };
}

/** Sorted, '_'-joined spec signatures per side (deterministic, so "same comp" is string equality). */
export function compSignatures(combatants: CombatantRow[]): { ally: string; enemy: string } {
  const sig = (team: Team) => combatants.filter((c) => c.team === team).map((c) => c.spec).sort().join('_');
  return { ally: sig('friendly'), enemy: sig('enemy') };
}
