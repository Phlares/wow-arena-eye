export function fmtNum(v: number | null): string {
  if (v === null) return '—';
  const abs = Math.abs(v);
  if (abs >= 999_950) return (v / 1_000_000).toFixed(1) + 'M'; // would round to >= 1.0M
  if (abs >= 999.5) return (v / 1_000).toFixed(1) + 'k';        // would round to >= 1.0k
  return String(Math.round(v));
}
export function fmtRatingDelta(v: number | null): string {
  if (v === null) return '';
  return v >= 0 ? `+${v}` : `−${Math.abs(v)}`; // U+2212 minus
}
/** A rating with its signed delta, e.g. "2008 −12"; "—" when the rating is absent. */
export function fmtRating(rating: number | null, delta: number | null): string {
  return `${rating ?? '—'} ${fmtRatingDelta(delta)}`.trim();
}
/** A short seconds value, e.g. "6.2s"; "—" when absent. For aura-uptime metrics. */
export function fmtSeconds(v: number | null): string {
  return v === null ? '—' : `${v.toFixed(1)}s`;
}
export function fmtDuration(sec: number | null): string {
  if (sec === null) return '—';
  const total = Math.round(sec);
  const m = Math.floor(total / 60), s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
export function fmtClock(ms: number | null): string {
  return ms === null ? '—' : new Date(ms).toLocaleString();
}
