import { eventType, srcId, destId, amount } from './eventAccess.js';
import { unitTeam, type Team, type CoordinationSummary, type AttackerFocus, type FocusTracks } from './types.js';
import { computeFocusTracks } from './targeting.js';

const DAMAGE_EVENTS = /^(SPELL_DAMAGE|SPELL_PERIODIC_DAMAGE|RANGE_DAMAGE|SWING_DAMAGE|SWING_DAMAGE_LANDED)$/;

export function computeCoordination(
  match: unknown,
  healerSpecIds: string[],
  tracks?: FocusTracks,
): { team: Team; summary: CoordinationSummary }[] {
  const focus = tracks ?? computeFocusTracks(match);
  const m = match as { events?: unknown[]; units?: Record<string, { name?: unknown; reaction?: unknown; spec?: unknown }> };
  const events = Array.isArray(m.events) ? m.events : [];
  const units = m.units ?? {};
  const healer = new Set(healerSpecIds);
  const teamOf = (id: string | undefined) => unitTeam((units[id ?? ''] ?? {}).reaction);
  const nameOf = (id: string | undefined) => { const u = units[id ?? '']; return u && typeof u.name === 'string' ? u.name : id ?? '?'; };
  const isHealer = (id: string | undefined) => healer.has(String((units[id ?? ''] ?? {}).spec));
  const stepSec = focus.stepMs / 1000;
  const round1 = (n: number) => Math.round(n * 10) / 10;

  function summarize(team: Team): CoordinationSummary {
    // Damage buckets (kept): target priority + healer pressure.
    const dmg = events.filter((e) => DAMAGE_EVENTS.test(eventType(e)) && teamOf(srcId(e)) === team && teamOf(destId(e)) !== team);
    const byTarget = new Map<string, number>();
    for (const e of dmg) { const d = destId(e); if (!d) continue; byTarget.set(d, (byTarget.get(d) ?? 0) + amount(e)); }
    const targetPriority = [...byTarget.entries()].map(([id, total]) => ({ name: nameOf(id), damageTaken: total })).sort((a, b) => b.damageTaken - a.damageTaken);
    const healerPressureDamage = dmg.filter((e) => isHealer(destId(e))).reduce<number>((s, e) => s + amount(e), 0);

    // Focus-track derived: per-attacker swaps + time-on-target.
    const teamTracks = focus.tracks.filter((t) => t.team === team);
    const attackerFocus: AttackerFocus[] = teamTracks.map((t) => {
      let swaps = 0;
      let prev: string | null = null;
      let engagedTicks = 0;
      const dwellByTarget = new Map<string, number>();
      for (const cur of t.ticks) {
        if (cur !== null) {
          engagedTicks++;
          dwellByTarget.set(cur, (dwellByTarget.get(cur) ?? 0) + 1);
          if (prev !== null && cur !== prev) swaps++;
          prev = cur; // keep prev across null gaps: re-engaging the SAME target is not a swap
        }
      }
      let topTarget: string | undefined;
      let topTicks = 0;
      for (const [tgt, ticks] of dwellByTarget) if (ticks > topTicks) { topTicks = ticks; topTarget = tgt; }
      return {
        attacker: t.attacker,
        attackerName: t.attackerName,
        swaps,
        topTarget: topTarget ? nameOf(topTarget) : undefined,
        topTargetSec: round1(topTicks * stepSec),
        engagedSec: round1(engagedTicks * stepSec),
      };
    });
    const swaps = attackerFocus.reduce((s, a) => s + a.swaps, 0);

    // Team alignment: ticks where >=2 teammates share the same non-null dominant target.
    let alignedTicks = 0;
    let contestedTicks = 0;
    for (let i = 0; i < focus.tickCount; i++) {
      const counts = new Map<string, number>();
      for (const t of teamTracks) { const v = t.ticks[i]; if (v !== null) counts.set(v, (counts.get(v) ?? 0) + 1); }
      const engaged = [...counts.values()].reduce((s, c) => s + c, 0);
      if (engaged >= 2) {
        contestedTicks++;
        if ([...counts.values()].some((c) => c >= 2)) alignedTicks++;
      }
    }
    const alignmentFraction = contestedTicks > 0 ? Math.round((alignedTicks / contestedTicks) * 100) / 100 : 0;
    const alignedTimeSec = round1(alignedTicks * stepSec);

    return { targetPriority, topFocusTarget: targetPriority[0]?.name, healerPressureDamage, swaps, attackerFocus, alignmentFraction, alignedTimeSec };
  }

  return (['friendly', 'enemy'] as Team[]).map((team) => ({ team, summary: summarize(team) }));
}
