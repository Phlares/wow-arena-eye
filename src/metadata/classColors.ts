import { className } from './specs.js';

/** Canonical WoW class colors (hex). Keys MATCH the spaced classNames in specs.json
 *  ("Death Knight", "Demon Hunter"). */
export const CLASS_COLORS: Record<string, string> = {
  'Death Knight': '#C41E3A', 'Demon Hunter': '#A330C9', 'Druid': '#FF7C0A', 'Evoker': '#33937F',
  'Hunter': '#AAD372', 'Mage': '#3FC7EB', 'Monk': '#00FF98', 'Paladin': '#F48CBA', 'Priest': '#FFFFFF',
  'Rogue': '#FFF468', 'Shaman': '#0070DD', 'Warlock': '#8788EE', 'Warrior': '#C69B6D',
};

export const NEUTRAL_COLOR = '#9aa2b1';

/** Color for a spec id, via its class. Neutral gray when the spec/class is unknown. */
export function classColorOfSpec(specId: string | undefined): string {
  if (!specId) return NEUTRAL_COLOR;
  return CLASS_COLORS[className(specId)] ?? NEUTRAL_COLOR;
}
