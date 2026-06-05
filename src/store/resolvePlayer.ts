export interface PlayerRef {
  name?: string;
  realm?: string;
  guid?: string;
}

/**
 * Identify which of the user's characters recorded this match — never hardcoded.
 * Priority:
 *   1. parser auto-detect: rawMatch.playerId (the log's advanced-logging owner), if it is a
 *      GUID present in rawMatch.units — works for any character with no config;
 *   2. registry: the first unit matching a config PlayerRef by GUID, or by name / name-realm
 *      prefix (log names look like "Phlares-Stormrage-US");
 *   3. undefined.
 */
export function resolvePlayerUnitId(rawMatch: unknown, registry: PlayerRef[] = []): string | undefined {
  const m = rawMatch as { playerId?: unknown; units?: Record<string, unknown> };
  const units = m.units ?? {};
  const pid = typeof m.playerId === 'string' ? m.playerId : undefined;
  if (pid && units[pid]) return pid;
  if (!registry.length) return undefined;
  for (const [unitId, u] of Object.entries(units)) {
    const name = String((u as { name?: unknown })?.name ?? '').toLowerCase();
    for (const p of registry) {
      if (p.guid && unitId.toLowerCase() === p.guid.toLowerCase()) return unitId;
      if (p.name) {
        const nm = p.name.toLowerCase();
        const full = p.realm ? `${p.name}-${p.realm}`.toLowerCase() : null;
        if (name === nm || name.startsWith(nm + '-') || (full && name.startsWith(full))) return unitId;
      }
    }
  }
  return undefined;
}
