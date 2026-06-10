"""Probe A.3 (handoff 2026-06-10): for every Demonic Gateway cast by the recording player,
measure dist-to-healer at cast+1..+5s from RAW samples (plain lerp, no break/gap logic) and
how many of the current metric's sampling instants (my own track timeline, the timeline
pct_time_beyond_heal_range averages over) fall inside that window.

Run: .venv\\Scripts\\python -m wae.probe_healer_range [--character Phlares] [--db PATH]
"""
from __future__ import annotations

import numpy as np

from .features import HEAL_RANGE_YD, _team_maps, _track_interp, friendly_healer_id

WINDOW_OFFSETS = (1.0, 2.0, 3.0, 4.0, 5.0)


def gateway_cast_times(blob: dict) -> list[float]:
    """tSec of every Demonic Gateway cast by the recording player."""
    player = blob.get("playerUnitId")
    return [ev.get("tSec", 0.0) for ev in blob.get("timeline", [])
            if ev.get("kind") == "cast" and ev.get("spell") == "Demonic Gateway"
            and ev.get("unitId") == player]


JUMP_MIN_YD = 15.0   # max run speed ~11yd/s: >15yd inside <1.5s is a teleport, not running
JUMP_MAX_DT = 1.5
JUMP_BREAK_TOL_SEC = 1.0


def teleport_jump_times(track: dict, min_yd: float = JUMP_MIN_YD,
                        max_dt: float = JUMP_MAX_DT) -> list[float]:
    """tSec of teleport-like jumps in a RAW track that are NOT explained by a recorded
    mobility break (Demonic Circle etc.) — i.e. Demonic Gateway traversals, which emit no
    cast event of their own. Returns the pre-jump sample time."""
    samples = track.get("samples", [])
    breaks = track.get("breaks", [])
    out = []
    for a, b in zip(samples, samples[1:]):
        dt = b["tSec"] - a["tSec"]
        d = float(np.hypot(b["x"] - a["x"], b["y"] - a["y"]))
        if d > min_yd and dt < max_dt and not any(
                a["tSec"] - JUMP_BREAK_TOL_SEC <= bk <= b["tSec"] + JUMP_BREAK_TOL_SEC for bk in breaks):
            out.append(a["tSec"])
    return out


def probe_match(blob: dict, offsets: tuple[float, ...] = WINDOW_OFFSETS,
                range_yd: float = HEAL_RANGE_YD) -> dict | None:
    """Per-gateway-cast outrange truth (raw samples) vs current-metric coverage.
    None when the match has no usable player/healer tracks."""
    team, spec = _team_maps(blob)
    player = blob.get("playerUnitId")
    tracks = {tr.get("unitId"): tr for tr in blob.get("positionTracks", [])}
    healer_id = friendly_healer_id(team, spec, player)
    me = _track_interp(tracks.get(player, {})) if player in tracks else None
    he = _track_interp(tracks.get(healer_id, {})) if healer_id in tracks else None
    if me is None or he is None:
        return None
    t_me, x_me, y_me = me
    t_he, x_he, y_he = he

    def raw_dist(at: np.ndarray) -> np.ndarray:
        ok = (at >= max(t_me[0], t_he[0])) & (at <= min(t_me[-1], t_he[-1]))
        d = np.full(len(at), np.nan)
        d[ok] = np.hypot(np.interp(at[ok], t_me, x_me) - np.interp(at[ok], t_he, x_he),
                         np.interp(at[ok], t_me, y_me) - np.interp(at[ok], t_he, y_he))
        return d

    def window(tc: float) -> dict | None:
        at = tc + np.asarray(offsets)
        d = raw_dist(at)
        if not np.isfinite(d).any():
            return None
        # the current metric averages over MY sample times (with a valid healer interp)
        in_win = (t_me >= at[0]) & (t_me <= at[-1]) & (t_me >= t_he[0]) & (t_me <= t_he[-1])
        return {
            "t_cast": float(tc),
            "max_dist": float(np.nanmax(d)),
            "frac_beyond": float(np.nanmean(d > range_yd)),
            "metric_samples_in_window": int(in_win.sum()),
        }

    return {
        "casts": [w for tc in gateway_cast_times(blob) if (w := window(tc)) is not None],
        "traversals": [w for tc in teleport_jump_times(tracks.get(player, {}))
                       if (w := window(tc)) is not None],
    }


def main() -> None:
    import argparse
    from collections import Counter

    from .db import REPO_ROOT, assign_sessions, iter_blobs, load_matches

    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(REPO_ROOT / "wow-arena-eye.local.db"))
    ap.add_argument("--character", default=None)
    args = ap.parse_args()

    rows = load_matches(args.db, character=args.character)
    assign_sessions(rows)
    agg = Counter()
    windows = {"casts": [], "traversals": []}
    for _mid, blob in iter_blobs(args.db, [r["match_id"] for r in rows]):
        out = probe_match(blob)
        if out is None:
            agg["no_tracks"] += 1
            continue
        agg["matches"] += 1
        for kind in windows:
            windows[kind].extend(out[kind])

    print(f"matches probed: {agg['matches']} (no usable tracks: {agg['no_tracks']})")
    for kind, label in (("casts", "gateway PLACEMENT casts"),
                        ("traversals", "teleport TRAVERSALS (unbreaked >15yd jumps)")):
        ws = windows[kind]
        print(f"\n{label}: {len(ws)}")
        if not ws:
            continue
        md = np.asarray([w["max_dist"] for w in ws])
        cv = np.asarray([w["metric_samples_in_window"] for w in ws])
        n_out = int((md > HEAL_RANGE_YD).sum())
        print(f"  +1..+5s window exceeds {HEAL_RANGE_YD:.0f}yd (raw samples): "
              f"{n_out} ({100 * n_out / len(ws):.1f}%)")
        print(f"  max dist in window: median {np.median(md):.1f}yd, p90 {np.percentile(md, 90):.1f}yd")
        print(f"  metric samples inside the window: median {np.median(cv):.0f}, "
              f"zero-coverage: {(cv == 0).sum()} ({100 * (cv == 0).mean():.1f}%)")


if __name__ == "__main__":
    main()
