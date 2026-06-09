import numpy as np
import pandas as pd
from wae.screen import bh_qvalues, rank_biserial, screen


def test_bh_qvalues_known_example():
    p = np.array([0.01, 0.04, 0.03, 0.005])
    q = bh_qvalues(p)
    # sorted p: .005,.01,.03,.04 -> q: .02,.02,.04,.04
    assert np.allclose(sorted(q), [0.02, 0.02, 0.04, 0.04])


def test_rank_biserial_sign():
    wins = np.array([5.0, 6, 7, 8])
    losses = np.array([1.0, 2, 3, 4])
    assert rank_biserial(wins, losses) == 1.0
    assert rank_biserial(losses, wins) == -1.0


def test_screen_finds_a_real_signal():
    rng = np.random.default_rng(0)
    n = 200
    y = rng.integers(0, 2, n)
    signal = y * 2.0 + rng.normal(0, 1, n)      # strongly associated
    noise = rng.normal(0, 1, n)                  # not associated
    mmr = rng.normal(2400, 100, n)
    df = pd.DataFrame({"win": y, "mmr": mmr, "signal": signal, "noise": noise})
    out = screen(df, ["signal", "noise"], {"signal": "process", "noise": "process"})
    sig_row = out[out.feature == "signal"].iloc[0]
    noise_row = out[out.feature == "noise"].iloc[0]
    assert sig_row.q_raw < 0.01 and sig_row.rank_biserial > 0.5
    assert noise_row.p_raw > 0.05
    assert sig_row.p_mmr_adj < 0.01              # survives MMR adjustment
