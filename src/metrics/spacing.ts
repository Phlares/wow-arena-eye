import type { UnitMetrics, PositionTrack, SpacingSummary, DistanceBandRow, OffensiveWindow, WindowPositioning } from './types.js';
import { distanceAt, resolvePosition } from './positionTracks.js';
import { matchStartMs, eventType, srcId, spellId, eventTimeMs, position } from './eventAccess.js';
import { anchorInfo } from '../metadata/repositioning.js';
import { isAvailable, type CastEvent } from './cooldownTimeline.js';
import { HEALER_SPEC_IDS } from './registry.js';

export const STEP_MS = 500;
export const MELEE_YD = 8;
export const HEAL_RANGE_YD = 40;

// Tick step in seconds. 500ms = 0.5 is exact in binary, so the `t += STEP_SEC` loops below
// accumulate without drift; keep STEP_MS a value that divides cleanly into a power-of-two second.
const STEP_SEC = STEP_MS / 1000;

const round1 = (x: number) => Math.round(x * 10) / 10;
const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** Nearest resolved distance from `self` to any of `others` at tSec, or undefined. */
function nearest(self: PositionTrack, others: PositionTrack[], t: number): number | undefined {
  let min: number | undefined;
  for (const o of others) {
    const d = distanceAt(self, o, t);
    if (d !== undefined && (min === undefined || d < min)) min = d;
  }
  return min;
}

function spacingFor(u: UnitMetrics, players: UnitMetrics[], tracks: Map<string, PositionTrack>): SpacingSummary {
  const self = tracks.get(u.unitId);
  if (!self || self.samples.length === 0) return { meleeRangeSec: 0, isolatedSec: 0 };
  const trackOf = (p: UnitMetrics) => tracks.get(p.unitId);
  const keep = (t: PositionTrack | undefined): t is PositionTrack => !!t;
  const enemies = players.filter((p) => p.team !== u.team && p.unitId !== u.unitId).map(trackOf).filter(keep);
  const allies = players.filter((p) => p.team === u.team && p.unitId !== u.unitId).map(trackOf).filter(keep);

  const startT = self.samples[0].tSec;
  const endT = self.samples[self.samples.length - 1].tSec;
  let meleeRangeSec = 0;
  let isolatedSec = 0;
  for (let t = startT; t <= endT; t += STEP_SEC) {
    if (!resolvePosition(self, t).position) continue;
    const ne = nearest(self, enemies, t);
    if (ne !== undefined && ne <= MELEE_YD) meleeRangeSec += STEP_SEC;
    const na = nearest(self, allies, t);
    if (na !== undefined && na > HEAL_RANGE_YD) isolatedSec += STEP_SEC;
  }
  return { meleeRangeSec: round1(meleeRangeSec), isolatedSec: round1(isolatedSec) };
}

/** Return a copy of `units` with `spacing` filled per player (non-players get a zero summary). */
export function attachSpacing(units: UnitMetrics[], tracks: Map<string, PositionTrack>): UnitMetrics[] {
  const players = units.filter((u) => u.kind === 'player');
  return units.map((u) => ({
    ...u,
    spacing: u.kind === 'player' ? spacingFor(u, players, tracks) : { meleeRangeSec: 0, isolatedSec: 0 },
  }));
}

type Band = 'b0_5' | 'b5_25' | 'b25_40' | 'b40plus';
function bandOf(d: number): Band {
  if (d < 5) return 'b0_5';
  if (d < 25) return 'b5_25';
  if (d < 40) return 'b25_40';
  return 'b40plus';
}

/** Per unordered player pair, the fraction of sampled time in each distance band.
 *  Fractions are over `sampledSec` (resolved ticks only) so unresolved time never inflates a band.
 *  NOTE: `sampledSec` is this PAIR's resolvable overlap, not the match length — a player who
 *  died early yields a small sampledSec on all their pairs. Compare fractions, not raw seconds,
 *  across pairs. */
export function computeDistanceBands(units: UnitMetrics[], tracks: Map<string, PositionTrack>): DistanceBandRow[] {
  const players = units.filter((u) => u.kind === 'player' && (tracks.get(u.unitId)?.samples.length ?? 0) > 0);
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of players) {
    const s = tracks.get(p.unitId)!.samples;
    lo = Math.min(lo, s[0].tSec);
    hi = Math.max(hi, s[s.length - 1].tSec);
  }
  const rows: DistanceBandRow[] = [];
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return rows;
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = tracks.get(players[i].unitId)!;
      const b = tracks.get(players[j].unitId)!;
      const acc: Record<Band, number> = { b0_5: 0, b5_25: 0, b25_40: 0, b40plus: 0 };
      let sampled = 0;
      for (let t = lo; t <= hi; t += STEP_SEC) {
        const d = distanceAt(a, b, t);
        if (d === undefined) continue;
        acc[bandOf(d)] += STEP_SEC;
        sampled += STEP_SEC;
      }
      const norm = sampled > 0 ? sampled : 1;
      rows.push({
        aId: players[i].unitId, bId: players[j].unitId,
        b0_5: round3(acc.b0_5 / norm), b5_25: round3(acc.b5_25 / norm),
        b25_40: round3(acc.b25_40 / norm), b40plus: round3(acc.b40plus / norm),
        sampledSec: round1(sampled),
      });
    }
  }
  return rows;
}

const HEALERS = new Set(HEALER_SPEC_IDS);

/** undefined-aware round-to-1dp for the optional positioning fields. */
const r1 = (x: number | undefined) => (x === undefined ? undefined : round1(x));

export interface AnchorPlacement { unitId: string; spellId: number; x: number; y: number; ms: number; }

/** Anchor (e.g. Demon Circle) placements per unit, in chronological order, with the caster
 *  position captured from the placement cast (via the shared `position` accessor). */
export function collectAnchors(match: unknown): Map<string, AnchorPlacement[]> {
  const m = match as { events?: unknown[] };
  const events = Array.isArray(m.events) ? m.events : [];
  const out = new Map<string, AnchorPlacement[]>();
  for (const ev of events) {
    if (eventType(ev) !== 'SPELL_CAST_SUCCESS') continue;
    const sid = spellId(ev);
    if (!anchorInfo(sid)) continue;
    const s = srcId(ev);
    const ms = eventTimeMs(ev);
    const p = position(ev);
    if (!s || ms === undefined || !p) continue;
    const arr = out.get(s) ?? [];
    arr.push({ unitId: s, spellId: sid!, x: p.x, y: p.y, ms });
    out.set(s, arr);
  }
  return out;
}

function windowPositioning(
  w: OffensiveWindow,
  tracks: Map<string, PositionTrack>,
  players: UnitMetrics[],
  anchors: Map<string, AnchorPlacement[]>,
  casts: Map<string, CastEvent[]>,
  startMs: number,
): WindowPositioning | undefined {
  const targetId = w.damageByTarget[0]?.unitId;
  if (!targetId) return undefined;
  const target = tracks.get(targetId);
  if (!target) return { primaryTargetId: targetId };

  const keep = (t: PositionTrack | undefined): t is PositionTrack => !!t;
  const attackers = players.filter((p) => p.team === w.attackingTeam).map((p) => tracks.get(p.unitId)).filter(keep);
  const defenders = players.filter((p) => p.team === w.defendingTeam);

  const nearestAttacker = (t: number): number | undefined => nearest(target, attackers, t);

  const threatDistanceStartYd = nearestAttacker(w.startSec);
  let threatDistanceMinYd: number | undefined;
  for (let t = w.startSec; t <= w.endSec; t += STEP_SEC) {
    const d = nearestAttacker(t);
    if (d !== undefined && (threatDistanceMinYd === undefined || d < threatDistanceMinYd)) threatDistanceMinYd = d;
  }

  let nearestHealerYd: number | undefined;
  for (const def of defenders) {
    if (def.unitId === targetId || !HEALERS.has(def.spec ?? '')) continue;
    const ht = tracks.get(def.unitId);
    if (!ht) continue;
    const d = distanceAt(target, ht, w.startSec);
    if (d !== undefined && (nearestHealerYd === undefined || d < nearestHealerYd)) nearestHealerYd = d;
  }

  let teamSpreadYd: number | undefined;
  const defTracks = defenders.map((p) => tracks.get(p.unitId)).filter(keep);
  for (let i = 0; i < defTracks.length; i++) {
    for (let j = i + 1; j < defTracks.length; j++) {
      const d = distanceAt(defTracks[i], defTracks[j], w.startSec);
      if (d !== undefined && (teamSpreadYd === undefined || d > teamSpreadYd)) teamSpreadYd = d;
    }
  }

  let escape: WindowPositioning['escape'];
  const windowStartMs = startMs + w.startSec * 1000;
  const placements = (anchors.get(targetId) ?? []).filter((pl) => pl.ms <= windowStartMs);
  if (placements.length) {
    const latest = placements[placements.length - 1];
    const info = anchorInfo(latest.spellId)!;
    const tp = resolvePosition(target, w.startSec).position;
    const anchorDistanceYd = tp ? Math.hypot(tp.x - latest.x, tp.y - latest.y) : undefined;
    const returnCasts = (casts.get(targetId) ?? []).filter((c) => c.spellId === info.returnSpellId).map((c) => c.ms);
    const escapeAvailable = isAvailable(returnCasts, info.returnCooldownMs, 1, windowStartMs);
    escape = { anchorPlaced: true, anchorDistanceYd: r1(anchorDistanceYd), escapeAvailable };
  }

  return {
    primaryTargetId: targetId,
    threatDistanceStartYd: r1(threatDistanceStartYd),
    threatDistanceMinYd: r1(threatDistanceMinYd),
    nearestHealerYd: r1(nearestHealerYd),
    teamSpreadYd: r1(teamSpreadYd),
    escape,
  };
}

/** Bolt a positioning record onto each offensive window (computed for its primary target). */
export function addWindowPositioning(
  windows: OffensiveWindow[],
  tracks: Map<string, PositionTrack>,
  units: UnitMetrics[],
  match: unknown,
  casts: Map<string, CastEvent[]>,
): OffensiveWindow[] {
  const m = match as { events?: unknown[] };
  const startMs = matchStartMs(Array.isArray(m.events) ? m.events : []) ?? 0;
  const anchors = collectAnchors(match);
  const players = units.filter((u) => u.kind === 'player');
  return windows.map((w) => {
    const pos = windowPositioning(w, tracks, players, anchors, casts, startMs);
    return pos ? { ...w, positioning: pos } : w;
  });
}
