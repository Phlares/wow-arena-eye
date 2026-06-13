"""Arena map kit: scaled SVGs (1 unit = 1 yard) with movement paths, occupancy voids,
fitted occluders, a scale bar, and optional WMO cross-section overlay - the tracing
substrate for hand-drawing exact boundaries in Figma."""
# stdlib ET is safe here: it only parses SVG strings THIS test generates in-process
# (no untrusted XML, so XXE/entity-expansion attack surface does not apply)
import xml.etree.ElementTree as ET

import numpy as np
import pytest

from wae import mapkit


def test_world_to_svg_flips_y():
    bounds = {"minX": -100.0, "minY": 600.0, "maxX": -40.0, "maxY": 700.0}
    x, y = mapkit.world_to_svg(-100.0, 700.0, bounds)
    assert (x, y) == (0.0, 0.0)            # NW corner of the world = SVG origin
    x, y = mapkit.world_to_svg(-40.0, 600.0, bounds)
    assert (x, y) == (60.0, 100.0)         # SE corner = (width, height)


def test_plane_slice_cuts_a_crossing_triangle():
    # one triangle stabbing through the y=1 plane: two edges cross it
    verts = np.array([[0.0, 0.0, 0.0], [4.0, 2.0, 0.0], [0.0, 2.0, 4.0]])
    faces = np.array([[0, 1, 2]])
    segs = mapkit.plane_slice(verts, faces, height=1.0)
    assert len(segs) == 1
    (x1, z1), (x2, z2) = segs[0]
    assert {round(x1, 3), round(x2, 3)} == {2.0, 0.0}
    assert {round(z1, 3), round(z2, 3)} == {0.0, 2.0}
    # a plane above the triangle cuts nothing
    assert mapkit.plane_slice(verts, faces, height=5.0) == []


def test_wmo_to_world_yaw_and_mirror():
    pts = np.array([[10.0, 0.0]])
    out = mapkit.wmo_to_world(pts, mirror=1, yaw_deg=0, tx=100.0, ty=200.0)
    assert out[0] == pytest.approx([110.0, 200.0])
    out = mapkit.wmo_to_world(pts, mirror=1, yaw_deg=90, tx=0.0, ty=0.0)
    assert out[0] == pytest.approx([0.0, 10.0], abs=1e-9)
    # mirror flips the local y (obj z) BEFORE rotation
    out = mapkit.wmo_to_world(np.array([[0.0, 3.0]]), mirror=-1, yaw_deg=0, tx=0.0, ty=0.0)
    assert out[0] == pytest.approx([0.0, -3.0])


def _blob(team_units):
    return {
        "playerUnitId": "ME",
        "teams": [{"team": tm, "players": [{"player": {"unitId": u, "team": tm, "spec": "265"}}
                                           for u in us]}
                  for tm, us in team_units.items()],
        "positionTracks": [
            {"unitId": u, "samples": [{"tSec": t, "x": -90.0 + i, "y": 650.0 + t}
                                      for i, t in enumerate(range(0, 9, 2))]}
            for us in team_units.values() for u in us
        ],
    }


def test_movement_layer_one_polyline_per_unit():
    bounds = {"minX": -100.0, "minY": 600.0, "maxX": -40.0, "maxY": 700.0}
    g = mapkit.movement_layer([("m1", _blob({"friendly": ["ME", "HEAL"], "enemy": ["E1"]}))],
                              bounds, pad=0.0)
    el = ET.fromstring(g)   # bare fragment: no xmlns until it sits inside the root svg
    polys = el.findall(".//polyline")
    assert len(polys) == 3
    first = polys[0].get("points").split()[0]
    x, y = (float(v) for v in first.split(","))
    assert (x, y) == (10.0, 50.0)          # world (-90, 650) under the y-flip


def test_svg_document_assembles_and_parses():
    bounds = {"minX": -100.0, "minY": 600.0, "maxX": -40.0, "maxY": 700.0}
    svg = mapkit.svg_document("Test Arena", "999", bounds,
                              [mapkit.scale_layer(bounds)], pad=5.0)
    root = ET.fromstring(svg)
    assert root.get("viewBox") == "0 0 70.0 110.0"   # 60x100 + 2*5 pad
    assert root.get("data-zone") == "999"
    assert root.get("data-min-x") == "-100.0"
    # the coordinate contract travels inside the file
    desc = root.find("{http://www.w3.org/2000/svg}desc")
    assert "worldX = minX + (svgX - pad)" in desc.text
    # scale bar is 10 svg units = 10 yards
    line = root.find(".//{http://www.w3.org/2000/svg}line[@id='scale-bar']")
    assert float(line.get("x2")) - float(line.get("x1")) == 10.0
