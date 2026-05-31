import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ccInfo } from '../src/metadata/spells.js';

const ccCats = JSON.parse(
  readFileSync(fileURLToPath(new URL('../src/metadata/ccCategories.json', import.meta.url)), 'utf8'),
) as Record<string, { drCategory: string; name: string }>;
const curated = JSON.parse(
  readFileSync(fileURLToPath(new URL('../src/metadata/spells.curated.json', import.meta.url)), 'utf8'),
) as Record<string, unknown>;

describe('CC categories imported from the spell DB', () => {
  it('has broad coverage and a known stun', () => {
    expect(Object.keys(ccCats).length).toBeGreaterThan(50);
    expect(ccCats['408']).toMatchObject({ drCategory: 'stun' }); // Kidney Shot
  });
  it('ccInfo resolves a DB-only spell not present in the curated table', () => {
    const dbOnlyId = Object.keys(ccCats).find((id) => !(id in curated));
    expect(dbOnlyId, 'a DB-only CC spell exists').toBeTruthy();
    const cat = ccCats[dbOnlyId!].drCategory;
    expect(ccInfo(Number(dbOnlyId))).toEqual({ category: cat });
  });
});
