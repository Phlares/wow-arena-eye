export type MetricCategory = 'disruption-out' | 'tempo' | 'outcome' | 'movement';

export interface MetricDef { id: string; label: string; category: MetricCategory; }

/** Per-unit metric defs (the Plan-4 battery grows this). */
export const METRICS: MetricDef[] = [
  { id: 'interruptsLanded', label: 'Interrupts landed', category: 'disruption-out' },
  { id: 'purges', label: 'Purges', category: 'disruption-out' },
  { id: 'cleanses', label: 'Cleanses', category: 'disruption-out' },
  { id: 'spellsteals', label: 'Spellsteals', category: 'disruption-out' },
  { id: 'casts', label: 'Casts', category: 'tempo' },
  { id: 'deaths', label: 'Deaths', category: 'outcome' },
  { id: 'distanceMoved', label: 'Distance moved', category: 'movement' },
  { id: 'timeStationarySec', label: 'Time stationary (s)', category: 'movement' },
];
