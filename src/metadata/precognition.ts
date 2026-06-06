// Precognition is a single shared PvP-talent self-buff. Verified on real 12.0.5 combat logs:
// `SPELL_AURA_APPLIED … 377362,"Precognition",…,BUFF` with srcId == destId, removed via
// SPELL_AURA_REMOVED (~4s). Same id across specs. Refresh from the vendored DB per patch.
export const PRECOGNITION_AURA_ID = 377362;

// Generous cap over the ~4s real duration, used to bound applied-but-never-removed auras
// (same robustness idea as the CC model's MAX_INSTANCE_MS).
export const PRECOGNITION_MAX_INSTANCE_SEC = 8;
