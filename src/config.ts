import { readFileSync } from 'node:fs';

export interface PlayerIdentity {
  name: string;
  realm: string;
  guid?: string;
}

export interface Config {
  sampleLogsDir: string;
  liveLogsDir?: string;
  videoDirs: string[];
  outputDir: string;
  dbPath?: string;
  player: PlayerIdentity;
  players: PlayerIdentity[];
  seasons: { name: string; startMs: number }[];
}

function requireString(obj: Record<string, unknown>, key: string, displayKey?: string): string {
  const v = obj[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`Config error: required field "${displayKey ?? key}" must be a non-empty string`);
  }
  return v;
}

export function loadConfig(path?: string): Config {
  const resolved = path ?? process.env.WAE_CONFIG ?? 'config.json';
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(resolved, 'utf8')) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`Config error: could not read/parse "${resolved}": ${(e as Error).message}`);
  }

  const sampleLogsDir = requireString(raw, 'sampleLogsDir');
  const outputDir = requireString(raw, 'outputDir');

  const playerRaw = raw.player;
  if (!playerRaw || typeof playerRaw !== 'object' || Array.isArray(playerRaw)) {
    throw new Error('Config error: required field "player" must be an object');
  }
  const p = playerRaw as Record<string, unknown>;
  const player: PlayerIdentity = {
    name: requireString(p, 'name', 'player.name'),
    realm: requireString(p, 'realm', 'player.realm'),
    guid: typeof p.guid === 'string' ? p.guid : undefined,
  };

  let videoDirs: string[] = [];
  if (raw.videoDirs !== undefined) {
    if (!Array.isArray(raw.videoDirs) || !raw.videoDirs.every((v) => typeof v === 'string')) {
      throw new Error('Config error: "videoDirs" must be an array of strings');
    }
    videoDirs = raw.videoDirs as string[];
  }

  let extraPlayers: PlayerIdentity[] = [];
  if (raw.players !== undefined) {
    if (!Array.isArray(raw.players)) throw new Error('Config error: "players" must be an array');
    extraPlayers = (raw.players as Record<string, unknown>[]).map((p) => ({
      name: requireString(p, 'name', 'players[].name'),
      realm: requireString(p, 'realm', 'players[].realm'),
      guid: typeof p.guid === 'string' ? p.guid : undefined,
    }));
  }
  // de-dupe by name-realm, keeping the singular player first
  const seen = new Set<string>();
  const players: PlayerIdentity[] = [];
  for (const p of [player, ...extraPlayers]) {
    const key = `${p.name}-${p.realm}`.toLowerCase();
    if (!seen.has(key)) { seen.add(key); players.push(p); }
  }

  let seasons: { name: string; startMs: number }[] = [];
  if (raw.seasons !== undefined) {
    if (!Array.isArray(raw.seasons)) throw new Error('Config error: "seasons" must be an array');
    seasons = (raw.seasons as Record<string, unknown>[]).map((sObj) => ({
      name: requireString(sObj, 'name', 'seasons[].name'),
      startMs: typeof sObj.startMs === 'number' ? sObj.startMs : (() => { throw new Error('Config error: seasons[].startMs must be a number'); })(),
    }));
  }

  return {
    sampleLogsDir,
    outputDir,
    liveLogsDir: typeof raw.liveLogsDir === 'string' ? raw.liveLogsDir : undefined,
    dbPath: typeof raw.dbPath === 'string' ? raw.dbPath : undefined,
    videoDirs,
    player,
    players,
    seasons,
  };
}
