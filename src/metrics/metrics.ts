import { eventType, srcId, destId, spellName, extraSpellName, auraType, eventTimeMs } from './eventAccess.js';
import { resolvePlayerUnits } from './playerUnits.js';

export interface SpellTally { spellName: string; count: number; }

export interface PlayerMetrics {
  interruptsLanded: number;
  interruptsLandedBySpell: SpellTally[];
  interruptsSuffered: number;
  interruptsSufferedBySpell: SpellTally[];
  dispels: number;
  dispelsByRemoved: SpellTally[];
  purges: number;
  cleanses: number;
  buffsLostToPurgeOrSteal: number;
  spellsteals: number;
  casts: number;
  castsPerMin: number | null;
  topCasts: SpellTally[];
  deaths: number;
  deathTimesSec: number[];
}

export interface CombatantTally { name: string; interrupts: number; dispels: number; casts: number; deaths: number; }

export interface MatchMetrics {
  player: PlayerMetrics;
  allyDeaths: number;
  enemyDeaths: number;
  perCombatant: CombatantTally[];
}

function tally(names: string[]): SpellTally[] {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts.entries()].map(([spellName, count]) => ({ spellName, count })).sort((a, b) => b.count - a.count);
}

export function computeMatchMetrics(match: unknown): MatchMetrics {
  const m = match as { events?: unknown[]; durationInSeconds?: unknown; units?: Record<string, { name?: unknown; reaction?: unknown }> };
  const events = Array.isArray(m.events) ? m.events : [];
  const players = resolvePlayerUnits(match);
  const units = m.units ?? {};
  const startMs = events.length > 0 ? eventTimeMs(events[0]) : undefined;
  const isPlayer = (id: string | undefined) => id !== undefined && players.has(id);

  const interruptsLanded: string[] = [];
  const interruptsSuffered: string[] = [];
  const dispelsRemoved: string[] = [];
  let purges = 0;
  let cleanses = 0;
  let buffsLostToPurgeOrSteal = 0;
  let spellsteals = 0;
  const casts: string[] = [];
  const deathTimesSec: number[] = [];
  let allyDeaths = 0;
  let enemyDeaths = 0;

  const pc = new Map<string, CombatantTally>();
  const bump = (id: string | undefined, k: 'interrupts' | 'dispels' | 'casts' | 'deaths') => {
    if (!id) return;
    const u = units[id] as { name?: unknown } | undefined;
    const name = u && typeof u.name === 'string' && u.name.length > 0 ? u.name : id;
    const row = pc.get(id) ?? { name, interrupts: 0, dispels: 0, casts: 0, deaths: 0 };
    row[k] += 1;
    pc.set(id, row);
  };

  for (const ev of events) {
    const t = eventType(ev);
    const s = srcId(ev);
    const d = destId(ev);

    if (t === 'SPELL_CAST_SUCCESS') {
      bump(s, 'casts');
      if (isPlayer(s)) casts.push(spellName(ev));
    } else if (t === 'SPELL_INTERRUPT') {
      bump(s, 'interrupts');
      const kicked = extraSpellName(ev) ?? spellName(ev);
      if (isPlayer(s)) interruptsLanded.push(kicked);
      if (isPlayer(d)) interruptsSuffered.push(kicked);
    } else if (t === 'SPELL_DISPEL') {
      bump(s, 'dispels');
      const removed = extraSpellName(ev) ?? spellName(ev);
      if (isPlayer(s)) {
        dispelsRemoved.push(removed);
        if (auraType(ev) === 'BUFF') purges += 1;
        else cleanses += 1;
      }
      if (isPlayer(d) && auraType(ev) === 'BUFF') buffsLostToPurgeOrSteal += 1;
    } else if (t === 'SPELL_STOLEN') {
      if (isPlayer(s)) spellsteals += 1;
      if (isPlayer(d)) buffsLostToPurgeOrSteal += 1;
    } else if (t === 'UNIT_DIED') {
      bump(d, 'deaths');
      if (isPlayer(d)) {
        const tm = eventTimeMs(ev);
        if (tm !== undefined && startMs !== undefined) deathTimesSec.push(Math.round((tm - startMs) / 1000));
      } else {
        const u = units[d ?? ''] as { reaction?: unknown } | undefined;
        const reaction = u && typeof u.reaction !== 'undefined' ? String(u.reaction) : '';
        if (reaction === 'Friendly' || reaction === '1') allyDeaths += 1;
        else if (reaction === 'Hostile' || reaction === '2') enemyDeaths += 1;
      }
    }
  }

  const durationSec = typeof m.durationInSeconds === 'number' ? m.durationInSeconds : null;

  const player: PlayerMetrics = {
    interruptsLanded: interruptsLanded.length,
    interruptsLandedBySpell: tally(interruptsLanded),
    interruptsSuffered: interruptsSuffered.length,
    interruptsSufferedBySpell: tally(interruptsSuffered),
    dispels: dispelsRemoved.length,
    dispelsByRemoved: tally(dispelsRemoved),
    purges,
    cleanses,
    buffsLostToPurgeOrSteal,
    spellsteals,
    casts: casts.length,
    castsPerMin: durationSec && durationSec > 0 ? (casts.length / durationSec) * 60 : null,
    topCasts: tally(casts).slice(0, 8),
    deaths: deathTimesSec.length,
    deathTimesSec,
  };

  return { player, allyDeaths, enemyDeaths, perCombatant: [...pc.values()].sort((a, b) => b.casts - a.casts) };
}
