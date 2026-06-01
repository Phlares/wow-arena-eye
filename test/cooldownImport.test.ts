import { describe, it, expect } from 'vitest';
import { parseRules } from '../scripts/import-cooldowns.mjs';

const FIXTURE = `
local offensiveSpellIds = {
	[107574] = true, -- Avatar
	[31884] = true, -- Avenging Wrath
}
rules.OffensiveSpellIds = offensiveSpellIds

local rules = {
	BySpec = {
		[65] = { -- Holy Paladin
			{
				BuffDuration = 12,
				Cooldown = 120,
				Important = true,
				BigDefensive = false,
				ExternalDefensive = false,
				SpellId = 31884,
			}, -- Avenging Wrath
			{
				BuffDuration = 8,
				Cooldown = 60,
				BigDefensive = true,
				Important = true,
				ExternalDefensive = false,
				SpellId = 498,
			}, -- Divine Protection
		},
		[73] = {
			{
				BuffDuration = 0,
				Cooldown = 90,
				MaxCharges = 2,
				Important = true,
				BigDefensive = false,
				ExternalDefensive = false,
				SpellId = 1719,
				CastSpellId = 414658,
				RequiresEvidence = { "Debuff", "UnitFlags" },
			},
			{
				Cooldown = 180,
				BuffDuration = 0,
				BigDefensive = true,
				ExternalDefensive = false,
				Important = true,
				NoAura = true,
				SpellId = 871,
			},
			{
				Cooldown = 45,
				BuffDuration = 0,
				BigDefensive = false,
				ExternalDefensive = false,
				Important = false,
				BaseCharges = 3,
				SpellId = 5277,
			},
		},
	},
	ByClass = {
		WARRIOR = {
			{ Cooldown = 90, BuffDuration = 0, BigDefensive = false, ExternalDefensive = false, Important = true, SpellId = 97462 },
		},
	},
}

local specToClass = {
	[65] = "PALADIN",
	[73] = "WARRIOR",
}
`;

describe('parseRules', () => {
  const data = parseRules(FIXTURE);

  it('extracts the offensive spell-id set', () => {
    expect(data.offensiveSpellIds.sort((a: number, b: number) => a - b)).toEqual([31884, 107574]);
  });

  it('parses BySpec entries with cooldown/buff/flags', () => {
    const aw = data.bySpec['65'].find((e: any) => e.spellId === 31884);
    expect(aw).toMatchObject({ cooldownSec: 120, buffDurationSec: 12, important: true, bigDefensive: false, charges: 1 });
    const dp = data.bySpec['65'].find((e: any) => e.spellId === 498);
    expect(dp).toMatchObject({ cooldownSec: 60, bigDefensive: true });
  });

  it('reads MaxCharges and survives nested tables (RequiresEvidence)', () => {
    const sw = data.bySpec['73'].find((e: any) => e.spellId === 1719);
    expect(sw).toMatchObject({ charges: 2, cooldownSec: 90 });
  });

  it('parses ByClass entries and the spec→class map', () => {
    expect(data.byClass.WARRIOR[0]).toMatchObject({ spellId: 97462, cooldownSec: 90 });
    expect(data.specToClass).toMatchObject({ '65': 'PALADIN', '73': 'WARRIOR' });
  });

  it('reads CastSpellId onto the entry', () => {
    const sw = data.bySpec['73'].find((e: any) => e.spellId === 1719);
    expect(sw).toMatchObject({ castSpellId: 414658 });
  });

  it('reads NoAura onto the entry', () => {
    const e = data.bySpec['73'].find((e: any) => e.spellId === 871);
    expect(e).toMatchObject({ noAura: true });
  });

  it('falls back to BaseCharges when MaxCharges is absent', () => {
    const e = data.bySpec['73'].find((e: any) => e.spellId === 5277);
    expect(e).toMatchObject({ charges: 3 });
  });
});
