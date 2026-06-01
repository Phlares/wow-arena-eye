# CC Received/Done + Immune Tracking — Design (Cycle 2)

**Date:** 2026-06-02
**Status:** Approved design; build this cycle.
**Builds on:** Time-in-CC Cycle 1 (PR #8). **Merge PR #8 first**, then branch `feat/cc-received-done` off master. Reuses `ccTime` (`unionSeconds`/`computeCcDurations`), `auraState`, `ccInfo`, `interruptLockoutSec`, the DB DR-category table.

---

## 1. What this is and why

Cycle 1 measured CC **suffered** (time you were controlled). This cycle makes CC
**symmetric and player-focused**, in one chunky pass:

1. **Received vs Done split** — the same bucket values (cast-denial / hard-CC /
   roots time + per-category) computed for both CC you *suffered* and CC you
   *landed on enemies*, mirroring the existing `interruptsLanded` / `interruptsSuffered` split.
2. **Immune / wasted-effort** — CC attempts that were *immuned* (immunity buff or
   DR-immune), plus damage/healing spent *into* an immune target.
3. **Player-on-player only** — all CC tracking counts only when both ends resolve
   to players on opposite teams. Pet-cast CC rolls up to the owner; CC on/by
   totems, guardians, and creatures is dropped as noise.

The motive is legibility (received/done side by side) and signal (drop pet noise,
surface wasted effort).

## 2. Data model — symmetric `CcSide` (`types.ts`)

Both directions share one shape, so the cast-denial/hard/root bucket fields exist
identically for received and done:

```ts
interface CcCategoryStat { category: DrCategory; count: number; durationSec: number; }

// CC that LANDED (duration tracking). Pure time/landed metric — immunity lives in ImmuneSide.
interface CcSide {
  timeSec: number;        // received: union of all CC on you; done: Σ over enemy targets of that target's union
  castDenialSec: number;  // silences + interrupt lockouts (suffered for received, landed for done)
  hardCcSec: number;      // stun ∪ incapacitate ∪ disorient
  rootSec: number;        // root
  count: number;          // CC instances (SPELL_AURA_APPLIED + REFRESH)
  byCategory: CcCategoryStat[];
}

// Things that did NOT land because of immunity / grounding (the three elements, §7).
interface ImmuneSide {
  spellsImmuned: SpellTally[];                              // A: every immuned/grounded ability, by spell (count per spell) — superset, incl. non-CC (e.g. a grounded Haunt)
  ccImmuned: number;                                        // C: count of immuned CC instances (the CC subset of A)
  ccImmunedByCategory: { category: DrCategory; count: number }[];
  damageImmuned: number;                                    // B: damage amount immuned
  healingImmuned: number;                                   // B: healing amount immuned
}
```

`UnitMetrics` changes:
- **Remove** the Cycle-1 flat fields `timeControlledSec`, `castDenialSec`,
  `hardCcSec`, `rootSec`, `ccTaken`, `ccTakenByCategory` — they become
  `ccReceived` (same values, same `cd/hard/root` bucket names, now grouped).
- **Add** `ccReceived: CcSide`, `ccDone: CcSide`.
- **Add** `immuneReceived: ImmuneSide` (immunity/grounding that blocked things aimed at you) and
  `immuneDone: ImmuneSide` (your effort that was immuned/grounded — wasted).
- `deathsWhileCcd` / `deathsWhileCcdBySpell` stay as-is (a received-at-death concept).

`SpellTally` is the existing `{ spellName; count }` shape (reused). `CcTakenEntry`
(Cycle 1) is renamed `CcCategoryStat` and reused on both `CcSide`s. CC/immune stay
per-unit (not added to `CombinedTotals`).

## 3. Player-on-player resolution (shared helper)

`targeting.ts` already has the source→owning-player rollup (`attackerOf`/`isPlayer`).
**Extract it** to `types.ts` as:

```ts
// the unit itself if a player, else its owner if that owner is a player, else undefined
export function resolvePlayer(units: Record<string, { type?: unknown; ownerId?: unknown }>, id: string | undefined): string | undefined;
```

Reuse it in `targeting.ts` (replacing its local copy — a reuse win) and in the new
CC code. A CC interval/event counts only when **both** ends resolve to players on
**opposite teams** (`unitTeam` differs). Pet-cast CC resolves to the owner; CC
on/by NPCs/totems/guardians resolves to `undefined` and is dropped.

## 4. Source-aware aura tracking (`auraState`)

Today an interval records `{ spellId, name, start, end }` keyed by dest. Add the
**caster**, captured at `SPELL_AURA_APPLIED`:

- `Interval` gains `srcId: string` (the applying unit; taken from the APPLIED
  event, retained through the REMOVED/BROKEN close).
- `intervalsOn(destId)` returns intervals (each now carrying `srcId`) — used for **received**.
- Add `intervalsBy(srcId): Interval[]` (a source index) — used for **done**.

Received for player U = `intervalsOn(U)` filtered to player casters on the enemy
team. Done for player A = `intervalsBy(A)` plus `intervalsBy(petOfA)` for each of
A's pets, restricted to enemy-player targets, grouped by target.

## 5. Duration computation (`ccTime`)

- **Received** reuses `computeCcDurations(receivedIntervals, suffferedInterruptWindows, matchEndMs)` unchanged (single union per bucket). `receivedIntervals` = CC on the player whose caster resolves to an enemy player.
- **Done** is computed per enemy target then summed:
  1. Gather the player's applied CC intervals (`intervalsBy` for the player + pets), keep those whose target is an enemy player, group by `destId`.
  2. For each target, `computeCcDurations(targetIntervals, landedInterruptWindowsForThatTarget, matchEndMs)`.
  3. **Sum** the per-target `CcDurations` with a new helper:
     ```ts
     export function sumCcDurations(parts: CcDurations[]): CcDurations;
     ```
     which adds `timeControlledSec`/`castDenialSec`/`hardCcSec`/`rootSec` and merges `byCategory` by summing `durationSec` per category. (Per-target union is preserved inside each part; summing across targets credits multi-target control.)
- The `CcSide` for each direction is assembled from the resulting `CcDurations`: `timeSec ← timeControlledSec`, and `castDenialSec`/`hardCcSec`/`rootSec`/`byCategory` map across by the same name (the `CcSide` shape is the public per-direction view; `CcDurations` stays the internal compute shape). `count` and the immune fields come from §6–§7.

## 6. Interrupts — landed windows (`perUnit`)

Cycle 1 extended *suffered* interrupts to `{ name, ms, spellId }`. Mirror it for
**landed** interrupts: the existing `interrupts` accumulator (SPELL_INTERRUPT where
`srcId` resolves to the player) becomes `{ name, ms, spellId, targetId }`
(`targetId = destId`, the interrupted enemy). Landed-interrupt lockout windows
(`interruptLockoutSec`) feed `ccDone.castDenialSec`, grouped by target like the
rest of done. `interruptsLanded`/`interruptsSuffered` counts + by-spell stay as
their own top-level fields (unchanged).

## 7. Immune / wasted-effort — three elements, each received/done (`eventAccess` + `perUnit`)

Add an `immuneEvent(ev)` accessor whose exact shape is **discovered by TDD on the
real fixture** (same method as `absorbInfo`). It must recognize **two** log
patterns:
- **Immunity** — a hit fully blocked by an immunity/absorb-immune: `SPELL_MISS` /
  `SPELL_DAMAGE` / `SPELL_HEAL` with `missType === "IMMUNE"` (or the parser-named
  equivalent).
- **Grounding** — a single-target spell consumed by **Grounding Totem**. This is a
  *distinct* mechanic (not necessarily a `missType=IMMUNE`); discovery determines
  its signature (e.g. the cast resolving against a Grounding Totem unit, or a
  redirect/`SPELL_MISS` variant). Grounded spells count toward element A.

The accessor returns `{ srcId, destId, kind: 'spell' | 'damage' | 'heal', spellId, spellName, amount? }`
for an immuned/grounded event, else `undefined`. The three elements are derived
from it, with the player-on-player resolution from §3. **Received vs done is by
role:** *done* = the affected unit is the **source** (your offense/effort was
immuned); *received* = the affected unit is the **target** (something aimed at you
was immuned by your immunity, or a heal to you was wasted because you were immune).

- **A — spells/abilities immuned (incl. grounded)** → `spellsImmuned` (by-spell tally).
  Every immuned/grounded ability between players. Caster's `immuneDone.spellsImmuned`;
  intended target's `immuneReceived.spellsImmuned`. (A grounded Haunt: the caster's
  done tally; the grounding shaman's received tally if the totem resolves to its owner — best-effort, see §11.)
- **B — damage/healing immuned** → `damageImmuned` / `healingImmuned` (amounts).
  Damage immuned: source `immuneDone.damageImmuned`, target `immuneReceived.damageImmuned`.
  Healing immuned (e.g. healing a Cyclone'd/Banished ally — immune to heals):
  healer `immuneDone.healingImmuned`, the immune ally `immuneReceived.healingImmuned`.
  (Heals are same-team; the player filter requires both players but relaxes the
  opposite-team check for the heal case.)
- **C — CC instances immuned** → `ccImmuned` (count) + `ccImmunedByCategory`.
  The CC subset of A (immuned event whose `spellId` is CC per `ccInfo`): caster's
  `immuneDone.ccImmuned`, target's `immuneReceived.ccImmuned`.

If the fixture contains **no** immune/grounding events, this whole section is
reported and deferred (the accessor stubbed to `undefined`, all `ImmuneSide`
fields 0) rather than shipped unverified — the received/done CC split + player
filter still land. The discovery step decides this, and reports separately
whether grounding was detectable (grounding may defer even if `missType=IMMUNE` is found).

## 8. Report (lean, validation-only) — `renderMetrics`

Two stacked CC-time lines per player, plus an immune line, all received/done:
- `CC recv: <timeSec>s (cd/hard/root)` · `CC done: <timeSec>s (cd/hard/root)`
- `immuned recv: cc <ccImmuned> · dmg <damageImmuned> · heal <healingImmuned>` and the same for `done`,
  with `spellsImmuned` rendered as a collapsed by-spell tally (`<details>`).

Keep it compact; this is validation output. Column/label adjustments stay minimal.

## 9. Components / file structure

```
src/metrics/types.ts        # CcSide + CcCategoryStat; UnitMetrics received/done + immune fields; resolvePlayer()
src/metrics/auraState.ts    # Interval gains srcId; add intervalsBy(srcId)
src/metrics/targeting.ts    # use shared resolvePlayer (drop local attackerOf/isPlayer)
src/metrics/ccTime.ts       # add sumCcDurations(); (computeCcDurations unchanged)
src/metrics/eventAccess.ts  # add immuneEvent(ev) — immunity + grounding (TDD-discovered)
src/metrics/perUnit.ts      # build received+done CcSide (player-only, pet→owner, done grouped-by-target-summed); landed-interrupt windows; immuneReceived/immuneDone (3 elements)
src/view/renderMetrics.ts   # two CC-time lines + immune recv/done; label tweaks
test/
  auraState.test.ts         # srcId captured; intervalsBy(src)
  resolvePlayer.test.ts     # player / pet→owner / NPC→undefined
  ccTime.test.ts            # sumCcDurations (add buckets, merge byCategory)
  eventAccessImmune.test.ts # immuneEvent discovered on fixture (immunity + grounding signatures)
  perUnit.test.ts           # received vs done CC; pet-cast CC→owner; done summed across 2 targets; CC on a pet ignored; immuneDone/immuneReceived 3 elements (spellsImmuned, ccImmuned, dmg/heal immuned)
  metrics.test.ts           # golden: ccReceived matches Cycle-1 numbers; ccDone > 0 for an attacker; player-only (no creature CC)
  renderReport.test.ts      # updated UnitMetrics literals (ccReceived/ccDone/immuneReceived/immuneDone); CC + immune lines render
```

## 10. Data flow

`buildAuraState` (now srcId-aware, `intervalsBy`) → `perUnit` per player:
received = `computeCcDurations(intervalsOn(me) ∩ enemy-player-casters, sufferedInterruptWindows)`;
done = `sumCcDurations( per enemy target: computeCcDurations(intervalsBy(me+pets)→target, landedInterruptWindows→target) )`;
immune/grounding events fold into `immuneDone` (source role) and `immuneReceived`
(target role) across the three elements; assemble `ccReceived`/`ccDone` (`CcSide`)
+ `immuneReceived`/`immuneDone` (`ImmuneSide`) → `renderMetrics` CC + immune display.

## 11. Error handling

- Source or target not resolving to a player → CC dropped (NPC/pet-on-pet noise).
- Pet with owner not a player → dropped.
- `intervalsBy(src)` empty → `ccDone` all zeros.
- `immuneEvent` undefined / no immune+grounding events in fixture → all `ImmuneSide` fields 0 (deferred sub-part).
- Grounded-spell attribution: the caster's `immuneDone` is always credited; crediting the grounding shaman's `immuneReceived` is best-effort (only if the Grounding Totem resolves to a player owner) — if it can't be resolved, the done side still records the wasted cast.
- Self/same-team CC (shouldn't occur) → excluded by the opposite-team check (heal-into-immune is the deliberate same-team exception).
- Open-ended/unclosed CC auras and the per-instance cap behave exactly as Cycle 1 (the `done` path runs the same `computeCcDurations`).

## 12. Testing

- **resolvePlayer:** player→self; pet→owner; pet whose owner is a player; NPC/totem→undefined.
- **auraState:** `srcId` captured from APPLIED and retained after REMOVED/BROKEN; `intervalsBy(src)` returns that caster's intervals.
- **ccTime.sumCcDurations:** two parts → bucket fields add; `byCategory` merges per category; empty → zeros.
- **perUnit (synthetic, player-on-player):** a stun you applied to enemy A and a poly to enemy B → `ccDone.hardCcSec` = sum of both; re-applied stun on one enemy → that target unioned; a Felguard (pet) Axe Toss on an enemy → counted under the **owner's** `ccDone`; CC on your pet → ignored; CC from a creature → ignored. Immune (all 3 elements): an immuned CC → `immuneDone.ccImmuned`+`spellsImmuned` on caster, `immuneReceived.ccImmuned`+`spellsImmuned` on target; damage into an immune enemy → `immuneDone.damageImmuned` (source) + `immuneReceived.damageImmuned` (target); healing an immune ally → `immuneDone.healingImmuned` (healer) + `immuneReceived.healingImmuned` (ally).
- **eventAccess.immuneEvent:** discovered + asserted on the fixture for an immunity hit (player-on-player) and, if present, a grounded spell; or reported absent (with grounding reported separately).
- **fixture golden:** `me.ccReceived` bucket values equal Cycle-1's received numbers (regression); `me.ccDone.timeSec > 0`; no NPC/creature appears with CC; bucket sums ≥ `timeSec` per side; `ccImmuned` ≤ `spellsImmuned` total count per side (CC is a subset of all immuned spells).

## 13. Out of scope

DR-progression multipliers (50/25/immune effective-duration) remain out of scope.
Aggregating CC into `CombinedTotals` (player+pets headline) stays out — CC is
per-unit. Match-segmentation of long matches (a separate matching concern) is
untouched.
