"""arena_kit: place models from a wow.export map CSV onto a floor-plan. The placement
recipe (validated across 6 arenas): per-model scale*R_euler(rx, ry+yaw_off, rz)*v +
(pos-origin), then ONE global world-X reflection of the whole scene about the arena's
symmetry axis. WMO yaw_off=-90; M2 differs (facing unreliable, positions exact)."""
import re

import numpy as np
import pytest

from wae import arena_kit


def test_euler_identity_and_yaw():
    assert np.allclose(arena_kit.euler_deg(0, 0, 0), np.eye(3))
    # +90 yaw about Y (up): the matrix sends +X to -Z (right-handed Ry)
    out = arena_kit.euler_deg(0, 90, 0) @ np.array([1.0, 0, 0])
    assert np.allclose(out, [0, 0, -1], atol=1e-9)


def test_place_translates_and_rotates():
    verts = np.array([[0.0, 0, 0], [1.0, 0, 0]])
    # local origin -> (pos - origin); identity rotation, unit scale
    placed = arena_kit.place(verts, pos=np.array([10.0, 2, 5]), rot=[0, 0, 0],
                             scale=1.0, origin=np.array([4.0, 0, 1]), yaw_off=0)
    assert np.allclose(placed[0], [6, 2, 4])        # (10-4, 2-0, 5-1)
    assert np.allclose(placed[1], [7, 2, 4])        # +X local stays +X at 0 yaw
    # yaw_off=-90 (the WMO convention) rotates the +X arm to +Z
    placed = arena_kit.place(verts, pos=np.zeros(3), rot=[0, 0, 0], scale=2.0,
                             origin=np.zeros(3), yaw_off=-90)
    assert np.allclose(placed[1], [0, 0, 2], atol=1e-6)   # scale 2 * Ry(-90)@(1,0,0)


def test_parse_placements():
    csv = ("ModelFile;PositionX;PositionY;PositionZ;RotationX;RotationY;RotationZ;"
           "RotationW;ScaleFactor;ModelId;Type;FileDataID;DoodadSetIndexes;DoodadSetNames\n"
           "..\\..\\world\\wmo\\a_set0.obj;100.5;7;200.25;0;90;0;0;1.5;1;wmo;4280168;0;Set\n"
           "..\\..\\world\\m\\b.obj;10;1;20;0;45;0;;1;2;m2;3486913;0;\n")
    recs = arena_kit.parse_placements(csv)
    assert len(recs) == 2
    assert recs[0]["fdid"] == 4280168 and recs[0]["kind"] == "wmo"
    assert np.allclose(recs[0]["pos"], [100.5, 7, 200.25])
    assert recs[0]["rot"] == [0, 90, 0] and recs[0]["scale"] == 1.5
    assert recs[1]["kind"] == "m2" and recs[1]["fdid"] == 3486913
    assert recs[1]["rot"] == [0, 45, 0]   # empty RotationW tolerated


def test_reflect_x_about_axis():
    pts = np.array([[3.0, 1], [7.0, 2]])
    out = arena_kit.reflect_x(pts.copy(), axis_x=5.0)
    assert np.allclose(out[:, 0], [7, 3])   # mirrored about x=5
    assert np.allclose(out[:, 1], [1, 2])   # y untouched


def test_within_radius():
    c = np.array([100.0, 200.0])
    assert arena_kit.within(np.array([110.0, 200.0]), c, 15) is True
    assert arena_kit.within(np.array([130.0, 200.0]), c, 15) is False


def test_resolve_mesh_strips_leading_prefix_only():
    p = arena_kit.resolve_mesh(r"C:\export", r"..\..\world\wmo\a.obj")
    assert str(p).replace("\\", "/").endswith("world/wmo/a.obj")
    assert ".." not in str(p)
    # an interior parent-segment is preserved, not silently collapsed
    assert str(arena_kit.resolve_mesh("/x", "world/../wmo/a.obj")).replace("\\", "/").endswith("world/../wmo/a.obj")


def test_footprint_empty_geometry_returns_empty():
    out = arena_kit.footprint(np.empty((0, 3, 3)), (0.1, 0.5, 2))
    assert out.shape == (0, 2, 2)


# A unit cube's four vertical walls; slicing at any interior height yields a square outline.
_CUBE_OBJ = "\n".join([
    "v -1 -1 -1", "v 1 -1 -1", "v 1 -1 1", "v -1 -1 1",
    "v -1 1 -1", "v 1 1 -1", "v 1 1 1", "v -1 1 1",
    "f 1 2 6 5", "f 2 3 7 6", "f 3 4 8 7", "f 4 1 5 8",
]) + "\n"
_CSV = ("ModelFile;PositionX;PositionY;PositionZ;RotationX;RotationY;RotationZ;"
        "RotationW;ScaleFactor;ModelId;Type;FileDataID;DoodadSetIndexes;DoodadSetNames\n"
        "..\\..\\world\\wmo\\cube.obj;0;0;0;0;0;0;0;1;1;wmo;999;0;Set\n"
        "..\\..\\world\\wmo\\cube.obj;20;0;0;0;0;0;0;1;2;wmo;888;0;Set\n")


def test_assemble_end_to_end(tmp_path):
    (tmp_path / "world" / "wmo").mkdir(parents=True)
    (tmp_path / "world" / "wmo" / "cube.obj").write_text(_CUBE_OBJ, encoding="utf8")
    (tmp_path / "maps").mkdir()
    (tmp_path / "maps" / "t.csv").write_text(_CSV, encoding="utf8")
    config = {
        "zone": "0000", "name": "Test Arena", "csv": "maps/t.csv",
        "arena": {"fdid": 999, "band": [0.2, 0.8, 3]},
        "categories": [{"label": "prop", "fdids": [888], "kind": "wmo", "band": [0.2, 0.8, 2], "color": "#f00"}],
    }
    svg = arena_kit.assemble(tmp_path, config)
    assert svg.startswith("<svg") or "<svg" in svg[:200]
    assert 'id="arena"' in svg and 'id="prop"' in svg     # both layers rendered
    assert "<path d=" in svg and "Test Arena" in svg


def test_dedup_placements_drops_straddling_duplicates():
    recs = [
        {"fdid": 1, "pos": np.array([10.0, 0.0, 5.0])},
        {"fdid": 1, "pos": np.array([10.04, 0.0, 5.0])},   # same model, other tile (rounds equal)
        {"fdid": 2, "pos": np.array([1.0, 0.0, 1.0])},
    ]
    out = arena_kit.dedup_placements(recs)
    assert [r["fdid"] for r in out] == [1, 2]              # straddling dup dropped, first kept


def test_assemble_multi_tile_csv(tmp_path):
    (tmp_path / "world" / "wmo").mkdir(parents=True)
    (tmp_path / "world" / "wmo" / "cube.obj").write_text(_CUBE_OBJ, encoding="utf8")
    (tmp_path / "maps").mkdir()
    arena_row = "..\\..\\world\\wmo\\cube.obj;0;0;0;0;0;0;0;1;1;wmo;999;0;Set\n"
    head = _CSV.splitlines()[0] + "\n"
    # arena straddles both tiles (identical row); each tile carries a distinct prop
    (tmp_path / "maps" / "t1.csv").write_text(
        head + arena_row + "..\\..\\world\\wmo\\cube.obj;20;0;0;0;0;0;0;1;2;wmo;888;0;Set\n", encoding="utf8")
    (tmp_path / "maps" / "t2.csv").write_text(
        head + arena_row + "..\\..\\world\\wmo\\cube.obj;-20;0;0;0;0;0;0;1;3;wmo;777;0;Set\n", encoding="utf8")
    config = {
        "zone": "0", "name": "Two Tile", "csv": ["maps/t1.csv", "maps/t2.csv"],
        "arena": {"fdid": 999, "band": [0.2, 0.8, 3]},
        "categories": [
            {"label": "east", "fdids": [888], "kind": "wmo", "band": [0.2, 0.8, 2], "color": "#f00"},
            {"label": "west", "fdids": [777], "kind": "wmo", "band": [0.2, 0.8, 2], "color": "#00f"},
        ],
    }
    svg = arena_kit.assemble(tmp_path, config)
    assert 'id="east"' in svg and 'id="west"' in svg   # props from BOTH tiles rendered


def test_slice_heights_absolute():
    # the cube spans Y -1..1; slicing at Y=0 hits the four walls, at Y=9 misses entirely
    verts = np.array([[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1],
                      [-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]], float)
    faces = np.array([[0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5],
                      [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]])
    tris = verts[faces]
    assert len(arena_kit.slice_heights(tris, [0.0])) > 0
    assert arena_kit.slice_heights(tris, [9.0]).shape == (0, 2, 2)


# cube walls (group "keep") + a far vertical wall at X~100 (group "drop")
_GROUPED_OBJ = "\n".join([
    "v -1 -1 -1", "v 1 -1 -1", "v 1 -1 1", "v -1 -1 1", "v -1 1 -1", "v 1 1 -1", "v 1 1 1", "v -1 1 1",
    "v 100 -1 100", "v 101 -1 100", "v 101 1 100", "v 100 1 100",
    "g keep", "f 1 2 6 5", "f 2 3 7 6", "f 3 4 8 7", "f 4 1 5 8",
    "g drop", "f 9 10 11 12",
]) + "\n"


def test_assemble_wmo_excludes_groups(tmp_path):
    (tmp_path / "world").mkdir()
    (tmp_path / "world" / "g.obj").write_text(_GROUPED_OBJ, encoding="utf8")
    base = {"zone": "g", "name": "G", "obj": "world/g.obj", "reflect": False,
            "layers": [{"label": "f", "heights": [0.0], "color": "#999"}]}
    width = lambda svg: float(re.search(r'viewBox="[-\d.]+ [-\d.]+ ([\d.]+)', svg).group(1))
    full = arena_kit.assemble_wmo(tmp_path, base)
    pruned = arena_kit.assemble_wmo(tmp_path, {**base, "exclude_groups": ["drop"]})
    assert width(full) > 90       # far 'drop' wall at X~100 widens the document
    assert width(pruned) < 30     # excluding it leaves only the cube near the origin


def test_assemble_wmo_lone_obj(tmp_path):
    (tmp_path / "world" / "wmo").mkdir(parents=True)
    (tmp_path / "world" / "wmo" / "cube.obj").write_text(_CUBE_OBJ, encoding="utf8")
    config = {
        "zone": "lone", "name": "Lone WMO", "obj": "world/wmo/cube.obj",
        "layers": [{"label": "floor", "heights": [-0.5, 0.0, 0.5], "color": "#999", "width": 0.7}],
    }
    svg = arena_kit.assemble_wmo(tmp_path, config)
    assert 'id="floor"' in svg and "<path d=" in svg and "Lone WMO" in svg


def test_assemble_missing_arena_fdid_raises(tmp_path):
    (tmp_path / "world" / "wmo").mkdir(parents=True)
    (tmp_path / "world" / "wmo" / "cube.obj").write_text(_CUBE_OBJ, encoding="utf8")
    (tmp_path / "maps").mkdir()
    (tmp_path / "maps" / "t.csv").write_text(_CSV, encoding="utf8")
    with pytest.raises(ValueError, match="arena fdid 12345"):
        arena_kit.assemble(tmp_path, {"zone": "0", "csv": "maps/t.csv",
                                      "arena": {"fdid": 12345}, "categories": []})
