"""Probe A.3: do Demonic Gateway windows outrange the healer, and does the
pct_time_beyond_heal_range sampling timeline even cover those seconds?"""
import numpy as np

from wae.probe_healer_range import gateway_cast_times, probe_match


def _blob(me_samples, healer_samples, casts):
    return {
        "playerUnitId": "P",
        "teams": [
            {"team": "friendly", "players": [
                {"player": {"unitId": "P", "team": "friendly", "spec": "265"}},
                {"player": {"unitId": "H", "team": "friendly", "spec": "270"}},
            ]},
            {"team": "enemy", "players": [
                {"player": {"unitId": "E", "team": "enemy", "spec": "71"}},
            ]},
        ],
        "positionTracks": [
            {"unitId": "P", "samples": me_samples, "breaks": []},
            {"unitId": "H", "samples": healer_samples, "breaks": []},
        ],
        "timeline": [
            {"tSec": t, "unitId": u, "kind": "cast", "spell": s} for (t, u, s) in casts
        ],
    }


def s(t, x, y=0.0):
    return {"tSec": t, "x": x, "y": y}


def test_gateway_cast_times_only_players_gateways():
    blob = _blob([], [], [
        (2.0, "P", "Demonic Gateway"),
        (5.0, "P", "Corruption"),
        (9.0, "E", "Demonic Gateway"),   # enemy lock's gateway: not ours
    ])
    assert gateway_cast_times(blob) == [2.0]


def test_probe_flags_outranged_window_and_reports_metric_coverage():
    # Me: at x=0 until t=10, then teleported to x=50 (gateway) with samples at 11..15.
    me = [s(t, 0.0) for t in range(0, 11)] + [s(t, 50.0) for t in (11, 12, 13, 14, 15)]
    # Healer parked at x=0 the whole time.
    healer = [s(t, 0.0) for t in range(0, 16)]
    blob = _blob(me, healer, [(10.0, "P", "Demonic Gateway")])
    (c,) = probe_match(blob)["casts"]
    # raw-sample truth: the whole +1..+5s window sits 50yd from the healer
    assert c["max_dist"] == 50.0
    assert c["frac_beyond"] == 1.0
    # the current metric samples on MY track timeline: 5 of my samples fall in the window
    assert c["metric_samples_in_window"] == 5


def test_probe_reports_uncovered_window_when_my_track_is_silent():
    # Same teleport but I emit NO samples between 10 and 16 (position unknown in transit):
    # raw interp still says far (lerp 0->50 reaches >40 quickly), but the metric timeline
    # has nothing to sample there.
    me = [s(t, 0.0) for t in range(0, 11)] + [s(16, 50.0), s(17, 50.0)]
    healer = [s(t, 0.0) for t in range(0, 18)]
    blob = _blob(me, healer, [(10.0, "P", "Demonic Gateway")])
    out = probe_match(blob)
    (c,) = out["casts"]
    assert c["metric_samples_in_window"] == 0


def test_teleport_jump_times_finds_unbreaked_jumps():
    from wae.probe_healer_range import teleport_jump_times

    track = {
        "samples": [s(0, 0), s(1, 2), s(2, 4), s(2.5, 40), s(3, 41), s(10, 45), s(10.4, 90)],
        "breaks": [10.2],  # the t=10.4 jump is a Demonic Circle teleport (breaked) — excluded
    }
    # t=2->2.5 jumps 36yd with no break nearby = a gateway traversal
    assert teleport_jump_times(track) == [2.0]


def test_probe_none_when_no_healer_or_no_gateways():
    blob = _blob([s(0, 0), s(1, 0)], [s(0, 0), s(1, 0)], [(1.0, "P", "Corruption")])
    assert probe_match(blob)["casts"] == []
    no_healer = _blob([s(0, 0)], [], [(1.0, "P", "Demonic Gateway")])
    no_healer["teams"][0]["players"] = [no_healer["teams"][0]["players"][0]]
    no_healer["positionTracks"] = [no_healer["positionTracks"][0]]
    assert probe_match(no_healer) is None
