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

  return {
    sampleLogsDir,
    outputDir,
    liveLogsDir: typeof raw.liveLogsDir === 'string' ? raw.liveLogsDir : undefined,
    dbPath: typeof raw.dbPath === 'string' ? raw.dbPath : undefined,
    videoDirs,
    player,
  };
}
