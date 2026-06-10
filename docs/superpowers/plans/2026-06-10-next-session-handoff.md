# Next-session handoff — correlate research v3 + local-coach smoketest

**Written 2026-06-10 at session end.** Context: `analysis/` pipeline (PRs #32–#34) produces
`output/analysis/influence-*.{md,json}` (screen + models + anchors + categorical + death atlas)
over 881 ranked 3v3 matches; vector-LoS prototype + correction editor shipped (PRs #35–#36,
user paints corrections separately — do NOT block on it). Memory:
`project_wae_correlate_mining.md`. Run everything from `analysis/` with
`.\.venv\Scripts\python -m wae [...]`; tests `-m pytest tests -q`.

## A. Research v3 — combinatorials + season-transcendent features

1. **Interaction mining (the user's explicit ask: "this metric and this metric together").**
   - Explicit screen: for the top ~25 process features, fit `logit(win ~ MMR + A + B + A·B)`
     per pair and LR-test the interaction term; BH-FDR over all pairs (~300 tests). Report
     the surviving pairs with a 2×2 quartile win-rate table each (readable form: "high
     casts/min AND low melee-time → 71% WR; high casts/min alone → 61%").
   - Model side: GBM already captures interactions implicitly — add Friedman's H-statistic
     (or SHAP interaction values via the `shap` package) on the top features to surface which
     pairs the model actually uses.
   - User-named candidates to include even if not top-25: duration × character/spec,
     MMR-band × everything (split screens at MMR median), map × kiting metrics,
     enemy-healer-class × kill-target choice.
2. **Season-transcendent features** (survive across seasons unlike spell mix/comp):
   - Activity ratios: casts/min (have), moving-vs-stationary fraction (have the parts),
     casts-while-moving proxy?, time-in-CC fraction (have), GO cadence (have).
   - **Map-position features, map-normalized**: distance-from-arena-center percentile (use
     occupancy grid bounds), edge-proximity fraction, % time in own-half vs enemy-half
     (define by starting positions), area-coverage (convex hull of my track / map area).
     These are mechanics-free → comparable across seasons; build them in the foundry now,
     validate within-season, and tag them `transseasonal: true` in the influence.json so the
     coach can prefer them when seasons change.
   - Note in report: spell-mix/openers/comp findings are SEASONAL (12.0-only by design of the
     season-gated ingest).
3. **Healer-range metric validation (user flagged `pct_time_beyond_heal_range` ~3.5% mean as
   suspiciously low — "every Gateway press outranges my healer").**
   - Distribution already checked: 95.6% of matches register >0, median dist 13yd — not stuck,
     but possibly under-measured.
   - **Prime suspect: teleport breaks.** `buildPositionTracks` inserts breaks at mobility
     casts (Demonic Gateway/Circle ARE mobility) — the post-teleport seconds may be
     position-unknown and NaN-padded out of the % in `position_features`. Probe: for every
     Demonic Gateway cast, compute dist-to-healer at cast+1..+5s from the RAW samples; report
     how often it exceeds 40 and how much of that window the current metric actually covers.
     If confirmed: compute the metric from raw samples (no break-masking) or add
     `time_beyond_heal_range_sec` event-locked variants (e.g. `post_gateway_outrange_sec`).
   - Also reconcile with `avgHealerDistanceYd` (TS-side, spacing.ts) — two implementations of
     the same concept should agree.
4. **Smaller carried items:** spell SEQUENCE beyond openers (mid-game n-grams; seasonal — fine);
   `our_drd_cc_frac` got cleaner data after more matches?; categorical screen for
   ally-comp ARCHETYPE (melee/caster counts need a spec→archetype map); calibration plot.

## B. Data-sufficiency verdict (carry into the report to the user)

With n=881 (580 Phlares / 292 Phluglishph), session-grouped CV:
- **Sufficient NOW:** percentile anchors per feature; top-~30 robust correlates (medium+
  effects); calibrated logistic win-probability (Brier ~0.17 process-scope); categorical
  matchup tables down to ~50-game slices (enemy healer class, main-target class, maps).
- **Marginal:** interaction mining (expect a handful of survivors, not a matrix); per-map ×
  per-matchup combined slices (<30 games — anchors only, no significance).
- **NOT sufficient:** deep/sequence models; per-enemy-comp (exact 3-spec) models; causal
  claims. Growth: ~40-60 matches/week of play → interaction power improves meaningfully by
  ~1.5-2k matches; design everything to re-run cheaply (it already does).
- Coaching sophistication ceiling today: **descriptive-contextual coach** (place the match
  against history, name the deviating features, cite matchup priors) — solid and honest.
  Prescriptive "do X next time" requires causal care; frame suggestions as correlations.

## C. Local-coach MVP smoketest (the user's 3090 awaits a real local LLM later; THIS session
simulate the agent with a Claude sub-agent)

1. **Build the context pack** (deterministic, no LLM): `python -m wae.coach --match latest`
   (new module) emits `output/analysis/coach-context-<matchId>.json`:
   - the match's feature vector + per-feature percentile vs the win and loss anchor
     distributions (influence.json), flagged where it sits in loss-territory;
   - matchup priors: enemy healer class WR, my main-target class WR, map WR + death-atlas
     row for that map, opener-pattern WR;
   - the favor/GO summary for the match (windows, lethal GOs, defensives-up);
   - top global correlates for orientation; caveats block.
2. **Smoketest**: feed the context pack to a fresh sub-agent with a coach persona prompt
   ("you are an arena coach; using ONLY this JSON, produce: 3 things done well, 3 deviations
   from winning patterns with the numbers, matchup briefing, 2 concrete focus points — no
   invented facts"). Evaluate: does it ground every claim in the pack? Show the user the
   transcript + the pack.
3. **Then spec the local runtime** (build only if time): same pack + prompt via llama.cpp or
   Ollama on the 3090 (Qwen2.5-14B/32B-instruct Q4 fits) — the pack design makes the model
   swappable; Claude-subagent vs local-LLM output comparison is the acceptance test.
4. The pack generator is the durable artifact — the agent layer is thin on purpose.

## Workflow reminders

TDD per CLAUDE.md; /simplify + /code-review per PR; sequential PRs to master (no stacking);
re-runs of `python -m wae` after foundry changes; the season-gated ingest means a bare
re-ingest is cheap if new games were played (run it first to freshen the store).
