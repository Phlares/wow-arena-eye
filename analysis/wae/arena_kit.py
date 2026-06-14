"""Assemble an arena floor-plan from a wow.export map tile.

Reads `<tile>_ModelPlacementInformation.csv` (wow.export's per-model placement dump),
places each model with the validated recipe, and emits a tracing SVG via wae.mapkit.

The recipe (proven across 6 arenas - Ashamane's, Empyrean, Tiger's Peak, Black Rook
Hold, Maldraxxus, Hook Point):
  per model:  scale * R_euler(rotX, rotY + yaw_off, rotZ) * localVert + (pos - origin)
              with yaw_off = -90 for WMO placements; M2 differs (facing unreliable but
              POSITION is always exact - fine for tracing).
  whole scene: ONE global world-X reflection about the arena WMO's footprint x-centre
              (the WoW->OBJ handedness flip). This is GLOBAL, never per-model - per-model
              reflection silently breaks inter-model alignment on asymmetric arenas.

Each arena is described by a committed config (src/metadata/arena-assembly/<zone>.json):
the arena WMO fdid + prop categories (fdids, colour, wmo/m2, slice band, optional radius
filter to drop far map clutter). Run:
  .venv\\Scripts\\python -m wae.arena_kit --zone 2509 --export-dir C:\\Users\\you\\wow.export
"""
from __future__ import annotations

import csv
import io
from pathlib import Path

import numpy as np

from . import mapkit

YAW_OFF = {"wmo": -90.0, "m2": 0.0}   # M2 facing is unreliable; positions are exact
SLICE_PCT = (2, 98)                   # ignore the foundation/roof tails when banding
_EMPTY_SEGS = np.empty((0, 2, 2))     # the "no cross-section" sentinel (zero segments)


def _stack(segs) -> np.ndarray:
    return np.vstack(segs) if segs else _EMPTY_SEGS


def euler_deg(rx: float, ry: float, rz: float) -> np.ndarray:
    """Rotation matrix from Euler degrees (Y-up), order Ry @ Rx @ Rz."""
    rx, ry, rz = np.radians([rx, ry, rz])
    cx, sx, cy, sy, cz, sz = (np.cos(rx), np.sin(rx), np.cos(ry), np.sin(ry), np.cos(rz), np.sin(rz))
    return (np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
            @ np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
            @ np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]]))


def place(verts: np.ndarray, pos, rot, scale: float, origin, yaw_off: float) -> np.ndarray:
    """Place local verts into the scene frame (relative to `origin`)."""
    r = euler_deg(rot[0], rot[1] + yaw_off, rot[2])
    return scale * (r @ verts.T).T + (np.asarray(pos) - np.asarray(origin))


def reflect_x(arr: np.ndarray, axis_x: float) -> np.ndarray:
    """Reflect the x-component (last-axis index 0) of points/segments about axis_x. In-place."""
    arr[..., 0] = 2 * axis_x - arr[..., 0]
    return arr


def within(pos_xz, center_xz, radius: float) -> bool:
    return bool(np.hypot(*(np.asarray(pos_xz) - np.asarray(center_xz))) < radius)


def resolve_mesh(export_dir, rel: str) -> Path:
    """wow.export CSV paths are like '..\\..\\world\\wmo\\x.obj' - resolve under export_dir."""
    clean = rel.replace("\\", "/")
    while clean.startswith(("../", "./", "/")):   # strip only the leading prefix, not interior segments
        clean = clean.split("/", 1)[1]
    return Path(export_dir) / clean


def parse_placements(csv_text: str) -> list[dict]:
    """One dict per CSV row: file, fdid, kind (wmo|m2), pos (xyz), rot (xyz deg), scale."""
    rows = list(csv.reader(io.StringIO(csv_text), delimiter=";"))
    hdr = {h: i for i, h in enumerate(rows[0])}
    out = []
    for r in rows[1:]:
        if len(r) <= hdr["FileDataID"]:
            continue
        out.append({
            "file": r[hdr["ModelFile"]],
            "fdid": int(r[hdr["FileDataID"]]),
            "kind": r[hdr["Type"]],
            "pos": np.array([float(r[hdr[c]] or 0) for c in ("PositionX", "PositionY", "PositionZ")]),
            "rot": [float(r[hdr[c]] or 0) for c in ("RotationX", "RotationY", "RotationZ")],
            "scale": float(r[hdr["ScaleFactor"]] or 1),   # wow.export occasionally blanks scale
        })
    return out


def dedup_placements(recs: list[dict]) -> list[dict]:
    """Drop models listed in more than one tile CSV - a WMO straddling a tile boundary
    appears in both tiles' dumps with identical fdid + position. Keeps the first."""
    seen, out = set(), []
    for r in recs:
        key = (r["fdid"], tuple(np.round(r["pos"], 1)))
        if key not in seen:
            seen.add(key)
            out.append(r)
    return out


def footprint(tris: np.ndarray, band) -> np.ndarray:
    """(n,2,2) cross-section segments: slice the placed triangles across a vertical band
    [lo_f, hi_f] of their own height range (band = (lo_f, hi_f, n_slices))."""
    lo_f, hi_f, n = band
    if not len(tris):                  # collision-only / face-less OBJ -> nothing to slice
        return _EMPTY_SEGS
    lo, hi = np.percentile(tris[:, :, 1], SLICE_PCT)
    segs = [mapkit._slice_tri(tris, lo + f * (hi - lo)) for f in np.linspace(lo_f, hi_f, n)]
    return _stack([s for s in segs if len(s)])


def assemble(export_dir, config: dict) -> str:
    """Full pipeline: CSV -> placed footprints -> global reflection -> floor-plan SVG."""
    export_dir = Path(export_dir)
    _cache: dict[str, tuple] = {}

    def mesh(rel):
        if rel not in _cache:
            _cache[rel] = mapkit.load_obj(resolve_mesh(export_dir, rel))
        return _cache[rel]

    csv_paths = config["csv"] if isinstance(config["csv"], list) else [config["csv"]]
    recs = dedup_placements([r for c in csv_paths
                             for r in parse_placements((export_dir / c).read_text(encoding="utf8"))])
    by_fdid = {}                       # first-wins: a duplicated fdid keeps its first placement
    for r in recs:
        by_fdid.setdefault(r["fdid"], r)

    def find(fdid, what):
        if fdid not in by_fdid:
            raise ValueError(f"{what} fdid {fdid} not found in {config['csv']} (wrong fdid or tile?)")
        return by_fdid[fdid]

    acfg = config["arena"]
    arena = find(acfg["fdid"], "arena")
    origin = arena["pos"]
    # A mesh override loads a specific OBJ group instead of the CSV's model (e.g. a clean
    # floor group rather than the whole castle); resolve_mesh handles plain relative paths.
    av, af = mesh(acfg["mesh"]) if acfg.get("mesh") else mesh(arena["file"])
    arena_tris = place(av, arena["pos"], arena["rot"], arena["scale"], origin, YAW_OFF["wmo"])[af]
    # NB: arena.band is geometry-load-bearing, not just cosmetic - gcx (the global reflection
    # axis the whole scene mirrors about) is the x-centre of this sliced footprint.
    arena_seg = footprint(arena_tris, acfg.get("band", (0.05, 0.55, 5)))
    if not len(arena_seg):
        raise ValueError(f"arena {acfg['fdid']} produced no cross-section; check arena.band / arena.mesh")
    gcx = (arena_seg[:, :, 0].min() + arena_seg[:, :, 0].max()) / 2   # global reflection axis
    arena_center = np.array([arena_tris[:, :, 0].mean(), arena_tris[:, :, 2].mean()])

    # Thin arena outline under thicker prop strokes keeps the dense floor readable.
    named = [("arena", acfg.get("color", "#999"), acfg.get("width", 0.6), arena_seg)]
    for cat in config["categories"]:
        kind = cat["kind"]
        if kind not in YAW_OFF:
            raise ValueError(f"category {cat['label']!r}: unknown kind {kind!r} (expected {sorted(YAW_OFF)})")
        fdids, yaw, rad = set(cat["fdids"]), YAW_OFF[kind], cat.get("radius")
        # Radius filter drops far map clutter; anchor_fdid centres it on a prop's position
        # (e.g. boundary props clustered near the market stall) rather than the arena.
        center = (find(cat["anchor_fdid"], f"category {cat['label']!r} anchor")["pos"] - origin)[[0, 2]] \
            if cat.get("anchor_fdid") else arena_center
        inst = [r for r in recs if r["fdid"] in fdids
                and (rad is None or within((r["pos"] - origin)[[0, 2]], center, rad))]
        segs = []
        for r in inst:
            v, f = mesh(cat["mesh"]) if cat.get("mesh") else mesh(r["file"])
            s = footprint(place(v, r["pos"], r["rot"], r["scale"], origin, yaw)[f], cat["band"])
            if len(s):
                segs.append(s)
        named.append((cat["label"], cat["color"], cat.get("width", 0.9), _stack(segs)))

    for *_, s in named:          # ONE global reflection of the whole scene
        if len(s):
            reflect_x(s, gcx)
    return _render(named, config)


def slice_heights(tris: np.ndarray, heights) -> np.ndarray:
    """(n,2,2) segments from cross-sectioning placed triangles at explicit absolute Y heights
    (yards relative to the WMO origin) - used for lone-WMO floor-plans where the caller knows
    the walkable band, rather than fractions of the mesh's own range."""
    return _stack([s for h in heights if len((s := mapkit._slice_tri(tris, h)))])


def load_obj_grouped(path) -> tuple[np.ndarray, dict]:
    """Like mapkit.load_obj but keeps faces partitioned by their OBJ group ('g'/'o' line),
    so callers can drop named groups (e.g. a centerRoom or rock-pile group) before slicing.
    Returns (verts Nx3, {group_name: faces Mx3}); polygons are fan-triangulated."""
    verts, groups, cur = [], {}, None
    with open(path, encoding="utf8", errors="ignore") as fh:
        for line in fh:
            if line.startswith("v "):
                verts.append([float(x) for x in line.split()[1:4]])
            elif line.startswith(("g ", "o ")):
                cur = line[2:].strip()
            elif line.startswith("f "):
                idx = [int(p.split("/")[0]) - 1 for p in line.split()[1:]]
                groups.setdefault(cur, []).extend([idx[0], idx[k], idx[k + 1]] for k in range(1, len(idx) - 1))
    return np.array(verts, float), {g: np.array(fs) for g, fs in groups.items() if fs}


def assemble_wmo(export_dir, config: dict) -> str:
    """Floor-plan of a single self-contained WMO OBJ (no placement CSV / no assembly). Each
    config layer cross-sections the mesh at its own list of absolute Y heights; pass several
    heights to surface a stair/ramp walkable band as contour lines. Reflected about the mesh
    x-centre by default (the WoW->OBJ handedness flip), as for assembled arenas. Optional
    exclude_groups drops named OBJ groups (decorative rock piles, an unwanted centerRoom)."""
    export_dir = Path(export_dir)
    mesh_path = resolve_mesh(export_dir, config["obj"])
    excl = set(config.get("exclude_groups", []))
    if excl:
        v, gfaces = load_obj_grouped(mesh_path)
        kept = [f for g, f in gfaces.items() if g not in excl]
        tris = v[np.vstack(kept)] if kept else _EMPTY_SEGS
    else:
        v, f = mapkit.load_obj(mesh_path)
        tris = v[f]
    gcx = (v[:, 0].min() + v[:, 0].max()) / 2
    named = [(L["label"], L.get("color", "#999"), L.get("width", 0.7), slice_heights(tris, L["heights"]))
             for L in config["layers"]]
    if config.get("reflect", True):
        for *_, s in named:
            if len(s):
                reflect_x(s, gcx)
    return _render(named, config)


def _render(named: list, config: dict) -> str:
    """Shared tail: named (label, colour, width, segments) layers -> floor-plan SVG."""
    allpts = np.vstack([s.reshape(-1, 2) for *_, s in named if len(s)])
    bounds = {"minX": float(allpts[:, 0].min()), "minY": float(allpts[:, 1].min()),
              "maxX": float(allpts[:, 0].max()), "maxY": float(allpts[:, 1].max())}

    def path(seg):
        sx, sy = mapkit.world_to_svg(seg[..., 0], seg[..., 1], bounds)   # vectorized; seg is (n,2,2)
        return " ".join(f"M{sx[i, 0]:.2f},{sy[i, 0]:.2f} L{sx[i, 1]:.2f},{sy[i, 1]:.2f}"
                        for i in range(len(seg)))

    layers = [f'<g id="{lbl}" stroke="{col}" stroke-width="{w}" fill="none">'
              f'<path d="{path(seg)}"/></g>' for lbl, col, w, seg in named if len(seg)]
    layers.append(mapkit.scale_layer(bounds))
    return mapkit.svg_document(config.get("name", config["zone"]), config["zone"], bounds, layers)


def main() -> None:
    import argparse
    import json

    from . import db

    ap = argparse.ArgumentParser(prog="wae.arena_kit")
    ap.add_argument("--zone", required=True, help="arena zoneId (config in src/metadata/arena-assembly/)")
    ap.add_argument("--export-dir", required=True, help="wow.export root (contains maps/ and world/)")
    ap.add_argument("--out", default=str(db.REPO_ROOT / "output" / "mapkit" / "floorplans"))
    args = ap.parse_args()

    cfg_path = db.REPO_ROOT / "src" / "metadata" / "arena-assembly" / f"{args.zone}.json"
    config = json.loads(cfg_path.read_text(encoding="utf8"))
    # "obj" config = a lone self-contained WMO (slice one mesh); "csv" = map-tile assembly.
    svg = assemble_wmo(args.export_dir, config) if config.get("obj") else assemble(args.export_dir, config)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    slug = config.get("name", args.zone).replace(" ", "-").replace("'", "")
    path = out / f"{args.zone}-{slug}-assembled.svg"
    path.write_text(svg, encoding="utf8")
    print(f"[arena_kit] wrote {path.name}")


if __name__ == "__main__":
    main()
