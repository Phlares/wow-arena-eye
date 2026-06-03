import type { UnitMetrics, PositionTrack, OffensiveWindow, WindowPositioning } from './types.js';
import { distanceAt, resolvePosition } from './positionTracks.js';
import { STEP_SEC, round1, nearest, keepTrack } from './spacing.js';
import { matchStartMs, eventType, srcId, spellId, eventTimeMs, position } from './eventAccess.js';
import { anchorInfo } from '../metadata/repositioning.js';
import { isAvailable, type CastEvent } from './cooldownTimeline.js';
import { HEALER_SPEC_IDS } from './registry.js';

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

  // KNOWN LIMITATION: threat = attacking-team PLAYERS only. Pet/guardian melee threats (hunter
  // pet, felguard, ghoul, …) have tracks but are excluded here, so a window where the pet is in
  // melee but the owner is at range reports a deceptively safe threat distance. Future refinement.
  const attackers = players.filter((p) => p.team === w.attackingTeam).map((p) => tracks.get(p.unitId)).filter(keepTrack);
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
  const defTracks = defenders.map((p) => tracks.get(p.unitId)).filter(keepTrack);
  for (let i = 0; i < defTracks.length; i++) {
    for (let j = i + 1; j < defTracks.length; j++) {
      const d = distanceAt(defTracks[i], defTracks[j], w.startSec);
      if (d !== undefined && (teamSpreadYd === undefined || d > teamSpreadYd)) teamSpreadYd = d;
    }
  }

  // KNOWN LIMITATION: anchorPlaced reflects the latest placement before the window; it does NOT
  // model the anchor being consumed by an earlier teleport without re-placing, so escape can be
  // overstated. escapeAvailable's return-spell cooldown check partially mitigates (a recent
  // teleport leaves the return on CD).
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
