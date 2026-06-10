"""V2 foundry: targeting choice, enemy pressure distribution, opener shape, CC sent into
DR, and death context (user-directed second pass, 2026-06-09)."""
from __future__ import annotations

import numpy as np

from .db import HEALER_SPEC_IDS
from .features import _t, _team_maps, _track_interp, friendly_healer_id

DR_WINDOW_SEC = 18.0   # cast-to-cast approximation of "sent into diminishing returns"
OPENER_SPELLS = 3      # first-N player casts define the opener pattern
DOT_SPELLS = {"Agony", "Corruption", "Unstable Affliction", "Vile Taint", "Siphon Life", "Haunt"}


def targeting_features(blob: dict, spec_table: dict) -> dict:
    """Who *I* put my attention on: main-target identity + focus fractions, from the
    damage-weighted dominant-target ticks (focusTracks)."""
    out: dict = {}
    team, spec = _team_maps(blob)
    player = blob.get("playerUnitId")
    ft = blob.get("focusTracks") or {}
    mine = next((tr for tr in ft.get("tracks", []) if tr.get("attacker") == player), None)
    if not mine:
        return out
    # only PLAYER targets count - a pet can win a damage tick (e.g. bursting a Mindbender)
    # but "main target choice" is about which player I committed to
    ticks = [t for t in mine.get("ticks", []) if t and t in team]
    if not ticks:
        return out
    counts: dict[str, int] = {}
    for t in ticks:
        counts[t] = counts.get(t, 0) + 1
    main, main_n = max(counts.items(), key=lambda kv: kv[1])
    out[_t("process", "my_time_on_main_target_frac")] = main_n / len(ticks)
    main_spec = spec.get(main)
    out[_t("process", "my_main_target_class")] = spec_table.get(str(main_spec), {}).get("className", "Unknown")
    out[_t("process", "my_main_target_is_healer")] = 1.0 if str(main_spec) in HEALER_SPEC_IDS else 0.0
    healer_ticks = sum(n for u, n in counts.items() if str(spec.get(u)) in HEALER_SPEC_IDS)
    out[_t("process", "my_time_on_enemy_healer_frac")] = healer_ticks / len(ticks)
    return out


def enemy_pressure_features(blob: dict) -> dict:
    """Where the ENEMY damage went on our team: share on me / our healer, and how
    concentrated their focus was (HHI). Context tier - their choice, not my lever."""
    out: dict = {}
    team, spec = _team_maps(blob)
    player = blob.get("playerUnitId")
    names = {}  # our player name -> unitId
    for tg in blob.get("teams", []):
        if tg.get("team") != "friendly":
            continue
        for pg in tg.get("players", []):
            p = pg.get("player", {})
            names[p.get("name")] = p.get("unitId")
    enemy = next((c for c in blob.get("coordination", []) if c.get("team") == "enemy"), None)
    tp = (enemy or {}).get("summary", {}).get("targetPriority", [])
    dmg: dict[str, float] = {}  # aggregate per unitId - a name can appear more than once
    for e in tp:
        u = names.get(e.get("name"))
        if u is not None:
            dmg[u] = dmg.get(u, 0.0) + (e.get("damageTaken", 0) or 0)
    total = sum(dmg.values())
    if total <= 0:
        return out
    shares = {u: d / total for u, d in dmg.items()}
    out[_t("context", "enemy_dmg_share_on_me")] = shares.get(player, 0.0)
    healer = friendly_healer_id(team, spec, player)
    if healer:
        out[_t("context", "enemy_dmg_share_on_our_healer")] = shares.get(healer, 0.0)
    out[_t("context", "enemy_dmg_concentration")] = float(sum(s * s for s in shares.values()))
    return out


def opener_features(blob: dict) -> dict:
    """The shape of MY opener: ramp speed and first-CC timing, plus the first-N spell
    pattern as a categorical (screened by win rate, not as a numeric)."""
    out: dict = {}
    player = blob.get("playerUnitId")
    team, _ = _team_maps(blob)
    my_casts = [(ev.get("tSec", 0), ev.get("spell")) for ev in blob.get("timeline", [])
                if ev.get("kind") == "cast" and ev.get("unitId") == player and ev.get("spell")]
    my_casts.sort(key=lambda c: c[0])
    # logs occasionally double-emit a cast at the same second - dedup exact (tSec, spell) pairs
    # so the opener pattern isn't "X > X > Y"
    my_casts = [c for i, c in enumerate(my_casts) if i == 0 or c != my_casts[i - 1]]
    if my_casts:
        out[_t("process", "opener_pattern")] = " > ".join(s for _, s in my_casts[:OPENER_SPELLS])
        out[_t("process", "my_casts_first15s")] = float(sum(1 for t, _ in my_casts if t <= 15))
        out[_t("process", "dots_cast_first10s")] = float(sum(1 for t, s in my_casts if t <= 10 and s in DOT_SPELLS))
        haunt = next((t for t, s in my_casts if s == "Haunt"), None)
        if haunt is not None:
            out[_t("process", "time_to_first_haunt_sec")] = haunt
    my_first_cc = next((ev.get("tSec") for ev in blob.get("timeline", [])
                        if ev.get("kind") == "cc" and ev.get("unitId") == player
                        and team.get(ev.get("targetId")) == "enemy"), None)
    if my_first_cc is not None:
        out[_t("process", "my_first_cc_sec")] = float(my_first_cc)
    return out


def dr_cc_features(blob: dict, minutes: float) -> dict:
    """CC discipline: our CC casts on enemies that landed inside the DR window of a
    previous same-category CC on the same target (= wasted/cheapened control)."""
    out: dict = {}
    team, _ = _team_maps(blob)
    events = sorted(
        (ev for ev in blob.get("timeline", [])
         if ev.get("kind") == "cc" and team.get(ev.get("unitId")) == "friendly"
         and team.get(ev.get("targetId")) == "enemy"),
        key=lambda e: e.get("tSec", 0),
    )
    last: dict[tuple, float] = {}
    total = drd = 0
    for ev in events:
        key = (ev.get("targetId"), ev.get("extra"))
        t = ev.get("tSec", 0)
        total += 1
        if key in last and t - last[key] <= DR_WINDOW_SEC:
            drd += 1
        last[key] = t
    if minutes > 0:
        out[_t("process", "our_cc_casts_per_min")] = total / minutes
        out[_t("process", "our_drd_cc_per_min")] = drd / minutes
    if total:
        out[_t("process", "our_drd_cc_frac")] = drd / total
    return out


EDGE_PROXIMITY_FRAC = 0.15   # "near the edge" = within 15% of the half-extent of a bound
PLAYABLE_VOIDNESS_MAX = 0.5  # mirrors lineOfSight.ts CLEAR_MAX: below this a cell is open floor
HALF_SPLIT_START_SEC = 10.0  # team start centroids = mean position over the first N seconds


def _start_centroid(tracks: dict, unit_ids: list[str]) -> np.ndarray | None:
    """Mean early position of a team - the anchor for the own-half/enemy-half split."""
    pts = []
    for u in unit_ids:
        for smp in (tracks.get(u) or {}).get("samples", []):
            if smp["tSec"] <= HALF_SPLIT_START_SEC:
                pts.append((smp["x"], smp["y"]))
    return np.asarray(pts, dtype=float).mean(axis=0) if pts else None


def map_position_features(blob: dict, grid: dict | None) -> dict:
    """A.2 transseasonal map-position features, map-normalized so they compare across
    arenas AND seasons (mechanics-free: distance/area/side only).

    - center_dist_frac_mean: time-mean dist to arena center / half-diagonal (grid bounds)
    - edge_proximity_frac:   fraction of time within EDGE_PROXIMITY_FRAC of a bounds edge
    - own_half_time_frac:    fraction of time on my team's side of the perpendicular
                             bisector of the two teams' start centroids (grid-free)
    - map_area_coverage_frac: convex hull of my track / playable (non-void) area
    """
    out: dict = {}
    team, _spec = _team_maps(blob)
    player = blob.get("playerUnitId")
    tracks = {tr.get("unitId"): tr for tr in blob.get("positionTracks", [])}
    me = _track_interp(tracks.get(player, {})) if player in tracks else None
    if me is None:
        return out
    _t_me, x_me, y_me = me
    pts = np.column_stack([x_me, y_me])

    own = _start_centroid(tracks, [u for u, tm in team.items() if tm == "friendly"])
    foe = _start_centroid(tracks, [u for u, tm in team.items() if tm == "enemy"])
    if own is not None and foe is not None and np.hypot(*(foe - own)) > 1.0:
        mid = (own + foe) / 2.0
        normal = foe - own
        out[_t("process", "own_half_time_frac")] = float(np.mean((pts - mid) @ normal < 0))

    if not grid:
        return out
    b = grid["bounds"]
    cx, cy = (b["minX"] + b["maxX"]) / 2.0, (b["minY"] + b["maxY"]) / 2.0
    hx, hy = (b["maxX"] - b["minX"]) / 2.0, (b["maxY"] - b["minY"]) / 2.0
    if hx <= 0 or hy <= 0:
        return out
    out[_t("process", "center_dist_frac_mean")] = float(
        np.mean(np.hypot(x_me - cx, y_me - cy)) / np.hypot(hx, hy))
    # per-axis normalized distance to the nearest bound; near-edge if the minimum < threshold
    edge = np.minimum((hx - np.abs(x_me - cx)) / hx, (hy - np.abs(y_me - cy)) / hy)
    out[_t("process", "edge_proximity_frac")] = float(np.mean(edge < EDGE_PROXIMITY_FRAC))

    playable = sum(1 for v in grid["voidness"] if v < PLAYABLE_VOIDNESS_MAX) * grid["cellSize"] ** 2
    if playable > 0 and len(pts) >= 3:
        from scipy.spatial import ConvexHull, QhullError
        try:
            out[_t("process", "map_area_coverage_frac")] = float(
                min(1.0, ConvexHull(pts).volume / playable))
        except QhullError:
            pass  # degenerate (collinear) track - no hull, no feature
    return out


def voidness_at(grid: dict, x: float, y: float) -> float:
    """Mirror of lineOfSight.ts voidnessAt over the committed occupancy grids."""
    b = grid["bounds"]
    if x < b["minX"] or y < b["minY"] or x >= b["maxX"] or y >= b["maxY"]:
        return 0.0
    col = int((x - b["minX"]) // grid["cellSize"])
    row = int((y - b["minY"]) // grid["cellSize"])
    if col < 0 or row < 0 or col >= grid["cols"] or row >= grid["rows"]:
        return 0.0
    return float(grid["voidness"][row * grid["cols"] + col])


def death_context(blob: dict, grid: dict | None) -> tuple[dict, list[dict]]:
    """Where I died: void-ness (near pillar?) + healer distance at each of MY deaths.
    Per-match features use the FIRST death; all deaths feed the corpus death atlas.
    Outcome tier - existence is conditioned on dying."""
    out: dict = {}
    atlas: list[dict] = []
    team, spec = _team_maps(blob)
    player = blob.get("playerUnitId")
    my_death_times = [ev.get("tSec", 0) for ev in blob.get("timeline", [])
                      if ev.get("kind") == "death" and ev.get("unitId") == player]
    if not my_death_times:
        return out, atlas
    tracks = {tr.get("unitId"): tr for tr in blob.get("positionTracks", [])}
    me = _track_interp(tracks.get(player, {})) if player in tracks else None
    if me is None:
        return out, atlas
    t_me, x_me, y_me = me
    healer = friendly_healer_id(team, spec, player)
    heal = _track_interp(tracks.get(healer, {})) if healer and healer in tracks else None
    for td in my_death_times:
        if not (t_me[0] <= td <= t_me[-1]):
            continue
        x = float(np.interp(td, t_me, x_me))
        y = float(np.interp(td, t_me, y_me))
        entry = {"tSec": td, "x": round(x, 1), "y": round(y, 1)}
        if grid:
            entry["voidness"] = round(voidness_at(grid, x, y), 3)
        if heal is not None and heal[0][0] <= td <= heal[0][-1]:
            hx = float(np.interp(td, heal[0], heal[1]))
            hy = float(np.interp(td, heal[0], heal[2]))
            entry["healer_dist_yd"] = round(float(np.hypot(x - hx, y - hy)), 1)
        if not atlas:  # per-match features come from the first RESOLVABLE death
            if "voidness" in entry:
                out[_t("outcome", "my_death_voidness")] = entry["voidness"]
            if "healer_dist_yd" in entry:
                out[_t("outcome", "my_death_dist_to_healer_yd")] = entry["healer_dist_yd"]
        atlas.append(entry)
    return out, atlas
