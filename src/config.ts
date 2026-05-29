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

  const playerRaw = raw.player as Record<string, unknown> | undefined;
  if (!playerRaw || typeof playerRaw !== 'object') {
    throw new Error('Config error: required field "player" must be an object');
  }
  const player: PlayerIdentity = {
    name: requireString(playerRaw, 'name', 'player.name'),
    realm: requireString(playerRaw, 'realm', 'player.realm'),
    guid: typeof playerRaw.guid === 'string' ? playerRaw.guid : undefined,
  };

  const videoDirs = Array.isArray(raw.videoDirs) ? (raw.videoDirs as string[]) : [];

  return {
    sampleLogsDir,
    outputDir,
    liveLogsDir: typeof raw.liveLogsDir === 'string' ? raw.liveLogsDir : undefined,
    dbPath: typeof raw.dbPath === 'string' ? raw.dbPath : undefined,
    videoDirs,
    player,
  };
}
