import type { MetadataView } from '../api.js';

function Section({ title, head, rows }: { title: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="meta-section" open={rows.length < 60}>
      <summary>{title}</summary>
      <table className="sct">
        <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}
        </tbody>
      </table>
    </details>
  );
}

/** Read-only view of what the analysis considers: tracked offensive CDs (with curated meta),
 *  the pruned vendor false-positives, CC with DR categories, and the defensive registry.
 *  Editing/overrides are future work. */
export function Settings({ meta }: { meta: MetadataView }) {
  return (
    <div className="settings">
      <p className="settings-note">
        The spell sets the analysis tracks (read-only). GO tracks/bands light up on the offensive
        set; the favor ratio uses the offensive + defensive registries; the CC lane uses the DR table.
      </p>
      <Section title={`Offensive CDs (${meta.offensive.length})`} head={['id', 'name', 'cooldown', 'kind', 'window']}
        rows={meta.offensive.map((o) => [o.id, o.name ?? '—', o.cooldownSec ? `${o.cooldownSec}s` : '—', o.kind ?? '—', o.windowSec ? `${o.windowSec}s` : '—'])} />
      <Section title={`Excluded (${meta.denied.length})`} head={['id', 'name', 'why excluded']}
        rows={meta.denied.map((o) => [o.id, o.name, o.reason])} />
      <Section title={`CC / diminishing returns (${meta.cc.length})`} head={['id', 'name', 'DR category']}
        rows={meta.cc.map((c) => [c.id, c.name, c.category])} />
      <Section title={`Defensives & other tracked CDs (${meta.defensives.length})`} head={['id', 'cooldown', 'category']}
        rows={meta.defensives.map((d) => [d.id, `${d.cooldownSec}s`, d.category])} />
    </div>
  );
}
