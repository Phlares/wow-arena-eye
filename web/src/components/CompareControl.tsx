import type { BaselineQuery } from '../api.js';

const GAMES_NS = [10, 20, 50];
const SESSION_NS = [1, 2, 3];

/** Controlled "Compare against" baseline picker: mode (Overall / Past games / Past sessions) +
 *  an N selector (with All) + composable filter chips. Emits a fresh BaselineQuery on any change. */
export function CompareControl({ baseline, onChange }: { baseline: BaselineQuery; onChange: (b: BaselineQuery) => void }) {
  const set = (patch: Partial<BaselineQuery>) => onChange({ ...baseline, ...patch });
  const setMode = (mode: BaselineQuery['mode']) =>
    onChange({ ...baseline, mode, n: mode === 'overall' ? undefined : baseline.n ?? (mode === 'games' ? 20 : 1) });
  const toggle = (k: 'comp' | 'map' | 'season') => set({ [k]: baseline[k] ? undefined : true } as Partial<BaselineQuery>);
  const toggleNum = (k: 'ratingBand' | 'timeOfDay', v: number) =>
    set({ [k]: baseline[k] === undefined ? v : undefined } as Partial<BaselineQuery>);
  const opts = baseline.mode === 'games' ? GAMES_NS : SESSION_NS;

  return (
    <div className="cmp-ctl">
      <span className="cmp-lbl">Compare against</span>
      <div className="seg">
        {(['overall', 'games', 'sessions'] as const).map((m) => (
          <button key={m} className={baseline.mode === m ? 'on' : ''} onClick={() => setMode(m)}>
            {m === 'overall' ? 'Overall' : m === 'games' ? 'Past games' : 'Past sessions'}
          </button>
        ))}
      </div>
      {baseline.mode !== 'overall' && (
        <select value={baseline.n ?? 'all'} onChange={(e) => set({ n: e.target.value === 'all' ? undefined : Number(e.target.value) })}>
          {opts.map((n) => <option key={n} value={n}>{n}</option>)}
          <option value="all">All</option>
        </select>
      )}
      <div className="chips">
        <button className={`chip ${baseline.comp ? 'on' : ''}`} onClick={() => toggle('comp')}>Same comp</button>
        <button className={`chip ${baseline.map ? 'on' : ''}`} onClick={() => toggle('map')}>Same map</button>
        <button className={`chip ${baseline.ratingBand !== undefined ? 'on' : ''}`} onClick={() => toggleNum('ratingBand', 100)}>Rating ±100</button>
        <button className={`chip ${baseline.timeOfDay !== undefined ? 'on' : ''}`} onClick={() => toggleNum('timeOfDay', 2)}>Time of day ±2h</button>
        <button className={`chip ${baseline.season ? 'on' : ''}`} onClick={() => toggle('season')}>This season</button>
      </div>
    </div>
  );
}
