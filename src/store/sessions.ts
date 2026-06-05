export interface SessionInput {
  matchId: string;
  startMs: number;
  durationSec: number | null;
  rating: number | null;
  result: string;
  allyCompLabel: string;
}

export interface Session {
  id: string;            // first match id of the session
  startMs: number;       // first match start
  endMs: number;         // last match end (start + duration)
  count: number;
  wins: number;
  losses: number;
  ratingStart: number | null; // first non-null rating
  ratingEnd: number | null;   // last non-null rating
  comps: string[];            // distinct ally comp labels
}

const endOf = (m: SessionInput): number => m.startMs + (m.durationSec ?? 0) * 1000;

/** Group one character's matches into queue-sessions. A new session starts when the idle gap
 *  (next.startMs - prev end) exceeds gapMs. Input need not be sorted. */
export function sessionize(matches: SessionInput[], gapMs: number): Session[] {
  const sorted = [...matches].sort((a, b) => a.startMs - b.startMs);
  const sessions: Session[] = [];
  let cur: SessionInput[] = [];
  const flush = () => {
    if (cur.length === 0) return;
    const comps = [...new Set(cur.map((m) => m.allyCompLabel).filter((c) => c !== ''))];
    const ratings = cur.map((m) => m.rating).filter((r): r is number => r !== null);
    sessions.push({
      id: cur[0].matchId,
      startMs: cur[0].startMs,
      endMs: endOf(cur[cur.length - 1]),
      count: cur.length,
      wins: cur.filter((m) => m.result === 'win').length,
      losses: cur.filter((m) => m.result === 'loss').length,
      ratingStart: ratings.length ? ratings[0] : null,
      ratingEnd: ratings.length ? ratings[ratings.length - 1] : null,
      comps,
    });
    cur = [];
  };
  for (const m of sorted) {
    if (cur.length > 0 && m.startMs - endOf(cur[cur.length - 1]) > gapMs) flush();
    cur.push(m);
  }
  flush();
  return sessions;
}
