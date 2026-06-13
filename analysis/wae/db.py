"""Store access. SQLite is the TS<->Python contract: this module only reads the tables the
viewer writes (match / metric / match_detail) plus the repo's metadata JSONs - no TS imports."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Iterator

SESSION_GAP_MS = 30 * 60_000  # mirrors config.sessionGapMinutes default / sessionize semantics

REPO_ROOT = Path(__file__).resolve().parents[2]


def spec_table() -> dict[str, dict[str, str]]:
    """specId -> {className, specName} from the repo's authoritative metadata JSON."""
    return json.loads((REPO_ROOT / "src/metadata/specs.json").read_text(encoding="utf8"))


HEALER_SPEC_IDS = {"65", "105", "256", "257", "264", "270", "1468"}  # mirrors src/metrics/registry.ts

_GRID_CACHE: dict[str, dict | None] = {}


def arenas_table() -> dict[str, str]:
    """zoneId -> arena display name."""
    return json.loads((REPO_ROOT / "src/metadata/arenas.json").read_text(encoding="utf8"))


def load_occupancy(zone_id: str) -> dict | None:
    """The committed occupancy void-ness grid for a zone, or None. Cached."""
    if zone_id not in _GRID_CACHE:
        path = REPO_ROOT / "src/metadata/occupancy" / f"{zone_id}.json"
        _GRID_CACHE[zone_id] = json.loads(path.read_text(encoding="utf8")) if path.exists() else None
    return _GRID_CACHE[zone_id]


def load_occluders(zone_id: str) -> dict | None:
    """The committed fitted occluder vectors (walls/pillars/manual) for a zone, or None."""
    path = REPO_ROOT / "src/metadata/occluders" / f"{zone_id}.json"
    return json.loads(path.read_text(encoding="utf8")) if path.exists() else None


def load_wmo_registration(zone_id: str) -> dict | None:
    """The committed WMO->world registration fit for a zone, or None. Validated on load:
    these files are hand-nudged (the note in each invites it), so a typo'd key or a
    copy-pasted wrong-zone file must fail HERE, not as a KeyError mid-render. Heights
    are OBJ-local Y-up yards (pre-transform - the registration is 2D-only)."""
    path = REPO_ROOT / "src/metadata/wmo-registration" / f"{zone_id}.json"
    if not path.exists():
        return None
    reg = json.loads(path.read_text(encoding="utf8"))
    missing = [k for k in ("mirror", "yawDeg", "tx", "ty", "heights") if k not in reg]
    if missing:
        raise ValueError(f"{path.name}: missing keys {missing}")
    if str(reg.get("zoneId")) != str(zone_id):
        raise ValueError(f"{path.name}: zoneId {reg.get('zoneId')!r} != filename zone {zone_id!r}")
    return reg


def load_matches(db_path: str | Path, bracket: str = "3v3", character: str | None = None) -> list[dict]:
    """Ranked-match rows (newest season only is assumed ingested), oldest first."""
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    sql = (
        "SELECT match_id, start_ms, duration_sec, bracket, zone_id, result, player_name, "
        "       player_unit_id, player_spec, player_rating, player_cr, build_version "
        "FROM match WHERE bracket = ? AND result IN ('win','loss') AND duration_sec > 0 "
        "AND player_unit_id IS NOT NULL"  # without it, scalar metrics can't be attributed
    )
    args: list = [bracket]
    if character:
        sql += " AND player_name LIKE ?"
        args.append(f"{character}%")
    sql += " ORDER BY start_ms"
    rows = [dict(r) for r in con.execute(sql, args)]
    con.close()
    return rows


def metric_pivot(db_path: str | Path, match_ids: list[str]) -> dict[str, dict[str, float]]:
    """match_id -> {metric_id: value} for the recording player's scope."""
    con = sqlite3.connect(db_path)
    out: dict[str, dict[str, float]] = {}
    rows = con.execute(
        "SELECT x.match_id, x.metric_id, x.value FROM metric x "
        "JOIN match m ON m.match_id = x.match_id AND m.player_unit_id = x.scope"
    )
    wanted = set(match_ids)
    for match_id, metric_id, value in rows:
        if match_id in wanted:
            out.setdefault(match_id, {})[metric_id] = value
    con.close()
    return out


def iter_blobs(db_path: str | Path, match_ids: list[str]) -> Iterator[tuple[str, dict]]:
    """Stream (match_id, parsed metrics blob) - blobs are large, never hold them all."""
    con = sqlite3.connect(db_path)
    for match_id in match_ids:
        row = con.execute("SELECT metrics_json FROM match_detail WHERE match_id = ?", (match_id,)).fetchone()
        if row:
            yield match_id, json.loads(row[0])
    con.close()


def assign_sessions(rows: list[dict]) -> None:
    """Tag each row (sorted oldest-first) with session_id + game_in_session, replicating
    sessionize: per character, a new session when the gap from the previous match END
    (start+duration) to this start exceeds SESSION_GAP_MS."""
    last_end: dict[str, int] = {}
    session_of: dict[str, str] = {}
    counter: dict[str, int] = {}
    for r in rows:
        ch = r["player_name"]
        start = r["start_ms"] or 0
        if ch not in session_of or start - last_end.get(ch, 0) > SESSION_GAP_MS:
            session_of[ch] = f"{ch}:{start}"
            counter[session_of[ch]] = 0
        counter[session_of[ch]] += 1
        r["session_id"] = session_of[ch]
        r["game_in_session"] = counter[session_of[ch]]
        last_end[ch] = start + int((r["duration_sec"] or 0) * 1000)
