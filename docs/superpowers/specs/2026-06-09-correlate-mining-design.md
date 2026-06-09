# Win/Loss Correlate Mining (AI-coach substrate) — Design

**Date:** 2026-06-09
**Status:** MVP built same-day (user away; goal = runnable MVP + real first findings)

## Problem

925 season-12.0 matches (881 ranked 3v3; 580 Phlares / 305 Phluglishph; ~46% loss rate)
sit in the store with ~40 scalar metrics each plus a full `match_detail` blob (timelines,
GO windows, position tracks, CC, coordination). The user wants the win/loss **correlates
beyond the obvious** — behavioral/process conditions (range kept to roles, early CC, cast
mix, durations per spec, map, all conditioned on CR/MMR) — surfaced systematically, as the
substrate an AI coach will later use to compare a current game against history with
"data anchors".

## Grounding (literature consensus)

- Esports win prediction is established practice: logistic regression / RF / GBM are the
  standard models; explainability via feature-importance is the standard deliverable
  ([live Dota 2 win prediction](https://www.researchgate.net/publication/336990588),
  [MOBA/FPS survey](https://www.researchgate.net/publication/379519411),
  [explainable streaming esports prediction](https://arxiv.org/html/2510.19671v1)).
- Mass univariate screening needs FDR control — Benjamini-Hochberg is the standard
  ([BH method](https://arxiv.org/pdf/math/0611265)); keep selected features well under
  n/4; classic events-per-variable guidance (~10–20 events/predictor) bounds unregularized
  models — with ~280 loss-events that's ≲20 predictors unregularized, so multivariate
  models are **regularized** (elastic-net) and validated out-of-fold.
- Repeated-measures leakage: matches within one queue session share comp/opponents/MMR/
  mental state → CV must be **grouped by session**
  ([GroupKFold](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.GroupKFold.html)).
- Importance: **permutation importance on held-out folds** (never in-sample); correlated
  features split importance, so report alongside a Spearman-correlation clustering
  ([permutation importance](https://scikit-learn.org/stable/modules/permutation_importance.html),
  [interpretable-ML book ch. 23](https://christophm.github.io/interpretable-ml-book/feature-importance.html)).

## Domain decisions

1. **Feature tiers** (the "beyond the obvious" mechanism):
   - **process** — things the player controls during play (range kept, early CC, cast mix,
     kick timing, GO favor, positioning). These are the coachable findings.
   - **context** — fixed at queue time (map, comp, MMR/CR, character, session position,
     time of day, duration*). Duration is context-ish but outcome-influenced (dampening) —
     reported in context tier with a caveat.
   - **outcome-adjacent** — near-restatements of the result (deaths, first death, damage
     totals, lethal GOs). Included for model ceiling + sanity, but reported separately so
     they don't drown the coachable tier.
2. **MMR always conditioned**: screening reports both raw and MMR-adjusted association
   (feature → outcome with MMR as covariate in a 2-variable logit); models always include
   MMR/CR. User's insight: winning conditions change with opponent caliber.
3. **Per-character and pooled runs**: pooled 3v3 (character as feature) + per-character
   splits (Phlares n=580, Phluglishph n=305).
4. **Rates over totals** for accumulating metrics (per-minute), mirroring the C1 scorecard
   lesson.
5. **Session grouping** replicated in Python from (character, bracket, >30 min gap) — same
   semantics as `sessionize`.

## Architecture

`analysis/` — a Python 3.13 sidecar package (**SQLite is the language-agnostic contract**;
this is the long-planned "Python joins later via the DB" moment). Own venv +
requirements.txt; never imports TS. Reads `wow-arena-eye.local.db`, writes
`output/analysis/`:

- `wae/db.py` — match frame (filters: bracket/season/ranked), metric pivot, detail blobs,
  combatant comp, session ids.
- `wae/features.py` — the **feature foundry** (pure: blob dict → feature dict):
  - scalar metrics (+ per-minute rate variants)
  - context: duration, map one-hot, character, CR, MMR, game # within session, hour-of-day
  - comp: ally healer class, enemy class flags, enemy healer class
  - timeline-derived: early CC by us on them (≤20s/≤30s counts), first kick landed/taken
    time, casts/min, per-spell casts/min (spells cast in ≥20% of matches), first death
    time + side (outcome-adjacent)
  - GO-derived: enemy/our GO counts/min, first enemy GO time, mean favor inputs
    (offense-ready vs defensives-up), enemy GO damage/min, lethal-GO fraction
    (outcome-adjacent)
  - position-derived: % time >40yd from own healer, median distance to nearest enemy,
    % time in enemy melee range (8yd)
  - coordination: alignment fraction, swaps/min (ours + theirs)
- `wae/screen.py` — per feature: Mann-Whitney U + rank-biserial effect size, MMR-adjusted
  logit p, BH-FDR q-values across the whole screen.
- `wae/model.py` — sklearn Pipelines (median impute → standardize → elastic-net
  LogisticRegressionCV; HistGradientBoosting), StratifiedGroupKFold(5) by session;
  out-of-fold ROC-AUC/Brier; held-out permutation importance aggregated across folds;
  greedy Spearman-correlation clusters (|ρ|>0.7) reported with importances.
- `wae/report.py` — `influence-report.md` (human) + `influence.json` (the agent artifact:
  per-feature tier, direction, effect size, q-value, model importance, and **anchors** =
  win/loss distribution quantiles so an agent can place a live match in context).
- `wae/cli.py` — `python -m wae --db ... --bracket 3v3 [--character X]`.
- `tests/` — pytest over the pure foundry/stat helpers (synthetic blobs).

## Honesty constraints (carried into the report)

- n≈580/305 → only medium+ effects are detectable; absence of significance ≠ absence of
  effect.
- Correlation ≠ causation; process features especially can be confounded by game state
  (e.g. "kept range" may be possible *because* winning).
- Solo Shuffle absent from the store (parser emits standard arena only) — noted gap.
- Precognition *instance counts before 60s* (user ask) need a new persisted metric
  (current store has uptime seconds only) — listed as foundry TODO requiring re-ingest.

## Out of scope (MVP)

LLM/agent itself; cross-season transfer; per-enemy-player modeling; live in-match
prediction; deep nets (data scale forbids).
