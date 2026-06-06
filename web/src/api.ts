// Mirror of src/viewer/types.ts (kept in sync by hand; small + stable).
export interface MatchSummary {
  matchId: string; startMs: number | null; durationSec: number | null; bracket: string; character: string;
  mapId: string; mapName: string; allyComp: string; allyCompLabel: string; enemyComp: string; enemyCompLabel: string;
  rating: number | null; ratingDelta: number | null; cr: number | null; crDelta: number | null; buildVersion: string;
  result: string; sessionId: string | null;
  damageDone: number | null; dps: number | null; interruptsLanded: number | null;
  interruptsSuffered: number | null; precognitionUptimeSec: number | null; enemyPrecognitionUptimeSec: number | null;
}
export interface SessionSummary {
  id: string; startMs: number; endMs: number; count: number; wins: number; losses: number;
  ratingStart: number | null; ratingEnd: number | null; comps: string[];
}
export interface FilterOptions {
  characters: string[]; brackets: string[];
  classSpecTree: { className: string; specs: { id: string; specName: string }[] }[];
  maps: { value: string; label: string }[];
  ratingRange: { min: number; max: number } | null; dateRange: { minMs: number; maxMs: number } | null;
}
export interface MatchesResponse { matches: MatchSummary[]; sessions: SessionSummary[]; total: number; }

// --- per-match detail (sub-project B). The metrics blob is rendered structurally, so a permissive
// shape is intentional — only the fields the timeline reads are typed. ---
export interface RangePoint { tSec: number; dist: number | null }
export interface DetailTimelineEvent { tSec: number; unitId: string; unitName: string; kind: string; spell?: string; extra?: string; targetId?: string; targetName?: string }
export interface OffensiveWindow {
  startSec: number; endSec: number; defendingTeam: string; teamDamageTaken: number;
  damageByTarget: { unitId: string; name: string; damage: number }[];
  mitigation: { available: { name: string }[]; used: { name: string }[] };
  counterPlay?: unknown; positioning?: unknown; lineOfSight?: unknown;
}
export interface MatchDetail {
  metrics: { playerUnitId?: string; timeline: DetailTimelineEvent[]; offensiveWindows: OffensiveWindow[]; losDisruptors: { kind?: string; startSec?: number }[] };
  rangeSeries: RangePoint[];
}
export async function fetchMatchDetail(id: string): Promise<MatchDetail> {
  const r = await fetch(`/api/matches/${encodeURIComponent(id)}/detail`);
  if (r.status === 404) throw new Error('no-detail');
  if (!r.ok) throw new Error(`/detail ${r.status}`);
  return r.json() as Promise<MatchDetail>;
}
export type Filters = Record<string, string>;

/** A Filters object as URLSearchParams, omitting empty/nullish values. Shared by the
 *  fetch query-string builder and the App's URL-state writer so they can't drift. */
export function toParams(filters: Filters): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v !== '' && v != null) p.set(k, v);
  return p;
}
function qs(filters: Filters): string {
  const s = toParams(filters).toString();
  return s ? `?${s}` : '';
}
export async function fetchMatches(filters: Filters): Promise<MatchesResponse> {
  const r = await fetch(`/api/matches${qs(filters)}`);
  if (!r.ok) throw new Error(`/api/matches ${r.status}`);
  return r.json() as Promise<MatchesResponse>;
}
export async function fetchFilters(character?: string): Promise<FilterOptions> {
  const r = await fetch(`/api/filters${character ? `?character=${encodeURIComponent(character)}` : ''}`);
  if (!r.ok) throw new Error(`/api/filters ${r.status}`);
  return r.json() as Promise<FilterOptions>;
}
