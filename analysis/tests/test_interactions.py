"""A.1 interaction mining: pairwise logit LR tests with BH-FDR, 2x2 median-split
win-rate tables, and Friedman's H-statistic on the GBM."""
import numpy as np
import pandas as pd
import pytest

from wae.interactions import (friedman_h, lr_interaction_p, median_2x2, pair_screen)

RNG = np.random.default_rng(11)
N = 600


def _logistic(z):
    return 1 / (1 + np.exp(-z))


def _interacting_frame():
    """win depends on A*B (pure interaction), C is additive noise."""
    a = RNG.normal(0, 1, N)
    b = RNG.normal(0, 1, N)
    c = RNG.normal(0, 1, N)
    mmr = RNG.normal(2400, 150, N)
    y = (RNG.random(N) < _logistic(1.8 * a * b)).astype(float)
    return pd.DataFrame({"win": y, "mmr": mmr, "A": a, "B": b, "C": c})


DF = _interacting_frame()


def test_lr_interaction_detects_pure_interaction():
    p = lr_interaction_p(DF["win"].to_numpy(), DF["mmr"].to_numpy(),
                         DF["A"].to_numpy(), DF["B"].to_numpy())
    assert p < 1e-6


def test_lr_interaction_quiet_on_independent_pair():
    p = lr_interaction_p(DF["win"].to_numpy(), DF["mmr"].to_numpy(),
                         DF["A"].to_numpy(), DF["C"].to_numpy())
    assert p > 0.01


def test_median_2x2_cells():
    y = np.array([1, 1, 0, 0, 1, 0, 1, 1])
    a = np.array([1.0, 2, 3, 4, 1, 2, 3, 4])   # median 2.5
    b = np.array([4.0, 3, 2, 1, 4, 3, 2, 1])   # median 2.5
    cells = median_2x2(y, a, b)
    # a-hi & b-lo: a in {3,4}, b in {2,1} -> wins 0,0,1,1 -> wr 0.5, n 4
    assert cells["hi_lo"]["n"] == 4
    assert cells["hi_lo"]["wr"] == pytest.approx(0.5)
    assert cells["lo_hi"]["n"] == 4
    assert sum(c["n"] for c in cells.values()) == 8


def test_pair_screen_fdr_survival_and_table():
    out = pair_screen(DF, [("A", "B"), ("A", "C"), ("B", "C")])
    assert list(out.columns[:2]) == ["feature_a", "feature_b"]
    ab = out[(out.feature_a == "A") & (out.feature_b == "B")].iloc[0]
    assert ab["q"] < 0.05
    assert "cells" in out.columns
    # the AB interaction is XOR-shaped: diagonal cells (hi_hi, lo_lo) win more
    cells = ab["cells"]
    assert cells["hi_hi"]["wr"] > cells["hi_lo"]["wr"]
    assert cells["lo_lo"]["wr"] > cells["lo_hi"]["wr"]


def test_pair_screen_skips_constant_and_sparse():
    df = DF.copy()
    df["K"] = 1.0
    out = pair_screen(df, [("A", "K")])
    assert out.empty


def test_report_carries_interactions_block(tmp_path):
    import json
    from wae import report

    df = pd.DataFrame({"win": [1.0, 0.0] * 40, "session_id": ["s"] * 80,
                       "match_id": [str(i) for i in range(80)]})
    screen_df = pd.DataFrame([{
        "feature": "x", "tier": "process", "n": 80, "median_win": 1.0, "median_loss": 0.0,
        "rank_biserial": 0.1, "p_raw": 0.5, "p_mmr_adj": 0.5, "q_raw": 0.5, "q_mmr_adj": 0.5,
    }])
    inter = pd.DataFrame([{"feature_a": "A", "feature_b": "B", "n": 80, "p": 0.001, "q": 0.03,
                           "cells": {"lo_lo": {"n": 20, "wr": 0.6}, "lo_hi": {"n": 20, "wr": 0.4},
                                     "hi_lo": {"n": 20, "wr": 0.4}, "hi_hi": {"n": 20, "wr": 0.7}}}])
    h2 = pd.DataFrame([{"feature_a": "A", "feature_b": "B", "h2": 0.21}])
    report.write_reports(tmp_path, "test", df, screen_df, [], [], [], [],
                         interactions=inter, gbm_h2=h2)
    payload = json.loads((tmp_path / "influence-test.json").read_text(encoding="utf8"))
    assert payload["interactions"]["pairs"][0]["q"] == 0.03
    assert payload["interactions"]["gbm_h2"][0]["h2"] == 0.21
    md = (tmp_path / "influence-test.md").read_text(encoding="utf8")
    assert "Interaction mining" in md


def test_friedman_h_ranks_interacting_pair_highest():
    h = friedman_h(DF, ["A", "B", "C"], DF["win"].to_numpy())
    top = h.iloc[0]
    assert {top["feature_a"], top["feature_b"]} == {"A", "B"}
    others = h.iloc[1:]["h2"].max()
    assert top["h2"] > others * 2
