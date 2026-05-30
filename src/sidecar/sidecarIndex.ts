import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

export interface SidecarCombatant {
  name: string;
  specId: number;
  teamId: number;
}

export interface SidecarEntry {
  jsonPath: string;
  videoPath: string;
  startEpochMs: number | null;
  category: string | null;
  zoneName: string | null;
  result: boolean | null;
  durationSec: number | null;
  combatants: SidecarCombatant[];
}

export interface SidecarIndex {
  entries: SidecarEntry[];
  loaded: number;
  skipped: number;
}

function startFromFilename(name: string): number | null {
  const m = name.match(/(\d{4})-(\d{2})-(\d{2})[ _](\d{2})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const dt = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  const ms = dt.getTime();
  return Number.isNaN(ms) ? null : ms;
}

function isSidecar(o: Record<string, unknown>): boolean {
  return (
    typeof o.category === 'string' ||
    Array.isArray(o.combatants) ||
    typeof o.zoneName === 'string' ||
    typeof o.zoneID === 'number'
  );
}

function listJsonFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) out.push(...listJsonFiles(full));
    else if (name.toLowerCase().endsWith('.json')) out.push(full);
  }
  return out;
}

export function loadSidecarIndex(videoDirs: string[]): SidecarIndex {
  const entries: SidecarEntry[] = [];
  let skipped = 0;

  for (const dir of videoDirs) {
    for (const jsonPath of listJsonFiles(dir)) {
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(readFileSync(jsonPath, 'utf8')) as Record<string, unknown>;
      } catch {
        skipped += 1;
        continue;
      }
      if (!obj || typeof obj !== 'object' || !isSidecar(obj)) {
        skipped += 1;
        continue;
      }

      const startField = typeof obj.start === 'number' ? (obj.start as number) : null;
      const startEpochMs = startField ?? startFromFilename(basename(jsonPath));

      const rawCombatants = Array.isArray(obj.combatants) ? (obj.combatants as Record<string, unknown>[]) : [];
      const combatants: SidecarCombatant[] = rawCombatants.map((c) => ({
        name: typeof c._name === 'string' ? c._name : '',
        specId: typeof c._specID === 'number' ? c._specID : -1,
        teamId: typeof c._teamID === 'number' ? c._teamID : -1,
      }));

      const mp4 = jsonPath.replace(/\.json$/i, '.mp4');
      entries.push({
        jsonPath,
        videoPath: existsSync(mp4) ? mp4 : jsonPath,
        startEpochMs,
        category: typeof obj.category === 'string' ? obj.category : null,
        zoneName: typeof obj.zoneName === 'string' ? obj.zoneName : null,
        result: typeof obj.result === 'boolean' ? obj.result : null,
        durationSec: typeof obj.duration === 'number' ? obj.duration : null,
        combatants,
      });
    }
  }

  return { entries, loaded: entries.length, skipped };
}
