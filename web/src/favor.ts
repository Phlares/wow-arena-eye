import type { OffensiveWindow } from './api.js';

/** Defender-perspective favorability ratio for a GO band: (1 + our relevant) / (1 + their
 *  relevant) — enemy go compares our defensives up vs their ready offense; our go compares our
 *  ready offense vs their defensives. null when the stored match predates
 *  attackerOffenseAvailableCount (no re-ingest yet). */
export function favor(w: OffensiveWindow, ours: boolean): number | null {
  const atk = w.attackerOffenseAvailableCount;
  if (typeof atk !== 'number') return null;
  const def = w.mitigation.available.length;
  return ours ? (1 + atk) / (1 + def) : (1 + def) / (1 + atk);
}

/** favor → 5-stop scale index (0 red … 4 green). */
export function favorStop(f: number): number {
  return f >= 1.5 ? 4 : f >= 1.1 ? 3 : f > 0.9 ? 2 : f >= 0.67 ? 1 : 0;
}
