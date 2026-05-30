import { tally, type UnitMetrics, type PlayerGroup, type TeamGroup, type Team, type CombinedTotals } from './types.js';

const TEAM_ORDER: Team[] = ['friendly', 'enemy', 'neutral'];

function combine(player: UnitMetrics, pets: UnitMetrics[]): CombinedTotals {
  const all = [player, ...pets];
  const sum = (f: (u: UnitMetrics) => number) => all.reduce((acc, u) => acc + f(u), 0);
  const mergedInterrupts = tally(all.flatMap((u) => u.interruptsLandedBySpell.flatMap((s) => Array(s.count).fill(s.spellName) as string[])));
  return {
    casts: sum((u) => u.casts),
    interruptsLanded: sum((u) => u.interruptsLanded),
    interruptsLandedBySpell: mergedInterrupts,
    dispels: sum((u) => u.dispels),
    purges: sum((u) => u.purges),
    cleanses: sum((u) => u.cleanses),
    spellsteals: sum((u) => u.spellsteals),
    deaths: sum((u) => u.deaths),
  };
}

export function groupUnits(units: UnitMetrics[], playerUnitId?: string): TeamGroup[] {
  const players = units.filter((u) => u.kind === 'player');
  const playerIds = new Set(players.map((p) => p.unitId));
  const pets = units.filter((u) => u.kind !== 'player');

  const teams: TeamGroup[] = TEAM_ORDER.map((team) => ({ team, players: [], unownedPets: [] }));
  const teamOf = (t: Team) => teams.find((x) => x.team === t)!;

  for (const p of players) {
    const owned = pets.filter((pet) => pet.ownerId && pet.ownerId === p.unitId);
    const group: PlayerGroup = { player: p, pets: owned, combined: combine(p, owned) };
    teamOf(p.team).players.push(group);
  }
  for (const t of teams) {
    t.players.sort((a, b) => {
      if (a.player.unitId === playerUnitId) return -1;
      if (b.player.unitId === playerUnitId) return 1;
      return b.combined.casts - a.combined.casts;
    });
  }

  for (const pet of pets) {
    if (!pet.ownerId || !playerIds.has(pet.ownerId)) teamOf(pet.team).unownedPets.push(pet);
  }

  return teams.filter((t) => t.players.length > 0 || t.unownedPets.length > 0);
}
