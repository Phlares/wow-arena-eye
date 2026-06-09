import { describe, it, expect } from 'vitest';
import { parseOffensive } from '../scripts/import-offensive-cds.mjs';

const SNIPPET = `
  spells: [
    { spellId: '100', name: 'Charge', tags: [] },
    { spellId: '1719', name: 'Recklessness', tags: [] },
    { spellId: '107574', name: 'Avatar', tags: [SpellTag.Offensive] },
    { spellId: '262161', name: 'Warbreaker', tags: [SpellTag.Control, SpellTag.Offensive] },
    { spellId: '23920', name: 'Spell Reflection', tags: [SpellTag.Defensive] },
  ],
`;

describe('parseOffensive', () => {
  it('extracts only SpellTag.Offensive entries, as {id,name}', () => {
    const out = parseOffensive(SNIPPET);
    expect(out).toEqual([
      { id: '107574', name: 'Avatar' },
      { id: '262161', name: 'Warbreaker' },
    ]);
  });

  it('dedups repeated ids', () => {
    const dup = `{ spellId: '5', name: 'A', tags: [SpellTag.Offensive] }, { spellId: '5', name: 'A', tags: [SpellTag.Offensive] },`;
    expect(parseOffensive(dup)).toEqual([{ id: '5', name: 'A' }]);
  });

  it('excludes denylisted ids at generation time', () => {
    const src = `
      { spellId: '36554', name: 'Shadowstep', tags: [SpellTag.Offensive] },
      { spellId: '107574', name: 'Avatar', tags: [SpellTag.Offensive] },
    `;
    expect(parseOffensive(src, new Set(['36554']))).toEqual([{ id: '107574', name: 'Avatar' }]);
  });
});
