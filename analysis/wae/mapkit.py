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
     [--wmo-dir <dir> --wmo-zone 1505 --wmo-mirror -1 --wmo-yaw 0
      --wmo-tx -2055.3 --wmo-ty 6651.5 --wmo-heights 1.5,15,26]
Emits: output/mapkit/<zone>-<arena>.svg

The Nagrand 1505 transform above is the registration fit from 2026-06-12 (pillar
geometry vs occupancy voids); nudge visually in Figma if it's a yard or two off.
"""
from __future__ import annotations

import numpy as np

SVG_NS = "http://www.w3.org/2000/svg"
PAD_YD = 8.0
TEAM_COLORS = {"friendly": "#2a9d4e", "enemy": "#d23f3f"}
RECORDER_COLOR = "#1d6fdc"


def world_to_svg(x: float, y: float, bounds: dict, pad: float = 0.0) -> tuple[float, float]:
    """World yards -> svg units. North (maxY) maps to the top of the document."""
    return (x - bounds["minX"] + pad, bounds["maxY"] - y + pad)


def load_obj(path) -> tuple[np.ndarray, np.ndarray]:
    """wow.export OBJ -> (verts Nx3 Y-up, triangle faces Mx3). Polygons fan-triangulated."""
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
    return np.array(vs, dtype=float), np.array(fs, dtype=int)


def plane_slice(verts: np.ndarray, faces: np.ndarray, height: float) -> list:
    """Cross-section: segments ((x1,z1),(x2,z2)) where triangles cross the horizontal
    plane y=height - a floor-plan cut through walls/pillars at fight height."""
    segs = []
    tri = verts[faces]                       # (n, 3, 3)
    d = tri[:, :, 1] - height                # signed distance per corner
    crossing = ~((d > 0).all(1) | (d < 0).all(1) | (d == 0).all(1))
    for t, dd in zip(tri[crossing], d[crossing]):
        pts = []
        for a, b in ((0, 1), (1, 2), (2, 0)):
            da, db = dd[a], dd[b]
            if (da > 0) == (db > 0) or da == db:
                continue
            w = da / (da - db)
            p = t[a] + w * (t[b] - t[a])
            pts.append((float(p[0]), float(p[2])))
        if len(pts) == 2:
            segs.append((pts[0], pts[1]))
    return segs


def wmo_to_world(xy: np.ndarray, mirror: int, yaw_deg: float, tx: float, ty: float) -> np.ndarray:
    """WMO local 2D (obj x, obj z) -> world (x, y): mirror the local y, rotate by yaw,
    translate. Scale is 1:1 (both are yards)."""
    p = np.column_stack([xy[:, 0], mirror * xy[:, 1]])
    th = np.radians(yaw_deg)
    rot = np.array([[np.cos(th), -np.sin(th)], [np.sin(th), np.cos(th)]])
    return p @ rot.T + np.array([tx, ty])


def _poly_points(poly: list[dict], bounds: dict, pad: float) -> str:
    return " ".join(f"{x:.2f},{y:.2f}" for x, y in
                    (world_to_svg(p["x"], p["y"], bounds, pad) for p in poly))


def voids_layer(grid: dict, bounds: dict, pad: float = PAD_YD) -> str:
    """Gray cell rects where the occupancy raster says non-walkable (voidness >= 0.5)."""
    cell = grid["cellSize"]
    b = grid["bounds"]
    v = np.asarray(grid["voidness"], dtype=float).reshape(grid["rows"], grid["cols"])
    rects = []
    for r, c in zip(*np.nonzero(v >= 0.5)):
        x, y = world_to_svg(b["minX"] + c * cell, b["minY"] + (r + 1) * cell, bounds, pad)
        rects.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{cell}" height="{cell}"/>')
    return (f'<g id="occupancy-voids" fill="#999" fill-opacity="0.35" stroke="none">'
            + "".join(rects) + "</g>")


def occluders_layer(occ: dict, bounds: dict, pad: float = PAD_YD) -> str:
    """The current fitted vector occluders (walls + pillars + manual), for comparison."""
    polys = []
    for kind in ("walls", "pillars", "manual"):
        for poly in occ.get(kind) or []:
            pts = poly.get("points", poly) if isinstance(poly, dict) else poly
            polys.append(f'<polygon class="{kind}" points="{_poly_points(pts, bounds, pad)}"/>')
    return (f'<g id="fitted-occluders" fill="none" stroke="#7a3fd2" stroke-width="0.4">'
            + "".join(polys) + "</g>")


def movement_layer(match_blobs: list[tuple[str, dict]], bounds: dict,
                   pad: float = PAD_YD) -> str:
    """One polyline per unit per match: friendly green, enemy red, recorder blue."""
    groups = []
    for match_id, blob in match_blobs:
        team = {}
        for tg in blob.get("teams", []):
            for pg in tg.get("players", []):
                p = pg.get("player", {})
                team[p.get("unitId")] = tg.get("team")
        recorder = blob.get("playerUnitId")
        lines = []
        for tr in blob.get("positionTracks", []):
            uid = tr.get("unitId")
            if uid not in team:
                continue   # pets stay out - unit paths only
            pts = " ".join(f"{x:.2f},{y:.2f}" for x, y in
                           (world_to_svg(s["x"], s["y"], bounds, pad)
                            for s in tr.get("samples", [])))
            if not pts:
                continue
            color = RECORDER_COLOR if uid == recorder else TEAM_COLORS.get(team[uid], "#666")
            width = 0.5 if uid == recorder else 0.3
            lines.append(f'<polyline points="{pts}" stroke="{color}" '
                         f'stroke-width="{width}" fill="none" stroke-opacity="0.55"/>')
        groups.append(f'<g id="match-{match_id[:8]}">' + "".join(lines) + "</g>")
    return '<g id="movement">' + "".join(groups) + "</g>"


def wmo_layer(obj_dir, transform: dict, bounds: dict, heights: list[float],
              pad: float = PAD_YD) -> str:
    """Cross-sections of every OBJ in the dir at each height, in world coords."""
    from pathlib import Path
    groups = []
    objs = [(p, *load_obj(p)) for p in sorted(Path(obj_dir).glob("*.obj"))]
    for h in heights:
        paths = []
        for p, verts, faces in objs:
            segs = plane_slice(verts, faces, h)
            if not segs:
                continue
            a = wmo_to_world(np.array([s[0] for s in segs]), **transform)
            b = np.array([s[1] for s in segs])
            b = wmo_to_world(b, **transform)
            d = "".join(f"M{world_to_svg(*pa, bounds, pad)[0]:.2f},"
                        f"{world_to_svg(*pa, bounds, pad)[1]:.2f} "
                        f"L{world_to_svg(*pb, bounds, pad)[0]:.2f},"
                        f"{world_to_svg(*pb, bounds, pad)[1]:.2f}"
                        for pa, pb in zip(a, b))
            paths.append(f'<path data-obj="{p.stem}" d="{d}"/>')
        groups.append(f'<g id="wmo-slice-{h:g}" fill="none" stroke="#111" '
                      f'stroke-width="0.15">' + "".join(paths) + "</g>")
    return "".join(groups)


def scale_layer(bounds: dict, pad: float = PAD_YD) -> str:
    """10-yd bar, bottom-left. The document is already 1 unit = 1 yd; this is the check."""
    h = bounds["maxY"] - bounds["minY"] + 2 * pad
    x, y = pad, h - pad / 2
    return (f'<g id="scale">'
            f'<line id="scale-bar" x1="{x}" y1="{y}" x2="{x + 10}" y2="{y}" '
            f'stroke="#000" stroke-width="0.6"/>'
            f'<text x="{x}" y="{y - 1.2}" font-size="2.5" font-family="sans-serif">'
            f'10 yd</text></g>')


def svg_document(arena: str, zone: str, bounds: dict, layers: list[str],
                 pad: float = PAD_YD) -> str:
    w = bounds["maxX"] - bounds["minX"] + 2 * pad
    h = bounds["maxY"] - bounds["minY"] + 2 * pad
    desc = (f"{arena} (zone {zone}) at 1 svg unit = 1 yard. "
            f"worldX = minX + (svgX - pad); worldY = maxY - (svgY - pad); "
            f"minX={bounds['minX']} minY={bounds['minY']} "
            f"maxX={bounds['maxX']} maxY={bounds['maxY']} pad={pad}")
    return (f'<svg xmlns="{SVG_NS}" viewBox="0 0 {w} {h}" '
            f'width="{w * 8}" height="{h * 8}" '
            f'data-zone="{zone}" data-min-x="{bounds["minX"]}" data-min-y="{bounds["minY"]}" '
            f'data-max-x="{bounds["maxX"]}" data-max-y="{bounds["maxY"]}" data-pad="{pad}">'
            f"<desc>{desc}</desc>" + "".join(layers) + "</svg>")


def main() -> None:
    import argparse
    import json
    from pathlib import Path

    from . import db

    ap = argparse.ArgumentParser(prog="wae.mapkit")
    ap.add_argument("--db", default=str(db.REPO_ROOT / "wow-arena-eye.local.db"))
    ap.add_argument("--zone", default="all", help="'all' or one zoneId")
    ap.add_argument("--matches", type=int, default=3, help="recent matches to paint")
    ap.add_argument("--out", default=str(db.REPO_ROOT / "output" / "mapkit"))
    ap.add_argument("--wmo-dir", default=None, help="wow.export dir of .obj groups")
    ap.add_argument("--wmo-zone", default=None, help="zone the WMO layer applies to")
    ap.add_argument("--wmo-mirror", type=int, default=-1)
    ap.add_argument("--wmo-yaw", type=float, default=0.0)
    ap.add_argument("--wmo-tx", type=float, default=0.0)
    ap.add_argument("--wmo-ty", type=float, default=0.0)
    ap.add_argument("--wmo-heights", default="1.5,15,26",
                    help="comma-separated slice heights (obj Y-up yards)")
    args = ap.parse_args()

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
        recent = zrows[-args.matches:]
        blobs = list(db.iter_blobs(args.db, [r["match_id"] for r in recent]))
        grid = db.load_occupancy(zone)
        if grid:
            bounds = grid["bounds"]
        else:
            xs = [s["x"] for _m, b in blobs for tr in b.get("positionTracks", [])
                  for s in tr.get("samples", [])]
            ys = [s["y"] for _m, b in blobs for tr in b.get("positionTracks", [])
                  for s in tr.get("samples", [])]
            if not xs:
                print(f"[mapkit] {zone}: no positions, skipped")
                continue
            bounds = {"minX": min(xs), "minY": min(ys), "maxX": max(xs), "maxY": max(ys)}

        layers = []
        if grid:
            layers.append(voids_layer(grid, bounds))
        occ_path = db.REPO_ROOT / "src" / "metadata" / "occluders" / f"{zone}.json"
        if occ_path.exists():
            layers.append(occluders_layer(json.loads(occ_path.read_text(encoding="utf8")), bounds))
        layers.append(movement_layer(blobs, bounds))
        if args.wmo_dir and zone == (args.wmo_zone or zone):
            transform = {"mirror": args.wmo_mirror, "yaw_deg": args.wmo_yaw,
                         "tx": args.wmo_tx, "ty": args.wmo_ty}
            heights = [float(x) for x in args.wmo_heights.split(",")]
            layers.append(wmo_layer(args.wmo_dir, transform, bounds, heights))
        layers.append(scale_layer(bounds))

        arena = arenas.get(zone, zone)
        path = out_dir / f"{zone}-{arena.replace(' ', '-').replace(chr(39), '')}.svg"
        path.write_text(svg_document(arena, zone, bounds, layers), encoding="utf8")
        print(f"[mapkit] wrote {path.name} ({len(recent)} matches painted)")


if __name__ == "__main__":
    main()
