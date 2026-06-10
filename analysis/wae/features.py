"""The feature foundry: one match (store row + scalar metrics + detail blob) -> feature dict.

Every feature carries a TIER so the report can separate coachable findings from
restatements of the result:
  process  - things the player controls during play (the coachable tier)
  context  - fixed at queue time (map/comp/MMR/character/session position) + duration
  outcome  - near-restatements of the result (deaths, lethal GOs); model ceiling only
"""
from __future__ import annotations

import math
from collections import Counter

import numpy as np

from .db import HEALER_SPEC_IDS

MELEE_YD = 8.0
HEAL_RANGE_YD = 40.0
EARLY_CC_SEC = 20.0
EARLY_CC_SEC_WIDE = 30.0

# metric-table scalars worth keeping, with whether they accumulate (-> per-minute rate).
SCALAR_METRICS: dict[str, bool] = {
    "damageDone": True,
    "healingDone": True,
    "absorbDone": True,
    "casts": True,
    "interruptsLanded": True,
    "interruptsSuffered": True,
    "purges": True,
    "dispels": True,
    "deaths": False,
    "deathsWhileCcd": False,
    "precognitionUptimeSec": True,
    "enemyPrecognitionUptimeSec": True,
    "avgHealerDistanceYd": False,
    "ccDone.hardCcSec": True,
    "ccDone.castDenialSec": True,
    "ccDone.timeSec": True,
    "ccReceived.hardCcSec": True,
    "ccReceived.castDenialSec": True,
    "ccReceived.timeSec": True,
    "spellsteals": True,
    "healerPressureDamage": True,
    "immuneDone.ccImmuned": True,
    "spacing.isolatedSec": True,
    "spacing.meleeRangeSec": True,
    "distanceMoved": True,
    "timeStationarySec": True,
    "defensivesUsed": True,
    "defensivesIntoBurst": False,
    "ccDone.count": True,
    "ccReceived.count": True,
}

TIERS: dict[str, str] = {}


def _t(tier: str, name: str) -> str:
    TIERS[name] = tier
    return name


def _team_maps(blob: dict) -> tuple[dict[str, str], dict[str, str]]:
    """unitId -> team and unitId -> spec (always str) for PLAYERS, from the blob's team groups."""
    team, spec = {}, {}
    for tg in blob.get("teams", []):
        for pg in tg.get("players", []):
            p = pg.get("player", {})
            team[p.get("unitId")] = p.get("team")
            spec[p.get("unitId")] = str(p.get("spec"))
    return team, spec


def friendly_healer_id(team: dict[str, str], spec: dict[str, str], player: str | None) -> str | None:
    """The (first) friendly healer-spec player that isn't the recorder."""
    return next((u for u, tm in team.items()
                 if tm == "friendly" and spec.get(u) in HEALER_SPEC_IDS and u != player), None)


def scalar_features(metrics: dict[str, float], minutes: float) -> dict[str, float]:
    out: dict[str, float] = {}
    for mid, is_rate in SCALAR_METRICS.items():
        v = metrics.get(mid)
        if v is None:
            continue
        key = mid.replace(".", "_")
        if is_rate and minutes > 0:
            out[_t("process", f"{key}_per_min")] = v / minutes
        else:
            tier = "outcome" if mid in ("deaths", "deathsWhileCcd") else "process"
            out[_t(tier, key)] = v
    return out


def comp_features(blob: dict, spec_table: dict[str, dict[str, str]]) -> dict:
    """Queue-time comp context: healer classes + enemy class presence flags."""
    out: dict = {}
    for tg in blob.get("teams", []):
        side = tg.get("team")
        prefix = "ally" if side == "friendly" else "enemy"
        classes = []
        healer_cls = None
        for pg in tg.get("players", []):
            p = pg.get("player", {})
            spec = str(p.get("spec"))
            cls = spec_table.get(spec, {}).get("className", "Unknown")
            classes.append(cls)
            if spec in HEALER_SPEC_IDS:
                healer_cls = cls
        out[_t("context", f"{prefix}_healer_class")] = healer_cls or "none"
        if prefix == "enemy":
            for cls in set(classes):
                out[_t("context", f"enemy_has_{cls.replace(' ', '')}")] = 1.0
    return out


def timeline_features(blob: dict, minutes: float) -> tuple[dict, Counter]:
    """Early CC, kick timing, first death, plus the player's per-spell cast counter."""
    team, _ = _team_maps(blob)
    player = blob.get("playerUnitId")
    out: dict = {}
    cc_early = cc_early_wide = 0
    first_kick_by_us = first_kick_on_us = None
    first_death_sec = None
    first_death_side = None
    casts_by_spell: Counter = Counter()
    for ev in blob.get("timeline", []):
        kind, t = ev.get("kind"), ev.get("tSec", 0)
        if kind == "cc" and team.get(ev.get("unitId")) == "friendly" and team.get(ev.get("targetId")) == "enemy":
            if t <= EARLY_CC_SEC:
                cc_early += 1
            if t <= EARLY_CC_SEC_WIDE:
                cc_early_wide += 1
        elif kind == "interrupt":
            if team.get(ev.get("unitId")) == "friendly" and first_kick_by_us is None:
                first_kick_by_us = t
            if team.get(ev.get("targetId")) == "friendly" and first_kick_on_us is None:
                first_kick_on_us = t
        elif kind == "death" and first_death_sec is None and team.get(ev.get("unitId")) is not None:
            first_death_sec = t
            first_death_side = team.get(ev.get("unitId"))
        elif kind == "cast" and ev.get("unitId") == player and ev.get("spell"):
            # the player's OWN GCD mix by design - pet casts (Spell Lock etc.) are captured by
            # the rolled-up scalar metrics (interruptsLanded, casts), not the spell-mix columns
            casts_by_spell[ev["spell"]] += 1
    out[_t("process", "our_cc_on_enemy_first20s")] = float(cc_early)
    out[_t("process", "our_cc_on_enemy_first30s")] = float(cc_early_wide)
    if first_kick_by_us is not None:
        out[_t("process", "first_kick_by_us_sec")] = first_kick_by_us
    if first_kick_on_us is not None:
        out[_t("process", "first_kick_on_us_sec")] = first_kick_on_us
    if first_death_sec is not None:
        out[_t("outcome", "first_death_sec")] = first_death_sec
        out[_t("outcome", "first_death_ours")] = 1.0 if first_death_side == "friendly" else 0.0
    return out, casts_by_spell


def go_window_features(blob: dict, minutes: float) -> dict:
    """GO-band shape: pressure cadence, favor inputs, and (outcome tier) lethality."""
    out: dict = {}
    team, _ = _team_maps(blob)
    wins_enemy = [w for w in blob.get("offensiveWindows", []) if w.get("attackingTeam") == "enemy"]
    wins_ours = [w for w in blob.get("offensiveWindows", []) if w.get("attackingTeam") == "friendly"]
    deaths_friendly = [
        ev.get("tSec", 0) for ev in blob.get("timeline", [])
        if ev.get("kind") == "death" and team.get(ev.get("unitId")) == "friendly"
    ]
    if minutes > 0:
        out[_t("process", "enemy_go_per_min")] = len(wins_enemy) / minutes
        out[_t("process", "our_go_per_min")] = len(wins_ours) / minutes
        dmg = sum(w.get("teamDamageTaken", 0) for w in wins_enemy)
        out[_t("process", "enemy_go_dmg_per_min")] = dmg / minutes
    if wins_enemy:
        out[_t("process", "first_enemy_go_sec")] = min(w.get("startSec", 0) for w in wins_enemy)
        def_up = [len((w.get("mitigation") or {}).get("available", [])) for w in wins_enemy]
        out[_t("process", "mean_defensives_up_at_enemy_go")] = float(np.mean(def_up))
        atk = [w.get("attackerOffenseAvailableCount") for w in wins_enemy if w.get("attackerOffenseAvailableCount") is not None]
        if atk:
            out[_t("process", "mean_enemy_offense_ready_at_go")] = float(np.mean(atk))
        lethal = sum(1 for w in wins_enemy if any(w.get("startSec", 0) <= d <= w.get("endSec", 0) for d in deaths_friendly))
        out[_t("outcome", "lethal_enemy_go_frac")] = lethal / len(wins_enemy)
    if wins_ours:
        atk = [w.get("attackerOffenseAvailableCount") for w in wins_ours if w.get("attackerOffenseAvailableCount") is not None]
        if atk:
            out[_t("process", "mean_our_offense_ready_at_go")] = float(np.mean(atk))
    return out


def _track_interp(track: dict) -> tuple[np.ndarray, np.ndarray, np.ndarray] | None:
    samples = track.get("samples", [])
    if len(samples) < 2:
        return None
    t = np.array([s["tSec"] for s in samples], dtype=float)
    x = np.array([s["x"] for s in samples], dtype=float)
    y = np.array([s["y"] for s in samples], dtype=float)
    return t, x, y


def position_features(blob: dict) -> dict:
    """Range discipline: distance kept to own healer and to enemies, sampled on the
    player's own track timeline (linear interp between samples - ~2s cadence)."""
    out: dict = {}
    team, spec = _team_maps(blob)
    player = blob.get("playerUnitId")
    tracks = {tr.get("unitId"): tr for tr in blob.get("positionTracks", [])}
    me = _track_interp(tracks.get(player, {})) if player in tracks else None
    if me is None:
        return out
    t_me, x_me, y_me = me

    def dist_series(unit_id: str) -> np.ndarray | None:
        """Distance per player-sample, NaN-padded outside the other unit's observed span (so
        partial tracks still contribute their overlap instead of being dropped wholesale)."""
        other = _track_interp(tracks.get(unit_id, {})) if unit_id in tracks else None
        if other is None:
            return None
        t_o, x_o, y_o = other
        mask = (t_me >= t_o[0]) & (t_me <= t_o[-1])
        if mask.sum() < 2:
            return None
        d = np.full(len(t_me), np.nan)
        xo = np.interp(t_me[mask], t_o, x_o)
        yo = np.interp(t_me[mask], t_o, y_o)
        d[mask] = np.hypot(x_me[mask] - xo, y_me[mask] - yo)
        return d

    healer_id = friendly_healer_id(team, spec, player)
    if healer_id:
        d = dist_series(healer_id)
        if d is not None and np.isfinite(d).sum():
            out[_t("process", "pct_time_beyond_heal_range")] = float(np.nanmean(d > HEAL_RANGE_YD))
            out[_t("process", "median_dist_to_healer_yd")] = float(np.nanmedian(d))

    enemy_ids = [u for u, tm in team.items() if tm == "enemy"]
    enemy_series = [d for d in (dist_series(u) for u in enemy_ids) if d is not None]
    if enemy_series:
        with np.errstate(all="ignore"):
            nearest = np.nanmin(np.vstack(enemy_series), axis=0)  # all-NaN columns stay NaN
        if np.isfinite(nearest).sum():
            out[_t("process", "median_dist_nearest_enemy_yd")] = float(np.nanmedian(nearest))
            out[_t("process", "pct_time_in_enemy_melee")] = float(np.nanmean(nearest <= MELEE_YD))
    return out


def coordination_features(blob: dict, minutes: float) -> dict:
    out: dict = {}
    for cg in blob.get("coordination", []):
        side = "our" if cg.get("team") == "friendly" else "their"
        s = cg.get("summary", {})
        if s.get("alignmentFraction") is not None:
            out[_t("process", f"{side}_focus_alignment")] = s["alignmentFraction"]
        if s.get("swaps") is not None and minutes > 0:
            out[_t("process", f"{side}_swaps_per_min")] = s["swaps"] / minutes
    return out


def context_features(row: dict) -> dict:
    out: dict = {
        _t("context", "duration_sec"): row.get("duration_sec"),
        _t("context", "mmr"): row.get("player_rating"),
        _t("context", "cr"): row.get("player_cr"),
        _t("context", "game_in_session"): row.get("game_in_session"),
        _t("context", "map_id"): str(row.get("zone_id")),
        _t("context", "character"): (row.get("player_name") or "?").split("-")[0],
    }
    if row.get("start_ms"):
        # local hour (matches were played on this machine) - UTC hour would phase-shift the
        # time-of-day signal by the timezone offset
        from datetime import datetime
        out[_t("context", "hour_of_day")] = float(datetime.fromtimestamp(row["start_ms"] / 1000).hour)
    return out


def derive(row: dict, metrics: dict[str, float], blob: dict, spec_table: dict,
           grid: dict | None = None) -> tuple[dict, Counter, list[dict]]:
    """All features for one match + the per-spell cast counter (assembled corpus-wide later)
    + this match's death-atlas entries (my deaths with position/voidness/healer-dist)."""
    from . import features2  # late import: features2 imports helpers from this module
    minutes = (row.get("duration_sec") or 0) / 60.0
    feats: dict = {"match_id": row["match_id"], "win": 1.0 if row["result"] == "win" else 0.0,
                   "session_id": row["session_id"]}
    feats.update(context_features(row))
    feats.update(scalar_features(metrics, minutes))
    feats.update(comp_features(blob, spec_table))
    tl, casts_by_spell = timeline_features(blob, minutes)
    feats.update(tl)
    feats.update(go_window_features(blob, minutes))
    feats.update(position_features(blob))
    feats.update(coordination_features(blob, minutes))
    feats.update(features2.targeting_features(blob, spec_table))
    feats.update(features2.enemy_pressure_features(blob))
    feats.update(features2.opener_features(blob))
    feats.update(features2.dr_cc_features(blob, minutes))
    death_feats, atlas = features2.death_context(blob, grid)
    feats.update(death_feats)
    return feats, casts_by_spell, atlas


def add_spell_rate_columns(rows: list[dict], casts: list[Counter], durations: list[float],
                           min_presence: float = 0.2, top_k: int = 25) -> list[str]:
    """Per-spell casts/min columns for spells the player used in >= min_presence of matches
    (the user's 'cast this spell more / less' hypothesis), capped at top_k by presence."""
    n = len(rows)
    presence = Counter()
    for c in casts:
        for spell in c:
            presence[spell] += 1
    keep = [s for s, k in presence.most_common() if k / max(n, 1) >= min_presence][:top_k]
    for row, counter, dur in zip(rows, casts, durations):
        minutes = (dur or 0) / 60.0
        for spell in keep:
            col = _t("process", f"casts_per_min__{spell.replace(' ', '_')}")
            row[col] = (counter.get(spell, 0) / minutes) if minutes > 0 else math.nan
    return keep
