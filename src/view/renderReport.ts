import type { SidecarIndex, SidecarEntry } from '../sidecar/sidecarIndex.js';

export interface ViewCombatant {
  name: string;
  spec: string;
  type: string;
  reaction: string;
}

export interface ParsedMatchView {
  kind: 'arena' | 'shuffleRound';
  bracket: string;
  zone: string;
  isRanked: boolean | null;
  startTimeMs: number | null;
  startTimeIso: string | null;
  endTimeMs: number | null;
  durationSec: number | null;
  result: unknown;
  winningTeamId: unknown;
  eventCounts: Record<string, number>;
  combatants: ViewCombatant[];
  rawStartInfo: unknown;
  rawEndInfo: unknown;
}

export interface RenderOpts {
  sourceLogPath?: string;
  aborted?: boolean;
  linesAfterError?: number;
}

const MATCH_WINDOW_MS = 15 * 60 * 1000;

export function escapeHtml(s: string): string {
  return s
    .replace(/[&<>"']/g, (c) =>
      c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&#34;' : '&#39;',
    )
    .replace(/[^\x00-\x7F]/g, (c) => `&#${c.codePointAt(0)};`);
}

function nearest(idx: SidecarIndex, startMs: number | null): { entry: SidecarEntry; deltaMs: number } | null {
  if (startMs === null) return null;
  let best: { entry: SidecarEntry; deltaMs: number } | null = null;
  for (const e of idx.entries) {
    if (e.startEpochMs === null) continue;
    const deltaMs = Math.abs(e.startEpochMs - startMs);
    if (best === null || deltaMs < best.deltaMs) best = { entry: e, deltaMs };
  }
  return best;
}

function matchSection(m: ParsedMatchView, idx: SidecarIndex): string {
  const near = nearest(idx, m.startTimeMs);
  let videoBlock: string;
  if (near && near.deltaMs <= MATCH_WINDOW_MS) {
    const sec = (near.deltaMs / 1000).toFixed(1);
    videoBlock =
      `<p class="vid">nearest video (naive ±15min preview): ` +
      `<code>${escapeHtml(near.entry.videoPath)}</code> — delta <b>${sec}s</b> — ` +
      `category ${escapeHtml(near.entry.category ?? '?')} / zone ${escapeHtml(near.entry.zoneName ?? '?')}</p>`;
  } else {
    videoBlock = `<p class="vid">no video match within ±15min (naive preview)</p>`;
  }

  const combatRows = m.combatants
    .map(
      (c) =>
        `<tr><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.spec)}</td>` +
        `<td>${escapeHtml(c.type)}</td><td>${escapeHtml(c.reaction)}</td></tr>`,
    )
    .join('');

  const eventRows = Object.entries(m.eventCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${v}</td></tr>`)
    .join('');

  const summary =
    `${escapeHtml(m.bracket)} · ${escapeHtml(m.zone)} · result=${escapeHtml(String(m.result))} · ` +
    `${m.durationSec ?? '?'}s · ${escapeHtml(m.kind)}`;

  return `<details class="match">
  <summary>${summary}</summary>
  <p>start: ${escapeHtml(m.startTimeIso ?? String(m.startTimeMs))} (epoch ${m.startTimeMs ?? '?'}) ·
     end epoch ${m.endTimeMs ?? '?'} · ranked=${m.isRanked ?? '?'} · winningTeamId=${escapeHtml(String(m.winningTeamId))}</p>
  ${videoBlock}
  <h4>Combatants (${m.combatants.length})</h4>
  <table><tr><th>name</th><th>spec</th><th>type</th><th>reaction</th></tr>${combatRows}</table>
  <h4>Event counts</h4>
  <table><tr><th>event</th><th>count</th></tr>${eventRows}</table>
  <details><summary>raw startInfo / endInfo</summary>
  <pre>${escapeHtml(JSON.stringify({ startInfo: m.rawStartInfo, endInfo: m.rawEndInfo }, null, 2))}</pre></details>
</details>`;
}

export function renderReport(matches: ParsedMatchView[], idx: SidecarIndex, opts: RenderOpts = {}): string {
  const deltas: number[] = [];
  for (const m of matches) {
    const near = nearest(idx, m.startTimeMs);
    if (near && near.deltaMs <= MATCH_WINDOW_MS) deltas.push(near.deltaMs);
  }
  deltas.sort((a, b) => a - b);
  const fmt = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  const deltaSummary =
    deltas.length > 0
      ? `match→video deltas: min ${fmt(deltas[0])}, median ${fmt(deltas[Math.floor(deltas.length / 2)])}, max ${fmt(deltas[deltas.length - 1])} (n=${deltas.length})`
      : 'match→video deltas: none in window';

  const abortBanner = opts.aborted
    ? `<p class="warn">WARNING: parse aborted — ${opts.linesAfterError ?? 0} lines dropped after a parser error; data is INCOMPLETE.</p>`
    : '';

  const body = matches.length > 0 ? matches.map((m) => matchSection(m, idx)).join('\n') : '<p>0 matches parsed.</p>';

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>wow-arena-eye debug report</title>
<style>
body{font-family:monospace;margin:1rem;line-height:1.4}
table{border-collapse:collapse;margin:.3rem 0}
td,th{border:1px solid #ccc;padding:2px 8px;text-align:left}
.match{border:1px solid #999;margin:.4rem 0;padding:.3rem .6rem}
summary{cursor:pointer;font-weight:bold}
.vid{color:#225}
.warn{color:#a00;font-weight:bold}
pre{background:#f4f4f4;padding:.4rem;overflow:auto}
header{border-bottom:2px solid #333;margin-bottom:.6rem}
</style></head><body>
<header>
<h2>wow-arena-eye debug report</h2>
<p>source log: <code>${escapeHtml(opts.sourceLogPath ?? '(unknown)')}</code></p>
<p>${matches.length} matches · sidecars loaded ${idx.loaded} / skipped ${idx.skipped}</p>
<p>${escapeHtml(deltaSummary)}</p>
${abortBanner}
</header>
${body}
</body></html>`;
}
