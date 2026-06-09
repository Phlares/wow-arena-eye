// A WoW "season" for ingest-gating purposes is the major.minor of the client build: 12.0.0,
// 12.0.5 and 12.0.7 are all season "12.0"; 11.2.x is the previous season. Mid-season patches can
// shift mechanics, but balance/talents/trinkets move so much BETWEEN seasons that older-season
// data dilutes current-meta analysis (kept on disk for future model training, just not ingested
// by default).

/** "12.0" from "12.0.5" / "12.0.5.58997"; null when the version is missing or unparseable. */
export function seasonOf(buildVersion: string | null): string | null {
  if (!buildVersion) return null;
  const m = buildVersion.match(/^(\d+)\.(\d+)(?:\.|$)/);
  return m ? `${m[1]}.${m[2]}` : null;
}

/** The newest `n` distinct seasons in `seasons` (numeric major.minor ordering; nulls ignored). */
export function lastNSeasons(seasons: Iterable<string | null>, n: number): Set<string> {
  const distinct = [...new Set([...seasons].filter((s): s is string => s !== null))];
  const key = (s: string): number => {
    const [maj, min] = s.split('.').map(Number);
    return maj * 1000 + min;
  };
  distinct.sort((a, b) => key(b) - key(a));
  return new Set(n === Infinity ? distinct : distinct.slice(0, n));
}
