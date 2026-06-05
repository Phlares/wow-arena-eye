import { useState } from 'react';
import type { FilterOptions } from '../api.js';

interface Props {
  label: string;                                  // "My team" | "Enemy"
  tree: FilterOptions['classSpecTree'];
  specs: string;                                  // csv of selected spec ids
  classes: string;                                // csv of selected class names
  onChange: (patch: { specs: string; classes: string }) => void;
}

const csv = (s: string) => new Set(s.split(',').map((x) => x.trim()).filter(Boolean));
const join = (s: Set<string>) => [...s].join(',');

export function CompFilterTree({ label, tree, specs, classes, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const selSpecs = csv(specs);
  const selClasses = csv(classes);
  const count = selSpecs.size + selClasses.size;

  const toggle = (set: Set<string>, key: string, which: 'specs' | 'classes') => {
    const next = new Set(set);
    next.has(key) ? next.delete(key) : next.add(key);
    onChange(which === 'specs'
      ? { specs: join(next), classes }
      : { specs, classes: join(next) });
  };

  return (
    <div className="compfilter">
      <button className="compbtn" onClick={() => setOpen((o) => !o)}>
        {label}: {count === 0 ? 'any' : `${count} ▾`}
      </button>
      {open && (
        <div className="comppop">
          {tree.map((c) => (
            <div key={c.className}>
              <div className="compcls">
                <span className="comparrow" onClick={() => setExpanded((e) => { const n = new Set(e); n.has(c.className) ? n.delete(c.className) : n.add(c.className); return n; })}>
                  {expanded.has(c.className) ? '▾' : '▸'}
                </span>
                <label>
                  <input type="checkbox" aria-label={c.className} checked={selClasses.has(c.className)}
                    onChange={() => toggle(selClasses, c.className, 'classes')} /> {c.className}
                </label>
              </div>
              {expanded.has(c.className) && (
                <div className="compspecs">
                  {c.specs.map((s) => (
                    <label key={s.id} className="compspec">
                      <input type="checkbox" aria-label={s.specName} checked={selSpecs.has(s.id)}
                        onChange={() => toggle(selSpecs, s.id, 'specs')} /> {s.specName}
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
