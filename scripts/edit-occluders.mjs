// Build the occluder CORRECTION EDITOR: paint fixes over the occupancy/art/fitted baseline.
//   npm run edit-occluders   ->   output/occluder-editor.html  (open in a browser)
// Tools: ADD occluder polygon (height level 0-3) · REMOVE region (erases bad inference before
// fitting) · SLOPED-LoS polyline (from->to height). Heights: 0=ground, 1=3yd (character),
// 2=8yd, 3=20yd (the Mugambala split).
// Drawings autosave to localStorage; "Export" downloads occluderOverrides.json -> save it to
// src/metadata/occluderOverrides.json and re-run `npm run fit-occluders`.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

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
const overridesPath = fileURLToPath(new URL('../src/metadata/occluderOverrides.json', import.meta.url));

const zoneMetaSrc = readFileSync(
  fileURLToPath(new URL('../vendor/wowarenalogs/packages/shared/src/data/zoneMetadata.ts', import.meta.url)), 'utf8');
const zoneMeta = {};
for (const m of zoneMetaSrc.matchAll(/id:\s*'(\d+)'[\s\S]*?minX:\s*(-?\d+\.?\d*)[\s\S]*?minY:\s*(-?\d+\.?\d*)[\s\S]*?maxX:\s*(-?\d+\.?\d*)[\s\S]*?maxY:\s*(-?\d+\.?\d*)/g)) {
  zoneMeta[m[1]] = { minX: +m[2], minY: +m[3], maxX: +m[4], maxY: +m[5] };
}

const zones = readdirSync(occDir).filter((f) => f.endsWith('.json')).map((f) => {
  const g = JSON.parse(readFileSync(join(occDir, f), 'utf8'));
  const fitPath = join(fitDir, f);
  const fit = existsSync(fitPath) ? JSON.parse(readFileSync(fitPath, 'utf8')) : { walls: [], pillars: [] };
  const artPath = join(artDir, `${g.zoneId}.png`);
  const art = existsSync(artPath) && zoneMeta[g.zoneId]
    ? { dataUri: `data:image/png;base64,${readFileSync(artPath).toString('base64')}`, ...zoneMeta[g.zoneId] }
    : null;
  return {
    zoneId: g.zoneId, name: NAMES[g.zoneId] ?? `zone ${g.zoneId}`,
    cols: g.cols, rows: g.rows, cellSize: g.cellSize, bounds: g.bounds, isZAxisMap: g.isZAxisMap,
    fitted: [...fit.walls, ...fit.pillars], art,
    v: g.voidness.map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255)),
  };
}).sort((a, b) => a.name.localeCompare(b.name));

const existingOverrides = existsSync(overridesPath)
  ? JSON.parse(readFileSync(overridesPath, 'utf8').replace(/^﻿/, ''))  // tolerate a BOM
  : { version: 1, zones: {} };

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>wow-arena-eye — occluder correction editor</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#0b0f14; color:#cdd6e0; font:14px/1.5 system-ui,Segoe UI,sans-serif; }
  header { padding:12px 18px; border-bottom:1px solid #1c2733; display:flex; flex-wrap:wrap; gap:14px; align-items:center; position:sticky; top:0; background:#0b0f14ee; z-index:5; }
  h1 { margin:0; font-size:16px; }
  select,button,input[type=file]::file-selector-button { background:#15202c; color:#cdd6e0; border:1px solid #2a3a4c; border-radius:6px; padding:5px 10px; font-size:13px; cursor:pointer; }
  button.tool.on { background:#2c4a6e; border-color:#5b8bf0; color:#fff; }
  button.danger { border-color:#7a3b35; }
  .seg { display:inline-flex; gap:4px; align-items:center; }
  .hint { color:#7e8c9c; font-size:12px; }
  #wrap { padding:16px; overflow:auto; }
  canvas { image-rendering:pixelated; background:#070a0e; border-radius:6px; display:block; cursor:crosshair; }
  .legend { display:flex; gap:16px; padding:0 18px 8px; color:#8a98a8; font-size:12px; flex-wrap:wrap; }
  .sw { display:inline-block; width:12px; height:12px; border-radius:3px; vertical-align:-2px; margin-right:4px; }
  #status { margin-left:auto; color:#7fd9b3; font-size:12px; }
</style></head><body>
<header>
  <h1>Occluder editor</h1>
  <select id="zone"></select>
  <span class="seg">
    <button class="tool" data-tool="add">➕ Add occluder</button>
    <label class="hint">height <select id="addH"><option value="1">1 · 3yd (character)</option><option value="2">2 · 8yd</option><option value="3" selected>3 · 20yd / full</option></select></label>
  </span>
  <button class="tool" data-tool="remove">🧽 Remove region</button>
  <span class="seg">
    <button class="tool" data-tool="slope">📐 Sloped LoS</button>
    <label class="hint">from <select id="slopeFrom"><option value="0" selected>0 · ground</option><option value="1">1 · 3yd</option><option value="2">2 · 8yd</option><option value="3">3 · 20yd</option></select>
    to <select id="slopeTo"><option value="0">0 · ground</option><option value="1">1 · 3yd</option><option value="2" selected>2 · 8yd</option><option value="3">3 · 20yd</option></select></label>
  </span>
  <button class="tool" data-tool="select">🖱 Select</button>
  <button id="del" class="danger" disabled>Delete selected</button>
  <span class="seg hint">
    <label><input id="showArt" type="checkbox" checked> art</label>
    <label><input id="showHeat" type="checkbox" checked> heatmap</label>
    <label><input id="showFit" type="checkbox" checked> fitted</label>
    <label>zoom <input id="scale" type="range" min="6" max="20" value="11"></label>
  </span>
  <button id="export">⬇ Export overrides JSON</button>
  <label><input id="import" type="file" accept=".json" style="display:none"><button onclick="document.getElementById('import').click()">⬆ Import</button></label>
  <button id="clearZone" class="danger">Clear this zone</button>
  <button id="loadRepo" title="Discard local edits and reload the committed src/metadata/occluderOverrides.json snapshot">↻ Load repo version</button>
  <span id="status"></span>
</header>
<div class="legend">
  <span><span class="sw" style="background:#4ade8033;border:2px solid #4ade80"></span>fitted (auto, reference)</span>
  <span><span class="sw" style="background:#38bdf833;border:2px solid #38bdf8"></span>added occluder (label = height)</span>
  <span><span class="sw" style="border:2px dashed #f87171"></span>remove region</span>
  <span><span class="sw" style="background:#fb923c"></span>sloped LoS (from→to height at the ends)</span>
  <span class="hint">click = vertex · <b>Enter</b>/double-click = finish · <b>Backspace</b> = undo vertex · <b>Esc</b> = cancel · finish a shape, then Export</span>
</div>
<div id="wrap"><canvas id="cv"></canvas></div>
<script>
const ZONES = ${JSON.stringify(zones)};
const LS_KEY = 'wae-occluder-overrides';
const HEIGHT_YD = [0,3,8,20];
const REPO_OVERRIDES = ${JSON.stringify(existingOverrides)};  // snapshot baked at build time
let overrides = REPO_OVERRIDES;
try { const saved = JSON.parse(localStorage.getItem(LS_KEY)); if (saved && saved.zones) overrides = saved; } catch {}
const save = () => { localStorage.setItem(LS_KEY, JSON.stringify(overrides)); flash('saved locally'); };
const zoneOv = (id) => (overrides.zones[id] ??= { add: [], remove: [], slopes: [] });

const cv = document.getElementById('cv'), ctx = cv.getContext('2d');
const zoneSel = document.getElementById('zone');
for (const z of ZONES) zoneSel.add(new Option(z.name + (z.isZAxisMap ? ' ▲' : ''), z.zoneId));
let zone = ZONES[0];
let tool = 'select';
let draft = [];           // in-progress points (world coords)
let selected = null;      // { kind:'add'|'remove'|'slopes', index }
const artImgs = new Map();

function flash(msg){ const s=document.getElementById('status'); s.textContent=msg; setTimeout(()=>{ if(s.textContent===msg) s.textContent=''; }, 1500); }
function px(){ return +document.getElementById('scale').value; }
function pxPerYd(){ return px() / zone.cellSize; }
function toC(p){ return { x:(p.x - zone.bounds.minX) * pxPerYd(), y:(p.y - zone.bounds.minY) * pxPerYd() }; }
function toW(cx, cy){ return { x: +(zone.bounds.minX + cx / pxPerYd()).toFixed(1), y: +(zone.bounds.minY + cy / pxPerYd()).toFixed(1) }; }

function color(v){
  if (v < 0.5){ const t=v/0.5; return [17+12*t, 32+79*t, 46+65*t]; }
  if (v < 0.85){ const t=(v-0.5)/0.35; return [29+173*t, 111+50*t, 111-69*t]; }
  const t=(v-0.85)/0.15; return [202+14*t, 161-103*t, 42];
}

function poly(points, close){
  ctx.beginPath();
  points.forEach((p,i)=>{ const c=toC(p); i?ctx.lineTo(c.x,c.y):ctx.moveTo(c.x,c.y); });
  if (close) ctx.closePath();
}
function centroid(points){
  const n=points.length; return { x: points.reduce((s,p)=>s+p.x,0)/n, y: points.reduce((s,p)=>s+p.y,0)/n };
}
function label(text, at, fill){
  const c=toC(at); ctx.font='bold 12px system-ui'; ctx.fillStyle=fill;
  ctx.strokeStyle='#0008'; ctx.lineWidth=3; ctx.strokeText(text,c.x+4,c.y-4); ctx.fillText(text,c.x+4,c.y-4);
}

function draw(){
  const p = px();
  cv.width = zone.cols*p; cv.height = zone.rows*p;
  if (document.getElementById('showHeat').checked){
    const img = ctx.createImageData(cv.width, cv.height);
    for (let r=0;r<zone.rows;r++) for (let c=0;c<zone.cols;c++){
      const [R,G,B] = color(zone.v[r*zone.cols+c]/255);
      for (let dy=0;dy<p;dy++) for (let dx=0;dx<p;dx++){
        const i=((r*p+dy)*cv.width + c*p+dx)*4;
        img.data[i]=R|0; img.data[i+1]=G|0; img.data[i+2]=B|0; img.data[i+3]=255;
      }
    }
    ctx.putImageData(img,0,0);
  }
  if (document.getElementById('showArt').checked && zone.art){
    const a = zone.art;
    let im = artImgs.get(zone.zoneId);
    if (!im){ im = new Image(); im.onload = draw; im.src = a.dataUri; artImgs.set(zone.zoneId, im); }
    else if (im.complete){
      const w=(a.maxX-a.minX)*pxPerYd(), h=(a.maxY-a.minY)*pxPerYd();
      ctx.save(); ctx.globalAlpha=.45;
      const o=toC({x:a.maxX,y:a.minY}); ctx.translate(o.x,o.y); ctx.scale(-1,1); ctx.drawImage(im,0,0,w,h);
      ctx.restore();
    }
  }
  if (document.getElementById('showFit').checked){
    ctx.strokeStyle='#4ade80'; ctx.lineWidth=2; ctx.setLineDash([]);
    for (const f of zone.fitted){ poly(f,true); ctx.stroke(); }
  }
  const ov = zoneOv(zone.zoneId);
  ov.add.forEach((a,i)=>{
    const sel = selected && selected.kind==='add' && selected.index===i;
    ctx.fillStyle='#38bdf822'; ctx.strokeStyle= sel?'#fff':'#38bdf8'; ctx.lineWidth= sel?3:2; ctx.setLineDash([]);
    poly(a.points,true); ctx.fill(); ctx.stroke();
    label('h'+a.heightLevel+' · '+HEIGHT_YD[a.heightLevel]+'yd', centroid(a.points), '#38bdf8');
  });
  ov.remove.forEach((rg,i)=>{
    const sel = selected && selected.kind==='remove' && selected.index===i;
    ctx.strokeStyle= sel?'#fff':'#f87171'; ctx.lineWidth= sel?3:2; ctx.setLineDash([6,4]);
    poly(rg.points,true); ctx.stroke();
    label('remove', centroid(rg.points), '#f87171');
  });
  ov.slopes.forEach((s,i)=>{
    const sel = selected && selected.kind==='slopes' && selected.index===i;
    ctx.strokeStyle= sel?'#fff':'#fb923c'; ctx.lineWidth= sel?4:3; ctx.setLineDash([]);
    poly(s.points,false); ctx.stroke();
    label('h'+s.fromHeight, s.points[0], '#fb923c');
    label('h'+s.toHeight+' ▸', s.points[s.points.length-1], '#fb923c');
  });
  if (draft.length){
    ctx.strokeStyle='#facc15'; ctx.lineWidth=2; ctx.setLineDash([3,3]);
    poly(draft, tool!=='slope'); ctx.stroke();
    for (const d of draft){ const c=toC(d); ctx.fillStyle='#facc15'; ctx.fillRect(c.x-2,c.y-2,4,4); }
  }
  ctx.setLineDash([]);
}

function distToSeg(p,a,b){
  const dx=b.x-a.x, dy=b.y-a.y, L2=dx*dx+dy*dy;
  const t = L2? Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/L2)) : 0;
  return Math.hypot(p.x-(a.x+t*dx), p.y-(a.y+t*dy));
}
function inPoly(p,pts){
  let inside=false;
  for (let i=0,j=pts.length-1;i<pts.length;j=i++){
    const a=pts[i],b=pts[j];
    if ((a.y>p.y)!==(b.y>p.y) && p.x < (b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) inside=!inside;
  }
  return inside;
}
function hitTest(w){
  const ov = zoneOv(zone.zoneId);
  const tol = 8 / pxPerYd();  // ~8 screen px regardless of zoom
  for (let i=0;i<ov.slopes.length;i++){
    const pts=ov.slopes[i].points;
    for (let j=0;j<pts.length-1;j++) if (distToSeg(w,pts[j],pts[j+1]) < tol) return {kind:'slopes',index:i};
  }
  for (let i=0;i<ov.add.length;i++) if (inPoly(w, ov.add[i].points)) return {kind:'add',index:i};
  for (let i=0;i<ov.remove.length;i++) if (inPoly(w, ov.remove[i].points)) return {kind:'remove',index:i};
  return null;
}

function finishDraft(){
  if (!draft.length) return;
  const ov = zoneOv(zone.zoneId);
  if (tool==='add' && draft.length>=3) ov.add.push({ heightLevel:+document.getElementById('addH').value, points:draft });
  else if (tool==='remove' && draft.length>=3) ov.remove.push({ points:draft });
  else if (tool==='slope' && draft.length>=2) ov.slopes.push({ fromHeight:+document.getElementById('slopeFrom').value, toHeight:+document.getElementById('slopeTo').value, points:draft });
  draft=[]; save(); draw();
}

cv.addEventListener('click', (e)=>{
  const w = toW(e.offsetX, e.offsetY);
  if (tool==='select'){
    selected = hitTest(w);
    document.getElementById('del').disabled = !selected;
    draw(); return;
  }
  draft.push(w); draw();
});
cv.addEventListener('dblclick', (e)=>{ e.preventDefault(); finishDraft(); });
window.addEventListener('keydown', (e)=>{
  if (e.key==='Enter') finishDraft();
  else if (e.key==='Escape'){ draft=[]; draw(); }
  else if (e.key==='Backspace' && draft.length){ e.preventDefault(); draft.pop(); draw(); }
  else if (e.key==='Delete') document.getElementById('del').click();
});
document.getElementById('del').addEventListener('click', ()=>{
  if (!selected) return;
  zoneOv(zone.zoneId)[selected.kind].splice(selected.index,1);
  selected=null; document.getElementById('del').disabled=true; save(); draw();
});
for (const b of document.querySelectorAll('button.tool')){
  b.addEventListener('click', ()=>{
    tool = b.dataset.tool; draft=[]; selected=null; document.getElementById('del').disabled=true;
    document.querySelectorAll('button.tool').forEach(x=>x.classList.toggle('on', x===b));
    cv.style.cursor = tool==='select' ? 'default' : 'crosshair';
    draw();
  });
}
document.querySelector('button.tool[data-tool=select]').classList.add('on');
zoneSel.addEventListener('change', ()=>{ zone = ZONES.find(z=>z.zoneId===zoneSel.value); draft=[]; selected=null; draw(); });
for (const id of ['showArt','showHeat','showFit','scale']) document.getElementById(id).addEventListener('input', draw);
document.getElementById('clearZone').addEventListener('click', ()=>{
  if (!confirm('Clear all corrections for '+zone.name+'?')) return;
  overrides.zones[zone.zoneId] = { add:[], remove:[], slopes:[] }; save(); draw();
});
document.getElementById('loadRepo').addEventListener('click', ()=>{
  if (!confirm('Discard local (unsaved-to-repo) edits and load the committed overrides snapshot?')) return;
  overrides = JSON.parse(JSON.stringify(REPO_OVERRIDES)); save(); draw(); flash('repo snapshot loaded');
});
document.getElementById('export').addEventListener('click', ()=>{
  const blob = new Blob([JSON.stringify(overrides, null, 1)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'occluderOverrides.json'; a.click();
  flash('exported - save to src/metadata/occluderOverrides.json, then npm run fit-occluders');
});
document.getElementById('import').addEventListener('change', async (e)=>{
  const f = e.target.files[0]; if (!f) return;
  try { const data = JSON.parse(await f.text()); if (data.zones){ overrides = data; save(); draw(); flash('imported'); } }
  catch { flash('import failed: not valid overrides JSON'); }
});
draw();
</script></body></html>`;

const outDirHtml = fileURLToPath(new URL('../output/', import.meta.url));
if (!existsSync(outDirHtml)) mkdirSync(outDirHtml, { recursive: true });
const out = join(outDirHtml, 'occluder-editor.html');
writeFileSync(out, html);
console.log('wrote', out, `(${zones.length} maps; existing overrides: ${Object.keys(existingOverrides.zones).length} zone(s))`);
