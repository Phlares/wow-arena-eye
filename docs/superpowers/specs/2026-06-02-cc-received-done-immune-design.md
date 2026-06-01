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

interface CcSide {
  timeSec: number;        // received: union of all CC on you; done: Σ over enemy targets of that target's union
  castDenialSec: number;  // silences + interrupt lockouts (suffered for received, landed for done)
  hardCcSec: number;      // stun ∪ incapacitate ∪ disorient
  rootSec: number;        // root
  count: number;          // CC instances (SPELL_AURA_APPLIED + REFRESH)
  byCategory: CcCategoryStat[];
  immuneCount: number;            // received: enemy CC that whiffed on your immunity; done: your CC that was immuned (wasted)
  immuneByCategory: { category: DrCategory; count: number }[];
}
```

`UnitMetrics` changes:
- **Remove** the Cycle-1 flat fields `timeControlledSec`, `castDenialSec`,
  `hardCcSec`, `rootSec`, `ccTaken`, `ccTakenByCategory` — they become
  `ccReceived` (same values, same `cd/hard/root` bucket names, now grouped).
- **Add** `ccReceived: CcSide` and `ccDone: CcSide`.
- **Add** `damageIntoImmune: number` and `healingIntoImmune: number` (wasted, source-attributed).
- `deathsWhileCcd` / `deathsWhileCcdBySpell` stay as-is (a received-at-death concept).

`CcTakenEntry` (Cycle 1) is renamed `CcCategoryStat` and reused on both sides.
CC stays per-unit (not added to `CombinedTotals`).

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

## 7. Immune / wasted-effort (`eventAccess` + `perUnit`)

Add an `immuneMiss(ev)` accessor whose exact shape is **discovered by TDD on the
real fixture** (same method as `absorbInfo`): WoW represents a fully-immune hit as
`SPELL_MISS`/`SPELL_DAMAGE`/`SPELL_HEAL` with a `missType === "IMMUNE"` field (or
a parser-named equivalent). The accessor returns `{ srcId, destId, eventKind: 'cc' | 'damage' | 'heal', spellId, amount? }` for an immune-blocked event, else `undefined`.

From it, with the player-on-player + opposite-team filter:
- **CC immuned** (the immune event is a CC spell, by `ccInfo`): credit the caster's
  `ccDone.immuneCount`/`immuneByCategory` (wasted) and the target's
  `ccReceived.immuneCount`/`immuneByCategory` (avoided).
- **Damage into immune**: `damageIntoImmune += amount` on the source.
- **Healing into immune** (e.g. healing a Cyclone'd/Banished ally): `healingIntoImmune += amount` on the source. (Healing target is an ally — same-team player; the player filter still requires both to be players, but the team check is relaxed for the heal case since it's friendly.)

If the fixture contains **no** IMMUNE events, the immune sub-part is reported and
deferred (the accessor stubbed to return `undefined`, fields left 0) rather than
shipped unverified — the received/done split + player filter still land. The
discovery step decides this.

## 8. Report (lean, validation-only) — `renderMetrics`

Replace the single CC cell with two stacked lines per player:
- `CC recv: <timeSec>s (cd/hard/root) · imm <immuneCount>`
- `CC done: <timeSec>s (cd/hard/root) · imm <immuneCount>`

and, where non-zero, append `dmg→imm <n> · heal→imm <n>`. Keep it compact; this is
validation output. Column/label adjustments stay minimal.

## 9. Components / file structure

```
src/metrics/types.ts        # CcSide + CcCategoryStat; UnitMetrics received/done + immune fields; resolvePlayer()
src/metrics/auraState.ts    # Interval gains srcId; add intervalsBy(srcId)
src/metrics/targeting.ts    # use shared resolvePlayer (drop local attackerOf/isPlayer)
src/metrics/ccTime.ts       # add sumCcDurations(); (computeCcDurations unchanged)
src/metrics/eventAccess.ts  # add immuneMiss(ev) (TDD-discovered)
src/metrics/perUnit.ts      # build received + done CcSide (player-only, pet→owner, done grouped-by-target-summed); landed-interrupt windows; immune accumulation; damage/healingIntoImmune
src/view/renderMetrics.ts   # two CC lines (recv/done) + immune; label tweaks
test/
  auraState.test.ts         # srcId captured; intervalsBy(src)
  resolvePlayer.test.ts     # player / pet→owner / NPC→undefined
  ccTime.test.ts            # sumCcDurations (add buckets, merge byCategory)
  eventAccessImmune.test.ts # immuneMiss discovered on fixture
  perUnit.test.ts           # received vs done; pet-cast CC rolled to owner; done summed across 2 targets; CC on a pet ignored; immune counts; dmg/heal into immune
  metrics.test.ts           # golden: ccReceived matches Cycle-1 received numbers; ccDone > 0 for an attacker; player-only (no creature CC)
  renderReport.test.ts      # updated UnitMetrics literals (ccReceived/ccDone); two CC lines render
```

## 10. Data flow

`buildAuraState` (now srcId-aware, `intervalsBy`) → `perUnit` per player:
received = `computeCcDurations(intervalsOn(me) ∩ enemy-player-casters, sufferedInterruptWindows)`;
done = `sumCcDurations( per enemy target: computeCcDurations(intervalsBy(me+pets)→target, landedInterruptWindows→target) )`;
immune events fold into both sides' `immuneCount` and `damage/healingIntoImmune`;
assemble `ccReceived`/`ccDone` `CcSide` → `renderMetrics` two-line CC display.

## 11. Error handling

- Source or target not resolving to a player → CC dropped (NPC/pet-on-pet noise).
- Pet with owner not a player → dropped.
- `intervalsBy(src)` empty → `ccDone` all zeros.
- `immuneMiss` undefined / no IMMUNE events in fixture → immune fields 0 (deferred sub-part).
- Self/same-team CC (shouldn't occur) → excluded by the opposite-team check (heal-into-immune is the deliberate same-team exception).
- Open-ended/unclosed CC auras and the per-instance cap behave exactly as Cycle 1 (the `done` path runs the same `computeCcDurations`).

## 12. Testing

- **resolvePlayer:** player→self; pet→owner; pet whose owner is a player; NPC/totem→undefined.
- **auraState:** `srcId` captured from APPLIED and retained after REMOVED/BROKEN; `intervalsBy(src)` returns that caster's intervals.
- **ccTime.sumCcDurations:** two parts → bucket fields add; `byCategory` merges per category; empty → zeros.
- **perUnit (synthetic, player-on-player):** a stun you applied to enemy A and a poly to enemy B → `ccDone.hardCcSec` = sum of both; re-applied stun on one enemy → that target unioned; a Felguard (pet) Axe Toss on an enemy → counted under the **owner's** `ccDone`; CC on your pet → ignored; CC from a creature → ignored; an immuned CC → `ccDone.immuneCount` on caster + `ccReceived.immuneCount` on target; damage into an immune enemy → `damageIntoImmune`.
- **eventAccess.immuneMiss:** discovered + asserted on the fixture (player-on-player immune event), or reported absent.
- **fixture golden:** `me.ccReceived` bucket values equal Cycle-1's received numbers (regression); `me.ccDone.timeSec > 0`; no NPC/creature appears with CC; bucket sums ≥ `timeSec` per side.

## 13. Out of scope

DR-progression multipliers (50/25/immune effective-duration) remain out of scope.
Aggregating CC into `CombinedTotals` (player+pets headline) stays out — CC is
per-unit. Match-segmentation of long matches (a separate matching concern) is
untouched.
