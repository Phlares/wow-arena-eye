/** Retail healer specialization IDs (to identify enemy healers for coordination). */
export const HEALER_SPEC_IDS: string[] = ['65', '105', '256', '257', '264', '270', '1468'];
// HolyPaladin 65, RestoDruid 105, DiscPriest 256, HolyPriest 257, RestoShaman 264, Mistweaver 270, PreservationEvoker 1468

export type MetricCategory = 'disruption-out' | 'tempo' | 'outcome' | 'movement';

export interface MetricDef { id: string; label: string; category: MetricCategory; }

/** Forward stub — NOT yet consumed by any module. Seeds the Plan-4 scoring/selection layer. */
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
