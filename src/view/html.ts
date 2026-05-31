export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']|[^\x00-\x7F]/gu, (c) => {
    if (c === '&') return '&amp;';
    if (c === '<') return '&lt;';
    if (c === '>') return '&gt;';
    if (c === '"') return '&#34;';
    if (c === "'") return '&#39;';
    return `&#${c.codePointAt(0)};`;
  });
}
