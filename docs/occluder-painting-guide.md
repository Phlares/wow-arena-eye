# Occluder painting guide (evening task)

Goal: correct the auto-fitted LoS geometry per map. ~20–40 min for all 15 maps.

## Setup

```powershell
npm run edit-occluders      # builds output/occluder-editor.html
```

Open `output/occluder-editor.html` in a browser. Pick a map top-left. Toggle **art** /
**heatmap** / **fitted** layers and use the zoom slider as needed.

## Tools

| Tool | Use it for | How |
|---|---|---|
| ➕ **Add occluder** | A pillar/wall the green auto-fit missed or got badly wrong | Pick a **height** first, then click vertices, **Enter** (or double-click) to close |
| 🧽 **Remove region** | Auto-fitted geometry that is wrong (bogus pillar from sparse data) | Same drawing; it erases the inference *before* fitting, so the pillar won't re-form |
| 📐 **Sloped LoS** | Ramp/ledge boundaries where LoS depends on elevation | Set **from** and **to** heights, click the line's points along the edge, **Enter** |

Heights: **0** = ground · **1** = 3 yd (one character) · **2** = 8 yd · **3** = 20 yd (full block / the Mugambala split).

Keys: **Backspace** = undo last vertex · **Esc** = cancel shape · **Select** tool + click + **Delete** = remove a shape.

## Per-map priorities (from the fit audit)

1. **Ruins of Lordaeron (572)** — auto-fit found **zero** pillars; paint the central tomb + slope edges.
2. **Mugambala (1911)** — the 20-yd elevation split: sloped-LoS lines (from 0 → to 3) along the ledge.
3. **Z-axis maps** (marked ▲): Dalaran Sewers, Tiger's Peak, Robodrome, Cage of Carnage, Black Rook Hold, Nokhudon — check ramps/ledges, add slopes where LoS is elevation-dependent.
4. Everywhere else: sanity-check the green polygons against the art; remove/redraw any that look wrong.

## Gotchas

- A remove region smaller than one grid cell (~2 yd) may cover no cell center and silently do nothing — paint at least a full cell.
- Drawings autosave **to the browser** (localStorage), not to the repo. "↻ Load repo version" discards local edits back to the committed file.
- If a shape comes out wrong, Select + Delete and redraw — no partial vertex editing in v1.

## When done

1. **⬇ Export overrides JSON** → save the download as `src/metadata/occluderOverrides.json` (overwrite).
2. `npm run fit-occluders` — regenerates `src/metadata/occluders/*.json` with your corrections
   (console shows per-map: removed regions / manual occluders / slopes).
3. `npm run view-occupancy` to eyeball the merged result; commit both JSON sets.
4. Tell Claude it's done → next step is the height/slope-aware LoS engine + ingest wiring.
