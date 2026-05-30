export type MetricCategory = 'disruption-out' | 'disruption-in' | 'tempo' | 'outcome';

export interface MetricDef {
  id: string;
  label: string;
  category: MetricCategory;
}

/** Seed registry — Plan 4 grows this. computeMatchMetrics produces these fields. */
export const METRICS: MetricDef[] = [
  { id: 'interruptsLanded', label: 'Interrupts landed', category: 'disruption-out' },
  { id: 'dispels', label: 'Dispels', category: 'disruption-out' },
  { id: 'spellsteals', label: 'Spellsteals', category: 'disruption-out' },
  { id: 'interruptsSuffered', label: 'Times interrupted', category: 'disruption-in' },
  { id: 'buffsLostToPurgeOrSteal', label: 'Buffs purged/stolen off you', category: 'disruption-in' },
  { id: 'casts', label: 'Casts', category: 'tempo' },
  { id: 'castsPerMin', label: 'Casts/min', category: 'tempo' },
  { id: 'deaths', label: 'Deaths', category: 'outcome' },
];
