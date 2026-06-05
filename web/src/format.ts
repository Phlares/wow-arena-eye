export function fmtNum(v: number | null): string {
  if (v === null) return '—';
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(v) >= 1_000) return (v / 1_000).toFixed(1) + 'k';
  return String(Math.round(v));
}
export function fmtRatingDelta(v: number | null): string {
  if (v === null) return '';
  return v >= 0 ? `+${v}` : `−${Math.abs(v)}`; // U+2212 minus
}
export function fmtDuration(sec: number | null): string {
  if (sec === null) return '—';
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
export function fmtClock(ms: number | null): string {
  return ms === null ? '—' : new Date(ms).toLocaleString();
}
