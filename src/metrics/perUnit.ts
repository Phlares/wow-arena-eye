import { eventType, srcId, destId, spellName, extraSpellName, auraType, eventTimeMs, matchStartMs, position } from './eventAccess.js';
import { tally, unitKind, unitTeam, type UnitMetrics } from './types.js';

interface Acc {
  casts: string[];
  interrupts: string[];
  purgesRemoved: string[];
  cleansesRemoved: string[];
  dispelsTotal: number;
  steals: string[];
  deathMs: number[];
  positions: { ms: number; x: number; y: number }[];
}

function emptyAcc(): Acc {
  return { casts: [], interrupts: [], purgesRemoved: [], cleansesRemoved: [], dispelsTotal: 0, steals: [], deathMs: [], positions: [] };
}

const STATIONARY_EPS = 0.5;

export function computeUnitMetrics(match: unknown): UnitMetrics[] {
  const m = match as { events?: unknown[]; units?: Record<string, Record<string, unknown>> };
  const events = Array.isArray(m.events) ? m.events : [];
  const units = m.units ?? {};
  const startMs = matchStartMs(events);

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

    if (s) {
      const p = position(ev);
      if (p && ms !== undefined) acc(s).positions.push({ ms, x: p.x, y: p.y });
    }

    if (t === 'SPELL_CAST_SUCCESS' && s) acc(s).casts.push(spellName(ev));
    else if (t === 'SPELL_INTERRUPT' && s) acc(s).interrupts.push(extraSpellName(ev) ?? spellName(ev));
    else if (t === 'SPELL_DISPEL' && s) {
      acc(s).dispelsTotal += 1;
      const removed = extraSpellName(ev) ?? spellName(ev);
      if (auraType(ev) === 'BUFF') acc(s).purgesRemoved.push(removed);
      else if (auraType(ev) === 'DEBUFF') acc(s).cleansesRemoved.push(removed);
    } else if (t === 'SPELL_STOLEN' && s) acc(s).steals.push(extraSpellName(ev) ?? spellName(ev));
    else if (t === 'UNIT_DIED' && d) acc(d).deathMs.push(ms ?? NaN);
  }

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
    });
  }
  return result;
}
