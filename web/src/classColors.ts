// Mirror of src/metadata/classColors.ts CLASS_COLORS (the canonical WoW class hexes). The detail
// payload sends each combatant/track's className, so the SPA colors by className directly.
export const CLASS_COLORS: Record<string, string> = {
  'Death Knight': '#C41E3A', 'Demon Hunter': '#A330C9', 'Druid': '#FF7C0A', 'Evoker': '#33937F',
  'Hunter': '#AAD372', 'Mage': '#3FC7EB', 'Monk': '#00FF98', 'Paladin': '#F48CBA', 'Priest': '#FFFFFF',
  'Rogue': '#FFF468', 'Shaman': '#0070DD', 'Warlock': '#8788EE', 'Warrior': '#C69B6D',
};
export const NEUTRAL_COLOR = '#9aa2b1';
export const classColor = (className: string | undefined): string => (className && CLASS_COLORS[className]) || NEUTRAL_COLOR;
