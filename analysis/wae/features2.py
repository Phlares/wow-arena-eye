"""V2 foundry: targeting choice, enemy pressure distribution, opener shape, CC sent into
DR, death context (user-directed second pass, 2026-06-09), and transseasonal map-position
features (A.2, 2026-06-10)."""
from __future__ import annotations

import numpy as np
from scipy.ndimage import distance_transform_edt
from scipy.spatial import ConvexHull, QhullError

from .db import HEALER_SPEC_IDS
from .features import _t, _team_maps, _track_interp, friendly_healer_id

DR_WINDOW_SEC = 18.0   # cast-to-cast approximation of "sent into diminishing returns"
OPENER_SPELLS = 3      # first-N player casts define the opener pattern
DOT_SPELLS = {"Agony", "Corruption", "Unstable Affliction", "Vile Taint", "Siphon Life", "Haunt"}
MIDGAME_START_SEC = 15.0  # casts after this feed the mid-game n-grams (opener ends per my_casts_first15s)

# specId -> arena archetype. Hand-maintained like HEALER_SPEC_IDS; tanks kept distinct
# (rare in arena, but folding them into melee would mislabel the comp).
ARCHETYPES: dict[str, str] = {
    # ranged casters
    "62": "ranged", "63": "ranged", "64": "ranged",          # Mage
    "102": "ranged", "258": "ranged", "262": "ranged",       # Balance, Shadow, Ele
    "265": "ranged", "266": "ranged", "267": "ranged",       # Warlock
    "253": "ranged", "254": "ranged",                        # BM, MM
    "1467": "ranged", "1473": "ranged",                      # Dev, Aug Evoker
    # melee
    "70": "melee", "71": "melee", "72": "melee",             # Ret, Arms, Fury
    "103": "melee", "251": "melee", "252": "melee",          # Feral, Frost/Unholy DK
    "255": "melee",                                          # Survival
    "259": "melee", "260": "melee", "261": "melee",          # Rogue
    "263": "melee", "269": "melee",                          # Enh, WW
    "577": "melee", "1480": "melee",                         # Havoc, Devourer DH
    # healers
    "65": "healer", "105": "healer", "256": "healer", "257": "healer",
    "264": "healer", "270": "healer", "1468": "healer",
    # tanks
    "66": "tank", "73": "tank", "104": "tank", "250": "tank", "268": "tank", "581": "tank",
}


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


EDGE_DIST_YD = 6.0           # "hugging" = within this of non-playable space (wall/pillar/void)
PLAYABLE_VOIDNESS_MAX = 0.5  # mirrors lineOfSight.ts CLEAR_MAX: below this a cell is open floor
HALF_SPLIT_START_SEC = 10.0  # team start centroids = mean position over the first N seconds


def _wall_geometry(grid: dict) -> tuple[np.ndarray, float]:
    """(per-cell distance in yd to the nearest non-playable cell, playable area in yd^2).
    Everything outside the grid counts as non-playable. Arena bounds are NOT rectangles -
    the voidness mask, not the bounding box, defines where the walls are.

    Memoized on the grid dict itself (one EDT per zone per process - db.load_occupancy
    hands out one dict per zone), so the cache lives and dies with the grid object. The
    memo records WHICH voidness it was computed from: a shallow-copied grid with a new
    voidness (tests do this) must not inherit the copy-source's geometry."""
    memo = grid.get("_wall_geometry")
    if memo is None or memo[0] is not grid["voidness"]:
        playable = (np.asarray(grid["voidness"], dtype=float).reshape(grid["rows"], grid["cols"])
                    < PLAYABLE_VOIDNESS_MAX)
        padded = np.zeros((grid["rows"] + 2, grid["cols"] + 2), dtype=bool)
        padded[1:-1, 1:-1] = playable
        wall_yd = distance_transform_edt(padded)[1:-1, 1:-1] * grid["cellSize"]
        memo = (grid["voidness"], wall_yd, float(playable.sum()) * grid["cellSize"] ** 2)
        grid["_wall_geometry"] = memo
    return memo[1], memo[2]


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
    - edge_proximity_frac:   fraction of time within EDGE_DIST_YD of non-playable space
                             (walls/pillars/voids via the voidness mask - not the bounding
                             box, which arena shapes rarely fill)
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
    wall, playable = _wall_geometry(grid)
    col = np.clip(((x_me - b["minX"]) // grid["cellSize"]).astype(int), 0, grid["cols"] - 1)
    row = np.clip(((y_me - b["minY"]) // grid["cellSize"]).astype(int), 0, grid["rows"] - 1)
    out[_t("process", "edge_proximity_frac")] = float(np.mean(wall[row, col] < EDGE_DIST_YD))

    if playable > 0 and len(pts) >= 3:
        try:
            out[_t("process", "map_area_coverage_frac")] = float(
                min(1.0, ConvexHull(pts).volume / playable))
        except QhullError:
            pass  # degenerate (collinear) track - no hull, no feature
    return out


_ARCHETYPE_ORDER = ("melee", "ranged", "tank", "unknown", "healer")  # damage first, healer last


def _comp_label(archetypes: list[str]) -> str:
    """'2melee+healer' style label: counted, damage-roles-first, deterministic."""
    counts = {a: archetypes.count(a) for a in _ARCHETYPE_ORDER if a in archetypes}
    return "+".join(f"{n if n > 1 else ''}{a}" for a, n in counts.items())


def comp_archetype_features(blob: dict) -> dict:
    """Queue-time comp shape by ARCHETYPE (melee/ranged/healer/tank) - coarser than class,
    so slices stay big enough to screen. Ally label excludes the recorder."""
    out: dict = {}
    player = blob.get("playerUnitId")
    sides: dict[str, list[str]] = {"friendly": [], "enemy": []}
    for tg in blob.get("teams", []):
        for pg in tg.get("players", []):
            p = pg.get("player", {})
            if p.get("unitId") == player:
                continue
            sides.setdefault(tg.get("team"), []).append(
                ARCHETYPES.get(str(p.get("spec")), "unknown"))
    if sides["friendly"]:
        out[_t("context", "ally_comp_archetype")] = _comp_label(sides["friendly"])
    if sides["enemy"]:
        out[_t("context", "enemy_comp_archetype")] = _comp_label(sides["enemy"])
        out[_t("context", "enemy_melee_count")] = float(sides["enemy"].count("melee"))
    return out


def midgame_bigrams(blob: dict, start_sec: float = MIDGAME_START_SEC):
    """Counter of consecutive-cast bigrams (A, B) for the recording player's casts after
    the opener window - the SEQUENCE shape beyond openers (seasonal by nature)."""
    from collections import Counter

    player = blob.get("playerUnitId")
    casts = sorted((ev.get("tSec", 0), ev.get("spell")) for ev in blob.get("timeline", [])
                   if ev.get("kind") == "cast" and ev.get("unitId") == player and ev.get("spell"))
    mid = [(t, s) for t, s in casts if t > start_sec]
    # dedup same-second double-emits like opener_features does
    mid = [c for i, c in enumerate(mid) if i == 0 or c != mid[i - 1]]
    return Counter((a[1], b[1]) for a, b in zip(mid, mid[1:]))


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
