import { eventType, srcId, destId, spellName, extraSpellName, auraType, eventTimeMs, matchStartMs, position, spellId, amount, hpPct } from './eventAccess.js';
import { tally, unitKind, unitTeam, type UnitMetrics, type Sample, type CcTakenEntry } from './types.js';
import { isDefensive, ccInfo } from '../metadata/spells.js';
import { type AuraState } from './auraState.js';
import { sampleAt } from './sampleAt.js';

interface Acc {
  casts: string[];
  interrupts: string[];
  purgesRemoved: string[];
  cleansesRemoved: string[];
  dispelsTotal: number;
  steals: string[];
  deathMs: number[];
  positions: { ms: number; x: number; y: number }[];
  interruptsSuffered: string[];
  ccTaken: { category: string }[];
  deathsWhileCcd: string[];
  defensives: { spell: string; ms: number }[];
  damageDone: number;
  healingDone: number;
  absorbDone: number;
  samples: Sample[];
}

function emptyAcc(): Acc {
  return {
    casts: [], interrupts: [], purgesRemoved: [], cleansesRemoved: [], dispelsTotal: 0,
    steals: [], deathMs: [], positions: [],
    interruptsSuffered: [], ccTaken: [], deathsWhileCcd: [], defensives: [],
    damageDone: 0, healingDone: 0, absorbDone: 0, samples: [],
  };
}

const STATIONARY_EPS = 0.5;

export function computeUnitMetrics(match: unknown, auras: AuraState): UnitMetrics[] {
  const m = match as { events?: unknown[]; units?: Record<string, Record<string, unknown>>; durationInSeconds?: unknown };
  const events = Array.isArray(m.events) ? m.events : [];
  const units = m.units ?? {};
  const startMs = matchStartMs(events);

  const teamOf = (id: string | undefined): string => unitTeam((units[id ?? ''] ?? {}).reaction);

  const accs = new Map<string, Acc>();
  const acc = (id: string): Acc => {
    let a = accs.get(id);
    if (!a) { a = emptyAcc(); accs.set(id, a); }
    return a;
  };

  for (const ev of events) {
    const t = eventType(ev);
    const s = srcId(ev);
    const d = destId(ev);
    const ms = eventTimeMs(ev);

    // Sample capture for position tracking
    if (s) {
      const p = position(ev);
      if (p && ms !== undefined && startMs !== undefined) {
        acc(s).samples.push({ tSec: (ms - startMs) / 1000, x: p.x, y: p.y, facing: p.facing, hpPct: hpPct(ev) });
      }
      // legacy positions for movement calculation
      if (p && ms !== undefined) acc(s).positions.push({ ms, x: p.x, y: p.y });
    }

    if (t === 'SPELL_CAST_SUCCESS' && s) {
      acc(s).casts.push(spellName(ev));
      if (isDefensive(spellId(ev))) acc(s).defensives.push({ spell: spellName(ev), ms: ms ?? 0 });
    } else if (t === 'SPELL_INTERRUPT' && s) {
      acc(s).interrupts.push(extraSpellName(ev) ?? spellName(ev));
      if (d) acc(d).interruptsSuffered.push(extraSpellName(ev) ?? spellName(ev));
    } else if (t === 'SPELL_DISPEL' && s) {
      acc(s).dispelsTotal += 1;
      const removed = extraSpellName(ev) ?? spellName(ev);
      if (auraType(ev) === 'BUFF') acc(s).purgesRemoved.push(removed);
      else if (auraType(ev) === 'DEBUFF') acc(s).cleansesRemoved.push(removed);
    } else if (t === 'SPELL_STOLEN' && s) {
      acc(s).steals.push(extraSpellName(ev) ?? spellName(ev));
    } else if (t === 'UNIT_DIED' && d) {
      acc(d).deathMs.push(ms ?? NaN);
      const active = auras.activeOn(d, ms ?? -1);
      const ccHit = active.find((a) => ccInfo(a.spellId));
      if (ccHit) acc(d).deathsWhileCcd.push(ccHit.name);
    }

    // CC taken tracking
    // Counts both APPLIED and REFRESH: a CC reapply restarts the DR clock (a new CC instance). Safe for the current curated CC set (no channel-sustained CCs that refresh as ticks).
    if ((t === 'SPELL_AURA_APPLIED' || t === 'SPELL_AURA_REFRESH') && d) {
      const cc = ccInfo(spellId(ev));
      if (cc) acc(d).ccTaken.push({ category: cc.category });
    }

    // Damage (enemy-only, exclude friendly fire)
    if (/^(SPELL_DAMAGE|SPELL_PERIODIC_DAMAGE|RANGE_DAMAGE|SWING_DAMAGE|SWING_DAMAGE_LANDED)$/.test(t) && s && teamOf(s) !== 'neutral' && teamOf(d) !== 'neutral' && teamOf(s) !== teamOf(d)) {
      acc(s).damageDone += amount(ev);
    }

    // Healing
    if ((t === 'SPELL_HEAL' || t === 'SPELL_PERIODIC_HEAL') && s) {
      acc(s).healingDone += amount(ev);
    }

    // Absorb (best-effort)
    if (t === 'SPELL_ABSORBED' && s) {
      acc(s).absorbDone += amount(ev);
    }
  }

  const durationSec = typeof m.durationInSeconds === 'number' ? m.durationInSeconds : 0;

  const result: UnitMetrics[] = [];
  for (const [id, a] of accs) {
    const u = units[id] ?? {};
    const samples = a.positions.sort((x, y) => x.ms - y.ms);
    let distance = 0;
    let stationarySec = 0;
    for (let i = 1; i < samples.length; i++) {
      const dx = samples[i].x - samples[i - 1].x;
      const dy = samples[i].y - samples[i - 1].y;
      const step = Math.sqrt(dx * dx + dy * dy);
      distance += step;
      if (step < STATIONARY_EPS) stationarySec += (samples[i].ms - samples[i - 1].ms) / 1000;
    }
    const ownerRaw = typeof u.ownerId === 'string' ? u.ownerId : undefined;

    const track = a.samples.sort((x, y) => x.tSec - y.tSec);
    const ccByCat = new Map<string, number>();
    for (const c of a.ccTaken) ccByCat.set(c.category, (ccByCat.get(c.category) ?? 0) + 1);

    let defensivesIntoBurst = 0;
    for (const def of a.defensives) {
      if (startMs === undefined) break;
      const tSec = (def.ms - startMs) / 1000;
      const before = sampleAt(track, tSec - 2)?.hpPct;
      const after = sampleAt(track, tSec + 1)?.hpPct;
      if (before !== undefined && after !== undefined && before - after >= 0.15) defensivesIntoBurst += 1;
    }

    result.push({
      unitId: id,
      name: typeof u.name === 'string' && u.name.length > 0 ? u.name : id,
      kind: unitKind(u.type),
      team: unitTeam(u.reaction),
      spec: u.spec !== undefined ? String(u.spec) : undefined,
      ownerId: ownerRaw && ownerRaw !== '0' && ownerRaw !== '0000000000000000' ? ownerRaw : undefined,
      casts: a.casts.length,
      topCasts: tally(a.casts).slice(0, 8),
      interruptsLanded: a.interrupts.length,
      interruptsLandedBySpell: tally(a.interrupts),
      dispels: a.dispelsTotal,
      purges: a.purgesRemoved.length,
      purgesBySpell: tally(a.purgesRemoved),
      cleanses: a.cleansesRemoved.length,
      cleansesBySpell: tally(a.cleansesRemoved),
      spellsteals: a.steals.length,
      spellstealsBySpell: tally(a.steals),
      deaths: a.deathMs.length,
      deathTimesSec: startMs !== undefined ? a.deathMs.filter((x) => !Number.isNaN(x)).map((x) => Math.round((x - startMs) / 1000)) : [],
      distanceMoved: Math.round(distance * 10) / 10,
      positionSamples: samples.length,
      timeStationarySec: Math.round(stationarySec * 10) / 10,
      track,
      interruptsSuffered: a.interruptsSuffered.length,
      interruptsSufferedBySpell: tally(a.interruptsSuffered),
      ccTaken: a.ccTaken.length,
      ccTakenByCategory: [...ccByCat.entries()].map(([category, count]) => ({ category, count, durationSec: 0 })) as CcTakenEntry[],
      deathsWhileCcd: a.deathsWhileCcd.length,
      deathsWhileCcdBySpell: tally(a.deathsWhileCcd),
      defensivesUsed: a.defensives.length,
      defensivesUsedBySpell: tally(a.defensives.map((def) => def.spell)),
      defensivesIntoBurst,
      damageDone: Math.round(a.damageDone),
      healingDone: Math.round(a.healingDone),
      absorbDone: Math.round(a.absorbDone),
      dps: durationSec > 0 ? Math.round(a.damageDone / durationSec) : 0,
      hps: durationSec > 0 ? Math.round(a.healingDone / durationSec) : 0,
    });
  }
  return result;
}
