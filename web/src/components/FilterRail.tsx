import type { FilterOptions, Filters } from '../api.js';
import { CompFilterTree } from './CompFilterTree.js';

interface Props { options: FilterOptions; filters: Filters; onChange: (patch: Filters) => void; }

export function FilterRail({ options, filters, onChange }: Props) {
  const set = (k: string, v: string) => onChange({ [k]: v });
  // result is two checkboxes; empty = both
  const winOn = filters.result !== 'loss';
  const lossOn = filters.result !== 'win';
  const toggleResult = (side: 'win' | 'loss') => {
    const next = { win: winOn, loss: lossOn, [side]: side === 'win' ? !winOn : !lossOn };
    onChange({ result: next.win && next.loss ? '' : next.win ? 'win' : next.loss ? 'loss' : '' });
  };
  const sel = (label: string, key: string, items: { value: string; label: string }[]) => (
    <div className="grp">
      <label className="label" htmlFor={key}>{label}</label>
      <select id={key} value={filters[key] ?? ''} onChange={(e) => set(key, e.target.value)}>
        <option value="">All</option>
        {items.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
      </select>
    </div>
  );
  return (
    <aside className="rail">
      {sel('Character', 'character', options.characters.map((c) => ({ value: c, label: c })))}
      {sel('Bracket', 'bracket', options.brackets.map((b) => ({ value: b, label: b })))}
      <div className="grp">
        <span className="label">Result</span>
        <label><input type="checkbox" aria-label="Win" checked={winOn} onChange={() => toggleResult('win')} /> Win</label>
        <label><input type="checkbox" aria-label="Loss" checked={lossOn} onChange={() => toggleResult('loss')} /> Loss</label>
      </div>
      <CompFilterTree label="My team" tree={options.classSpecTree}
        specs={filters.allySpecs ?? ''} classes={filters.allyClasses ?? ''}
        onChange={(p) => onChange({ allySpecs: p.specs, allyClasses: p.classes })} />
      <CompFilterTree label="Enemy" tree={options.classSpecTree}
        specs={filters.enemySpecs ?? ''} classes={filters.enemyClasses ?? ''}
        onChange={(p) => onChange({ enemySpecs: p.specs, enemyClasses: p.classes })} />
      {sel('Map', 'map', options.maps)}
      <div className="grp">
        <label className="label" htmlFor="q">Search</label>
        <input id="q" value={filters.q ?? ''} onChange={(e) => set('q', e.target.value)} placeholder="comp / map…" />
      </div>
    </aside>
  );
}
