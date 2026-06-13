"""Arena map kit: per-arena SVGs at true yard scale (1 svg unit = 1 yard) for tracing
exact boundaries in Figma.

Layers (Figma sees each <g> as a frame layer):
  occupancy-voids   - the raster void cells (the rough mask being replaced), gray
  fitted-occluders  - current vectorized walls/pillars from src/metadata/occluders
  movement          - all units' paths from the last N matches (friendly green, enemy
                      red, recorder blue) - where people do and don't actually move
  wmo-slice-<h>     - optional: horizontal cross-section of a wow.export WMO OBJ at
                      height h, transformed into world coords (exact geometry)
  scale             - 10-yd scale bar; the file IS to scale, the bar is a sanity check

Coordinate contract (also embedded in each file's <desc> and data- attributes):
  worldX = minX + (svgX - pad);  worldY = maxY - (svgY - pad)
Draw in Figma over these layers, export SVG, and the same contract maps the drawing
back to world yards.

Run: .venv\\Scripts\\python -m wae.mapkit [--zone all|1505] [--matches 3]
     [--wmo-dir <wow.export dir of .obj groups> --wmo-zone 1505]
Emits: output/mapkit/<zone>-<arena>.svg

The WMO transform comes from the committed per-zone registration fit
(src/metadata/wmo-registration/<zone>.json) - nudge tx/ty there if the overlay
sits a yard or two off in Figma.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

from .features import _team_maps
from .features2 import PLAYABLE_VOIDNESS_MAX

SVG_NS = "http://www.w3.org/2000/svg"
PAD_YD = 8.0
TEAM_COLORS = {"friendly": "#2a9d4e", "enemy": "#d23f3f"}
RECORDER_COLOR = "#1d6fdc"


def world_to_svg(x, y, bounds: dict, pad: float = 0.0):
    """World yards -> svg units (maxY maps to the top of the document). Works
    elementwise on numpy arrays too. Layers emit in pad-free content space; the
    document pad is applied ONCE by svg_document's translate group."""
    return (x - bounds["minX"] + pad, bounds["maxY"] - y + pad)


def load_obj(path) -> tuple[np.ndarray, np.ndarray]:
    """wow.export OBJ -> (verts Nx3 Y-up, triangle faces Mx3). Polygons fan-triangulated.
    The faces reshape keeps face-less OBJs (collision-only exports) a valid empty Mx3."""
    vs, fs = [], []
    with open(path, encoding="utf8", errors="ignore") as f:
        for line in f:
            if line.startswith("v "):
                p = line.split()
                vs.append((float(p[1]), float(p[2]), float(p[3])))
            elif line.startswith("f "):
                idx = [int(tok.split("/")[0]) - 1 for tok in line.split()[1:]]
                for i in range(1, len(idx) - 1):
                    fs.append((idx[0], idx[i], idx[i + 1]))
    return np.array(vs, dtype=float), np.array(fs, dtype=int).reshape(-1, 3)


def plane_slice(verts: np.ndarray, faces: np.ndarray, height: float) -> np.ndarray:
    """Cross-section: (n, 2, 2) segments in the (x, z) plane where triangles cross the
    horizontal plane y=height - a floor-plan cut through walls/pillars at fight height."""
    return _slice_tri(verts[faces], height)


def _slice_tri(tri: np.ndarray, height: float) -> np.ndarray:
    """Slice pre-gathered (n, 3, 3) triangles - callers slicing several heights gather
    the (multi-MB) triangle array once."""
    d = tri[:, :, 1] - height                # signed distance per corner
    crossing = (d > 0).any(1) & (d < 0).any(1)
    segs = []
    for t, dd in zip(tri[crossing], d[crossing]):
        pts = []
        for a, b in ((0, 1), (1, 2), (2, 0)):
            da, db = dd[a], dd[b]
            if (da > 0) == (db > 0) or da == db:
                continue
            w = da / (da - db)
            p = t[a] + w * (t[b] - t[a])
            pts.append((p[0], p[2]))
        if len(pts) == 2:
            segs.append(pts)
    return np.array(segs, dtype=float).reshape(-1, 2, 2)


def wmo_to_world(xy: np.ndarray, mirror: int, yaw_deg: float, tx: float, ty: float) -> np.ndarray:
    """WMO local 2D (obj x, obj z) -> world (x, y): mirror the local y, rotate by yaw,
    translate. Scale is 1:1 (both are yards)."""
    p = np.column_stack([xy[:, 0], mirror * xy[:, 1]])
    th = np.radians(yaw_deg)
    rot = np.array([[np.cos(th), -np.sin(th)], [np.sin(th), np.cos(th)]])
    return p @ rot.T + np.array([tx, ty])


def _poly_points(poly: list[dict], bounds: dict) -> str:
    return " ".join(f"{x:.2f},{y:.2f}" for x, y in
                    (world_to_svg(p["x"], p["y"], bounds) for p in poly))


def voids_layer(grid: dict, bounds: dict) -> str:
    """Gray cell rects where the occupancy raster says non-walkable (voidness at or
    above PLAYABLE_VOIDNESS_MAX, the shared mirror of lineOfSight.ts CLEAR_MAX)."""
    cell = grid["cellSize"]
    b = grid["bounds"]
    v = np.asarray(grid["voidness"], dtype=float).reshape(grid["rows"], grid["cols"])
    rects = []
    for r, c in zip(*np.nonzero(v >= PLAYABLE_VOIDNESS_MAX)):
        x, y = world_to_svg(b["minX"] + c * cell, b["minY"] + (r + 1) * cell, bounds)
        rects.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{cell}" height="{cell}"/>')
    return (f'<g id="occupancy-voids" fill="#999" fill-opacity="0.35" stroke="none">'
            + "".join(rects) + "</g>")


def occluders_layer(occ: dict, bounds: dict) -> str:
    """The current fitted vector occluders (walls + pillars + manual), for comparison.
    Slopes (LoS height ramps) are deliberately not drawn - they aren't boundaries."""
    polys = []
    for kind in ("walls", "pillars", "manual"):
        for poly in occ.get(kind) or []:
            # walls/pillars are bare point arrays; manual entries are ManualOccluder
            # dicts ({heightYd, points, label}) per src/metrics/occluderOverrides.ts
            pts = poly["points"] if isinstance(poly, dict) else poly
            polys.append(f'<polygon class="{kind}" points="{_poly_points(pts, bounds)}"/>')
    return (f'<g id="fitted-occluders" fill="none" stroke="#7a3fd2" stroke-width="0.4">'
            + "".join(polys) + "</g>")


def movement_layer(match_blobs: list[tuple[str, dict]], bounds: dict) -> str:
    """One polyline per unit per match: friendly green, enemy red, recorder blue."""
    groups = []
    for match_id, blob in match_blobs:
        team, _spec = _team_maps(blob)
        recorder = blob.get("playerUnitId")
        lines = []
        for tr in blob.get("positionTracks", []):
            uid = tr.get("unitId")
            if uid not in team:
                continue   # pets stay out - unit paths only
            pts = _poly_points(tr.get("samples", []), bounds)
            if not pts:
                continue
            color = RECORDER_COLOR if uid == recorder else TEAM_COLORS.get(team[uid], "#666")
            width = 0.5 if uid == recorder else 0.3
            lines.append(f'<polyline points="{pts}" stroke="{color}" '
                         f'stroke-width="{width}" fill="none" stroke-opacity="0.55"/>')
        groups.append(f'<g id="match-{match_id[:8]}">' + "".join(lines) + "</g>")
    return '<g id="movement">' + "".join(groups) + "</g>"


def wmo_layer(obj_dir, transform: dict, bounds: dict, heights: list[float]) -> str:
    """Cross-sections of every OBJ in the dir at each height (OBJ-local Y-up yards,
    pre-transform - the registration is 2D, it never moves the vertical axis),
    transformed into world coords."""
    groups = []
    tris = []
    for p in sorted(Path(obj_dir).glob("*.obj")):
        verts, faces = load_obj(p)
        tris.append((p.stem, verts[faces]))
    for h in heights:
        paths = []
        for stem, tri in tris:
            segs = _slice_tri(tri, h)
            if not len(segs):
                continue
            # transform + svg-map all endpoints in two vector ops, then format
            w = wmo_to_world(segs.reshape(-1, 2), **transform)
            sx, sy = world_to_svg(w[:, 0], w[:, 1], bounds)
            sp = np.column_stack([sx, sy]).reshape(-1, 2, 2)
            d = "".join(f"M{a[0]:.2f},{a[1]:.2f} L{b[0]:.2f},{b[1]:.2f}" for a, b in sp)
            paths.append(f'<path data-obj="{stem}" d="{d}"/>')
        groups.append(f'<g id="wmo-slice-{h:g}" fill="none" stroke="#111" '
                      f'stroke-width="0.15">' + "".join(paths) + "</g>")
    return "".join(groups)


def scale_layer(bounds: dict) -> str:
    """10-yd bar just below the content box (in the document's pad band). The document
    is already 1 unit = 1 yd; this is the sanity check."""
    y = bounds["maxY"] - bounds["minY"] + 4
    return (f'<g id="scale">'
            f'<line id="scale-bar" x1="0" y1="{y}" x2="10" y2="{y}" '
            f'stroke="#000" stroke-width="0.6"/>'
            f'<text x="0" y="{y - 1.2}" font-size="2.5" font-family="sans-serif">'
            f'10 yd</text></g>')


def svg_document(arena: str, zone: str, bounds: dict, layers: list[str],
                 pad: float = PAD_YD) -> str:
    """Layers come in pad-free content space; the pad is applied exactly once here,
    by the translate group - so the embedded contract can never disagree with the
    painted geometry."""
    from xml.sax.saxutils import escape

    w = bounds["maxX"] - bounds["minX"] + 2 * pad
    h = bounds["maxY"] - bounds["minY"] + 2 * pad
    desc = (f"{escape(arena)} (zone {zone}) at 1 svg unit = 1 yard. "
            f"worldX = minX + (svgX - pad); worldY = maxY - (svgY - pad); "
            f"minX={bounds['minX']} minY={bounds['minY']} "
            f"maxX={bounds['maxX']} maxY={bounds['maxY']} pad={pad}")
    return (f'<svg xmlns="{SVG_NS}" viewBox="0 0 {w} {h}" '
            f'width="{w * 8}" height="{h * 8}" '
            f'data-zone="{zone}" data-min-x="{bounds["minX"]}" data-min-y="{bounds["minY"]}" '
            f'data-max-x="{bounds["maxX"]}" data-max-y="{bounds["maxY"]}" data-pad="{pad}">'
            f"<desc>{desc}</desc>"
            f'<g transform="translate({pad} {pad})">' + "".join(layers) + "</g></svg>")


def main() -> None:
    import argparse

    from . import db

    ap = argparse.ArgumentParser(prog="wae.mapkit")
    ap.add_argument("--db", default=str(db.REPO_ROOT / "wow-arena-eye.local.db"))
    ap.add_argument("--zone", default="all", help="'all' or one zoneId")
    ap.add_argument("--matches", type=int, default=3, help="recent matches to paint")
    ap.add_argument("--out", default=str(db.REPO_ROOT / "output" / "mapkit"))
    ap.add_argument("--wmo-dir", default=None, help="wow.export dir of .obj groups")
    ap.add_argument("--wmo-zone", default=None,
                    help="zone the WMO belongs to (transform read from "
                         "src/metadata/wmo-registration/<zone>.json)")
    args = ap.parse_args()
    if bool(args.wmo_dir) != bool(args.wmo_zone):
        ap.error("--wmo-dir and --wmo-zone must be given together")
    registration = db.load_wmo_registration(args.wmo_zone) if args.wmo_zone else None
    if args.wmo_zone and registration is None:
        ap.error(f"no registration fit committed for zone {args.wmo_zone} "
                 f"(src/metadata/wmo-registration/{args.wmo_zone}.json)")

    arenas = db.arenas_table()
    rows = db.load_matches(args.db)
    by_zone: dict[str, list] = {}
    for r in rows:
        by_zone.setdefault(str(r["zone_id"]), []).append(r)
    zones = sorted(by_zone) if args.zone == "all" else [args.zone]

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    for zone in zones:
        zrows = by_zone.get(zone, [])
        if not zrows:
            print(f"[mapkit] {zone}: no matches in store, skipped")
            continue
        recent = zrows[-args.matches:] if args.matches > 0 else []   # -0 slices to ALL
        blobs = list(db.iter_blobs(args.db, [r["match_id"] for r in recent]))
        grid = db.load_occupancy(zone)
        if grid:
            bounds = grid["bounds"]
        else:
            samples = [s for _m, b in blobs for tr in b.get("positionTracks", [])
                       for s in tr.get("samples", [])]
            if not samples:
                print(f"[mapkit] {zone}: no positions, skipped")
                continue
            bounds = {"minX": min(s["x"] for s in samples), "minY": min(s["y"] for s in samples),
                      "maxX": max(s["x"] for s in samples), "maxY": max(s["y"] for s in samples)}

        layers = []
        if grid:
            layers.append(voids_layer(grid, bounds))
        occ = db.load_occluders(zone)
        if occ:
            layers.append(occluders_layer(occ, bounds))
        layers.append(movement_layer(blobs, bounds))
        if registration and zone == args.wmo_zone:
            transform = {"mirror": registration["mirror"], "yaw_deg": registration["yawDeg"],
                         "tx": registration["tx"], "ty": registration["ty"]}
            layers.append(wmo_layer(args.wmo_dir, transform, bounds, registration["heights"]))
        layers.append(scale_layer(bounds))

        arena = arenas.get(zone, zone)
        slug = arena.replace(" ", "-").replace("'", "")
        path = out_dir / f"{zone}-{slug}.svg"
        path.write_text(svg_document(arena, zone, bounds, layers), encoding="utf8")
        print(f"[mapkit] wrote {path.name} ({len(recent)} matches painted)")


if __name__ == "__main__":
    main()
