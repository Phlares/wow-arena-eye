export function matchBrace(s: string, openIdx: number): number;
export function keyedGroups(body: string, keyRe: string): Record<string, string>;
export function topLevelObjects(body: string): string[];
export interface RawCooldownEntry {
  spellId: number;
  cooldownSec: number;
  buffDurationSec: number;
  charges: number;
  bigDefensive: boolean;
  externalDefensive: boolean;
  important: boolean;
  castSpellId?: number;
  noAura?: boolean;
}
export interface ParsedCooldowns {
  source: string;
  offensiveSpellIds: number[];
  specToClass: Record<string, string>;
  bySpec: Record<string, RawCooldownEntry[]>;
  byClass: Record<string, RawCooldownEntry[]>;
  generatedAt?: string;
}
export function parseRules(src: string): ParsedCooldowns;
