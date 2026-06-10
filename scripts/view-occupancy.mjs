// Render the committed occupancy grids (src/metadata/occupancy/*.json) into a
// single self-contained HTML viewer you can open in a browser.
//   node scripts/view-occupancy.mjs   ->   output/occupancy-viewer.html
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// zoneId -> arena name (mirrors vendor zoneMetadata; viewer-only labels).
const NAMES = {
  '2563': 'Nokhudon Proving Grounds', '2547': 'Enigma Crucible', '2509': 'Maldraxxus Coliseum',
  '1505': 'Nagrand Arena', '1825': 'Hook Point', '2167': 'The Robodrome', '1911': 'Mugambala',
  '1552': "Ashamane's Fall", '1504': 'Black Rook Hold Arena', '980': "Tol'Viron Arena",
  '1134': "Tiger's Peak", '572': 'Ruins of Lordaeron', '617': 'Dalaran Sewers',
  '1672': "Blade's Edge Arena", '2373': 'Empyrean Domain', '2759': 'Cage of Carnage',
};

const occDir = fileURLToPath(new URL('../src/metadata/occupancy/', import.meta.url));
const fitDir = fileURLToPath(new URL('../src/metadata/occluders/', import.meta.url));
const artDir = fileURLToPath(new URL('../vendor/wowarenalogs/assets/arena_maps/', import.meta.url));

// world bounds of the vendored replay map art (zoneMetadata.ts): image left edge = world maxX
// (the replay renders x NEGATED at 5px/yd), top edge = world minY.
const zoneMetaSrc = readFileSync(
  fileURLToPath(new URL('../vendor/wowarenalogs/packages/shared/src/data/zoneMetadata.ts', import.meta.url)), 'utf8');
const zoneMeta = {};
for (const m of zoneMetaSrc.matchAll(/id:\s*'(\d+)'[\s\S]*?minX:\s*(-?\d+\.?\d*)[\s\S]*?minY:\s*(-?\d+\.?\d*)[\s\S]*?maxX:\s*(-?\d+\.?\d*)[\s\S]*?maxY:\s*(-?\d+\.?\d*)/g)) {
  zoneMeta[m[1]] = { minX: +m[2], minY: +m[3], maxX: +m[4], maxY: +m[5] };
}

const grids = readdirSync(occDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => {
    const g = JSON.parse(readFileSync(join(occDir, f), 'utf8'));
    const fitPath = join(fitDir, f);
    const fit = existsSync(fitPath) ? JSON.parse(readFileSync(fitPath, 'utf8')) : null;
    const artPath = join(artDir, `${g.zoneId}.png`);
    const art = existsSync(artPath) && zoneMeta[g.zoneId]
      ? { dataUri: `data:image/png;base64,${readFileSync(artPath).toString('base64')}`, ...zoneMeta[g.zoneId] }
      : null;
    return {
      zoneId: g.zoneId, name: NAMES[g.zoneId] ?? `zone ${g.zoneId}`,
      cols: g.cols, rows: g.rows, cellSize: g.cellSize, coverage: g.coverage,
      sampleCount: g.sampleCount, isZAxisMap: g.isZAxisMap, bounds: g.bounds,
      polys: fit ? [...fit.walls, ...fit.pillars] : [],
      art,
      // quantize void-ness to 0..255 to keep the inlined payload small
      v: g.voidness.map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255)),
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

const DATA = JSON.stringify(grids);

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>wow-arena-eye — inferred occupancy maps</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background:#0b0f14; color:#cdd6e0; font:14px/1.5 system-ui,Segoe UI,sans-serif; }
  header { padding:18px 22px; border-bottom:1px solid #1c2733; }
  h1 { margin:0 0 4px; font-size:18px; }
  header p { margin:4px 0; color:#8a98a8; max-width:70ch; }
  .legend { display:flex; gap:18px; align-items:center; margin-top:10px; flex-wrap:wrap; }
  .legend .bar { width:200px; height:14px; border-radius:3px;
    background:linear-gradient(90deg,#11202e 0%,#11202e 12%,#1d6f6f 45%,#caa12a 70%,#d83a2a 100%); }
  .legend .k { display:flex; align-items:center; gap:6px; }
  .legend .sw { width:13px; height:13px; border-radius:3px; display:inline-block; }
  .grid { display:flex; flex-wrap:wrap; gap:18px; padding:22px; }
  .card { background:#0f151c; border:1px solid #1c2733; border-radius:10px; padding:12px; }
  .card h2 { margin:0 0 2px; font-size:14px; }
  .card .meta { color:#7e8c9c; font-size:12px; margin-bottom:8px; }
  .card .z { color:#caa12a; }
  canvas { image-rendering:pixelated; background:#070a0e; border-radius:4px; display:block; }
  label.scale { color:#8a98a8; font-size:12px; }
  input[type=range]{ vertical-align:middle; }
</style></head><body>
<header>
  <h1>Inferred occupancy maps — wow-arena-eye</h1>
  <p>Each grid is built from where players <em>were</em> across the corpus. Cells nobody walks become
  high "void-ness"; enclosed void (surrounded by floor) is inferred occluder/wall, while open-border
  void is treated as outside-the-arena and zeroed. This is exactly what the line-of-sight check sees.</p>
  <p>Color = void-ness. Dark = walkable floor (or exterior). Warm/red = inferred wall.
  The two notches are the LoS thresholds: below <b>0.50</b> = clear, at/above <b>0.85</b> = blocked.</p>
  <div class="legend">
    <span>void-ness 0</span><span class="bar"></span><span>1</span>
    <span class="k"><span class="sw" style="background:#11202e"></span>floor/exterior</span>
    <span class="k"><span class="sw" style="background:#caa12a"></span>likely-blocked</span>
    <span class="k"><span class="sw" style="background:#d83a2a"></span>blocked (occluder)</span>
    <span class="k"><span class="sw" style="background:transparent;border:2px solid #4ade80"></span>fitted occluder polygon</span>
    <label class="scale"><input id="showArt" type="checkbox" checked> map art underlay</label>
    <label class="scale"><input id="showPolys" type="checkbox" checked> fitted polygons</label>
    <span style="margin-left:auto"><label class="scale">cell size <input id="scale" type="range" min="3" max="14" value="7"> <span id="scaleVal">7</span>px</label></span>
  </div>
</header>
<div class="grid" id="grid"></div>
<script>
const GRIDS = ${DATA};
// void-ness (0..1) -> [r,g,b]. Three bands keyed to the LoS thresholds.
function color(v){
  if (v < 0.5){ const t=v/0.5; return [17+(29-17)*t, 32+(111-32)*t, 46+(111-46)*t]; }     // navy -> teal (clear)
  if (v < 0.85){ const t=(v-0.5)/0.35; return [29+(202-29)*t, 111+(161-111)*t, 111+(42-111)*t]; } // teal -> amber
  const t=(v-0.85)/0.15; return [202+(216-202)*t, 161+(58-161)*t, 42+(42-42)*t];           // amber -> red (blocked)
}
const artImages = new Map(); // zoneId -> HTMLImageElement (decoded once)
function draw(card, g, px){
  const cv = card.querySelector('canvas');
  cv.width = g.cols*px; cv.height = g.rows*px;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(cv.width, cv.height);
  for (let r=0;r<g.rows;r++) for (let c=0;c<g.cols;c++){
    const v = g.v[r*g.cols+c]/255;
    const [R,G,B] = color(v);
    for (let dy=0;dy<px;dy++) for (let dx=0;dx<px;dx++){
      const x=c*px+dx, y=r*px+dy, i=(y*cv.width+x)*4;
      img.data[i]=R|0; img.data[i+1]=G|0; img.data[i+2]=B|0; img.data[i+3]=255;
    }
  }
  ctx.putImageData(img,0,0);
  const pxPerYd = px / g.cellSize;
  const toCx = (wx)=> (wx - g.bounds.minX) * pxPerYd;
  const toCy = (wy)=> (wy - g.bounds.minY) * pxPerYd;
  // map-art underlay (vendored replay PNG): its world x runs maxX -> minX left-to-right,
  // so draw it horizontally mirrored into its world rectangle.
  if (document.getElementById('showArt').checked && g.art){
    const a = g.art;
    const im = artImages.get(g.zoneId);
    if (!im){
      const el = new Image();
      el.onload = ()=> redraw();
      el.src = a.dataUri;
      artImages.set(g.zoneId, el);
    } else if (im.complete){
      const w = (a.maxX - a.minX) * pxPerYd, h = (a.maxY - a.minY) * pxPerYd;
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.translate(toCx(a.maxX), toCy(a.minY));
      ctx.scale(-1, 1);
      ctx.drawImage(im, 0, 0, w, h);
      ctx.restore();
    }
  }
  if (document.getElementById('showPolys').checked){
    ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 2;
    for (const poly of g.polys){
      ctx.beginPath();
      poly.forEach((p, i)=> i ? ctx.lineTo(toCx(p.x), toCy(p.y)) : ctx.moveTo(toCx(p.x), toCy(p.y)));
      ctx.closePath();
      ctx.stroke();
    }
  }
}
const cards = [];
const host = document.getElementById('grid');
for (const g of GRIDS){
  const card = document.createElement('div'); card.className='card';
  const yd = (n)=> (n*g.cellSize);
  card.innerHTML = '<h2>'+g.name+(g.isZAxisMap?' <span class="z">▲ z-axis</span>':'')+'</h2>'+
    '<div class="meta">zone '+g.zoneId+' · '+g.cols+'×'+g.rows+' cells ('+g.cellSize+
    'yd) · '+yd(g.cols)+'×'+yd(g.rows)+'yd · coverage '+g.coverage.toFixed(2)+
    ' · '+g.sampleCount.toLocaleString()+' samples</div>'+
    '<canvas></canvas>';
  host.appendChild(card); cards.push([card,g]);
}
const slider = document.getElementById('scale'), out = document.getElementById('scaleVal');
function redraw(){ const px=+slider.value; out.textContent=px; for (const [card,g] of cards) draw(card,g,px); }
slider.addEventListener('input', redraw);
document.getElementById('showArt').addEventListener('change', redraw);
document.getElementById('showPolys').addEventListener('change', redraw);
redraw();
</script></body></html>`;

const outDir = fileURLToPath(new URL('../output/', import.meta.url));
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const out = join(outDir, 'occupancy-viewer.html');
writeFileSync(out, html);
console.log('wrote', out, '(' + grids.length + ' maps)');
