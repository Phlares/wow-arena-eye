import { eventType, srcId, destId, spellName, extraSpellName, auraType, eventTimeMs, matchStartMs, position, spellId, amount, hpPct, absorbInfo, DAMAGE_EVENTS, immuneEvent } from './eventAccess.js';
import { tally, unitKind, unitTeam, ownerIdOf, resolvePlayer, type UnitMetrics, type Sample, type CcTakenEntry, type CcSide, type ImmuneSide, type DrCategory } from './types.js';
import { isDefensive, ccInfo, interruptLockoutSec } from '../metadata/spells.js';
import { type AuraState } from './auraState.js';
import { sampleAt } from './sampleAt.js';
import { computeCcDurations, type Window } from './ccTime.js';
import { ccReceivedSide, ccDoneSide, type LandedInterrupt } from './ccSides.js';

interface Acc {
  casts: string[];
  interruptsLandedDetail: { name: string; ms: number; spellId: number; targetId: string }[];
  purgesRemoved: string[];
  cleansesRemoved: string[];
  dispelsTotal: number;
  steals: string[];
  deathMs: number[];
  interruptsSuffered: { name: string; ms: number; spellId: number }[];
  ccTaken: { category: string }[];
  deathsWhileCcd: string[];
  defensives: { spell: string; ms: number }[];
  damageDone: number;
  healingDone: number;
  absorbDone: number;
  samples: Sample[];
  immuneDoneSpells: string[];
  immuneDoneCc: { category: DrCategory }[];
  immuneRecvSpells: string[];
  immuneRecvCc: { category: DrCategory }[];
}

function emptyAcc(): Acc {
  return {
    casts: [], interruptsLandedDetail: [], purgesRemoved: [], cleansesRemoved: [], dispelsTotal: 0,
    steals: [], deathMs: [],
    interruptsSuffered: [], ccTaken: [], deathsWhileCcd: [], defensives: [],
    damageDone: 0, healingDone: 0, absorbDone: 0, samples: [],
    immuneDoneSpells: [], immuneDoneCc: [], immuneRecvSpells: [], immuneRecvCc: [],
  };
}

const STATIONARY_EPS = 0.5;

export function computeUnitMetrics(match: unknown, auras: AuraState): UnitMetrics[] {
  const m = match as { events?: unknown[]; units?: Record<string, Record<string, unknown>>; durationInSeconds?: unknown };
  const events = Array.isArray(m.events) ? m.events : [];
  const units = m.units ?? {};
  const startMs = matchStartMs(events);
  let endMs = startMs ?? 0;

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
    if (ms !== undefined && ms > endMs) endMs = ms;

    // Sample capture for position tracking
    if (s) {
      const p = position(ev);
      if (p && ms !== undefined && startMs !== undefined) {
        acc(s).samples.push({ tSec: (ms - startMs) / 1000, x: p.x, y: p.y, facing: p.facing, hpPct: hpPct(ev) });
      }
    }

    if (t === 'SPELL_CAST_SUCCESS' && s) {
      acc(s).casts.push(spellName(ev));
      if (isDefensive(spellId(ev))) acc(s).defensives.push({ spell: spellName(ev), ms: ms ?? 0 });
    } else if (t === 'SPELL_INTERRUPT' && s) {
      acc(s).interruptsLandedDetail.push({ name: extraSpellName(ev) ?? spellName(ev), ms: ms ?? 0, spellId: spellId(ev) ?? 0, targetId: d ?? '' });
      if (d) acc(d).interruptsSuffered.push({ name: extraSpellName(ev) ?? spellName(ev), ms: ms ?? 0, spellId: spellId(ev) ?? 0 });
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

    // Damage (enemy-only, exclude friendly fire; dest may be neutral e.g. enemy summons)
    if (DAMAGE_EVENTS.test(t) && s && teamOf(s) !== 'neutral' && teamOf(s) !== teamOf(d)) {
      acc(s).damageDone += amount(ev);
    }

    // Healing
    if ((t === 'SPELL_HEAL' || t === 'SPELL_PERIODIC_HEAL') && s) {
      acc(s).healingDone += amount(ev);
    }

    // Absorbs: credit the shield owner (SPELL_ABSORBED.srcId is the attacker).
    if (t === 'SPELL_ABSORBED') {
      const info = absorbInfo(ev);
      if (info) acc(info.shieldOwnerId).absorbDone += info.amount;
    }

    // Immune events: route to both sides (kind is always 'spell' — no amount available).
    const imm = immuneEvent(ev);
    if (imm) {
      const isrc = resolvePlayer(units, imm.srcId);
      const idst = resolvePlayer(units, imm.destId);
      if (isrc && idst && teamOf(isrc) !== teamOf(idst)) {
        const cc = ccInfo(imm.spellId);
        acc(isrc).immuneDoneSpells.push(imm.spellName);
        acc(idst).immuneRecvSpells.push(imm.spellName);
        if (cc) { acc(isrc).immuneDoneCc.push({ category: cc.category }); acc(idst).immuneRecvCc.push({ category: cc.category }); }
      }
    }
  }

  const durationSec = typeof m.durationInSeconds === 'number' ? m.durationInSeconds : 0;

  const result: UnitMetrics[] = [];
  for (const [id, a] of accs) {
    const u = units[id] ?? {};

    const track = a.samples.sort((x, y) => x.tSec - y.tSec);
    let distance = 0;
    let stationarySec = 0;
    for (let i = 1; i < track.length; i++) {
      const dx = track[i].x - track[i - 1].x;
      const dy = track[i].y - track[i - 1].y;
      const step = Math.sqrt(dx * dx + dy * dy);
      distance += step;
      if (step < STATIONARY_EPS) stationarySec += track[i].tSec - track[i - 1].tSec;
    }
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

    const interruptWindows: Window[] = a.interruptsSuffered.map((x) => ({ start: x.ms, end: x.ms + interruptLockoutSec(x.spellId) * 1000 }));
    const cc = computeCcDurations(auras.intervalsOn(id), interruptWindows, endMs);

    const petIds = Object.keys(units).filter((uid) => ownerIdOf(units[uid]) === id);
    const ccReceived = ccReceivedSide(id, units, auras, a.interruptsSuffered, endMs);
    const ccDone = ccDoneSide(id, petIds, units, auras, a.interruptsLandedDetail, endMs);
    const immByCat = (list: { category: DrCategory }[]): ImmuneSide['ccImmunedByCategory'] => {
      const mm2 = new Map<DrCategory, number>();
      for (const c of list) mm2.set(c.category, (mm2.get(c.category) ?? 0) + 1);
      return [...mm2.entries()].map(([category, count]) => ({ category, count }));
    };
    const immuneReceived: ImmuneSide = { spellsImmuned: tally(a.immuneRecvSpells), ccImmuned: a.immuneRecvCc.length, ccImmunedByCategory: immByCat(a.immuneRecvCc), damageImmuned: 0, healingImmuned: 0 };
    const immuneDone: ImmuneSide = { spellsImmuned: tally(a.immuneDoneSpells), ccImmuned: a.immuneDoneCc.length, ccImmunedByCategory: immByCat(a.immuneDoneCc), damageImmuned: 0, healingImmuned: 0 };

    result.push({
      unitId: id,
      name: typeof u.name === 'string' && u.name.length > 0 ? u.name : id,
      kind: unitKind(u.type),
      team: unitTeam(u.reaction),
      spec: u.spec !== undefined ? String(u.spec) : undefined,
      ownerId: ownerIdOf(u),
      casts: a.casts.length,
      topCasts: tally(a.casts).slice(0, 8),
      interruptsLanded: a.interruptsLandedDetail.length,
      interruptsLandedBySpell: tally(a.interruptsLandedDetail.map((x) => x.name)),
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
      positionSamples: track.length,
      timeStationarySec: Math.round(stationarySec * 10) / 10,
      track,
      interruptsSuffered: a.interruptsSuffered.length,
      interruptsSufferedBySpell: tally(a.interruptsSuffered.map((x) => x.name)),
      ccTaken: a.ccTaken.length,
      ccTakenByCategory: [...ccByCat.entries()].map(([category, count]) => ({ category, count, durationSec: cc.byCategory.find((b) => b.category === category)?.durationSec ?? 0 })) as CcTakenEntry[],
      deathsWhileCcd: a.deathsWhileCcd.length,
      deathsWhileCcdBySpell: tally(a.deathsWhileCcd),
      defensivesUsed: a.defensives.length,
      defensivesUsedBySpell: tally(a.defensives.map((def) => def.spell)),
      defensivesIntoBurst,
      timeControlledSec: cc.timeControlledSec,
      castDenialSec: cc.castDenialSec,
      hardCcSec: cc.hardCcSec,
      rootSec: cc.rootSec,
      ccReceived,
      ccDone,
      immuneReceived,
      immuneDone,
      damageDone: Math.round(a.damageDone),
      healingDone: Math.round(a.healingDone),
      absorbDone: Math.round(a.absorbDone),
      dps: durationSec > 0 ? Math.round(a.damageDone / durationSec) : 0,
      hps: durationSec > 0 ? Math.round(a.healingDone / durationSec) : 0,
    });
  }
  return result;
}
