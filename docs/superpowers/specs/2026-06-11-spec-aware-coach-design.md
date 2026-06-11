# Spec-aware coach contextualization — design

*2026-06-11. Follows the 2026-06-10 coach-pack work (PRs #38–#43). User-driven: the
grounded smoketest produced coaching logic that misread positional signals because it
placed them against GLOBAL win/loss anchors, ignoring enemy composition.*

## Problem

The coach pack places every feature against the pooled win/loss distributions. But the
meaning of positional metrics flips with the enemy comp:

- **Time in enemy melee range vs a melee comp** means they have uptime on me (bad), or
  that damage is going into a teammate instead. **Vs a caster comp** it can mean the
  opposite — I have access to a target that ran out of position. Low Haunts + low melee
  time vs casters likely means they are LoS-ing me, a different coaching point entirely.
- **Distance from enemy X** confers advantage when X is melee and I am ranged; when X is
  ranged it says little — positional structure (stacked with healer, LoS asymmetry)
  dominates raw distance.
- **Targeting math** should be spec-aware: which enemy comps kill which of us first, and
  with what win rate, is a matchup prior the coach currently lacks.

n = ~925 matches. Sufficiency verdict (influence.json): categorical slices are honest at
≥50 games; exact 3-spec enemy comps are NOT sufficient — condition on **comp archetype**
(`enemy_comp_archetype`, e.g. `2melee+healer`) and **class presence** flags, never exact
3-spec comps.

## Scope

**Phase 1 (this PR — Python sidecar only, no re-ingest):**

1. **`first_death_role`** (features.py, outcome tier, categorical):
   role of the first death in the match — `me` | `healer_ally` | `dps_ally` | `enemy`.
   Derived in `timeline_features` from the first death event + team/spec maps
   (healer via `friendly_healer_id`). Replaces nothing; `first_death_sec` /
   `first_death_ours` stay.

2. **Targeting cross-tab** (`wae/targeting.py`, new):
   `first_death_crosstab(df)` — for each level of each conditioning variable
   (`enemy_comp_archetype`, `enemy_healer_class`, and each `enemy_has_<Class>` flag,
   levels with n ≥ 15), report: n, win_rate, and among LOSSES the share of
   `first_death_role` ∈ {me, dps_ally, healer_ally} (with n_loss), plus win rate when
   each role dies first. Descriptive (Wilson CI on win rates; no new FDR family — these
   are priors, not discoveries). Wired into:
   - influence.json: `targeting_crosstab` block; influence.md: new section.
   - coach pack: `targeting_priors` — the rows matching THIS match's enemy archetype and
     enemy healer class (omitted when no row, mirroring `matchup_priors`).

3. **Comp-conditioned anchors** (report.py + coach.py):
   - `COMP_SENSITIVE_FEATURES` registry (report.py): the positional/pacing features whose
     meaning shifts with enemy comp — `pct_time_in_enemy_melee`,
     `median_dist_nearest_enemy_yd`, `spacing_meleeRangeSec_per_min`,
     `spacing_isolatedSec_per_min`, `median_dist_to_healer_yd`,
     `pct_time_beyond_heal_range`, `distanceMoved_per_min`, `timeStationarySec_per_min`,
     `center_dist_frac_mean`, `edge_proximity_frac`, `own_half_time_frac`,
     `map_area_coverage_frac`, `damageDone_per_min`, `my_time_on_enemy_healer_frac`,
     `our_go_per_min`, `enemy_go_per_min`.
   - `anchors_by_archetype(df, features)`: per `enemy_comp_archetype` level with
     n ≥ 50, reuse `anchors_for` on the slice (its ≥15-win/≥15-loss per-feature gate
     stands). influence.json: `anchors_by_enemy_archetype: {label: {n, win_rate, anchors}}`.
   - coach pack: for each placed feature, when this match's archetype has a conditional
     anchor, add a `vs_this_comp` sub-block — same placement fields + `comp_n` — next to
     the global placement. Global placement stays; the agent layer chooses.
   - `coach_prompt.md`: instruct the persona to prefer `vs_this_comp` placement for
     positional metrics and to interpret melee-uptime/distance through the enemy
     archetype (uptime vs melee comp ≠ access vs caster comp), and to use
     `targeting_priors` when discussing kill targets / who is likely to die first.

4. **Interaction pairs** (interactions.py): add explicit
   `enemy_melee_count × KITING_METRICS` pairs to `candidate_pairs` — the empirical test
   of the sign-flip hypothesis (does melee-uptime's relationship to winning invert with
   comp?). Same BH family as the rest.

**Phase 2 (separate PR — TS metrics + force re-ingest): LoS asymmetry.**
Per-match scalars from the LoS engine (`clearFraction` machinery): fraction of match
time where ≥1 enemy has clear LoS to me while my healer does NOT (`losEnemyNotHealerSec`
and the inverse). Z-axis maps inherit the `approximate` flag. Featurized as
`pct_time_los_enemy_not_healer` (transseasonal). Requires re-ingest of ~925 matches, so
it ships separately after Phase 1 lands.

## Non-goals

- Exact 3-spec comp conditioning (insufficient n — stated above).
- New FDR families for the cross-tab (descriptive priors only).
- Changing how the agent layer is invoked; the pack stays the swap contract.

## Testing

TDD throughout. New tests: `test_features` addition for `first_death_role` role
resolution (me / healer / dps / enemy first); `test_targeting.py` for the cross-tab
(loss-share math, level gating, role win rates); `test_report.py` addition for
`anchors_by_archetype` gating; `test_coach.py` additions for `vs_this_comp` placement
and `targeting_priors` selection. Full pipeline run against the real store as the
integration check (new blocks present, no NaN leakage into JSON).
