import { describe, it, expect } from 'vitest';
import { DatabaseSync } from '../src/store/sqlite.js';
import { migrate } from '../src/store/schema.js';
import { handleApi } from '../src/viewer/server.js';

function db() {
  const d = new DatabaseSync(':memory:');
  migrate(d);
  return d;
}

describe('GET /api/metadata', () => {
  const body = () => {
    const res = handleApi(db(), 'GET', '/api/metadata', new URLSearchParams(''), 30 * 60_000);
    expect(res.status).toBe(200);
    return JSON.parse(res.body) as {
      offensive: { id: number; name?: string; cooldownSec?: number; kind?: string; windowSec?: number }[];
      denied: { id: number; name: string; reason: string }[];
      cc: { id: number; name: string; category: string }[];
      defensives: { id: number; cooldownSec: number; category: string }[];
    };
  };

  it('lists the tracked offensive CDs with curated meta where known', () => {
    const b = body();
    const deathmark = b.offensive.find((o) => o.id === 360194);
    expect(deathmark).toMatchObject({ name: 'Deathmark', cooldownSec: 120, kind: 'debuff' });
    const darkglare = b.offensive.find((o) => o.id === 205180);
    expect(darkglare?.windowSec).toBeGreaterThan(0);
    expect(b.offensive.length).toBeGreaterThan(50);
  });

  it('exposes the denylist with reasons (transparency for pruned vendor ids)', () => {
    const b = body();
    const step = b.denied.find((o) => o.id === 36554);
    expect(step?.name).toBe('Shadowstep');
    expect(step?.reason).toBeTruthy();
    // a denied id never appears in the offensive list
    expect(b.offensive.some((o) => b.denied.some((x) => x.id === o.id))).toBe(false);
  });

  it('lists CC with DR categories and the defensive registry', () => {
    const b = body();
    const seduction = b.cc.find((c) => c.id === 6358); // the DV2-c metadata fix stays visible
    expect(seduction?.category).toBeTruthy();
    expect(b.cc.length).toBeGreaterThan(100);
    expect(b.defensives.length).toBeGreaterThan(50);
    expect(b.defensives.every((dEntry) => dEntry.cooldownSec > 0)).toBe(true);
  });
});
