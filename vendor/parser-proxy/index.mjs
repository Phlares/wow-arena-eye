// Use the CJS build to avoid rxjs 6 directory-import issues in Node 22 ESM.
//
// FRAGILITY NOTES (see design spec / Plan 2):
//  - Relies on npm symlinking this file: dependency in place
//    (node_modules/@wowarenalogs/parser -> vendor/parser-proxy), so the relative
//    require below resolves into the sibling submodule. A package manager that
//    COPIES instead of symlinking would break this path.
//  - The named re-export list below is HAND-MAINTAINED and can silently DRIFT if
//    the vendored parser changes its exports (tsc won't catch it — types are
//    re-exported via index.d.ts). Re-check against the build after updating the
//    submodule.
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const _m = require('../wowarenalogs/packages/parser/dist/index.js');

export const LogEvent = _m.LogEvent;
export const CombatResult = _m.CombatResult;
export const CombatUnitReaction = _m.CombatUnitReaction;
export const CombatUnitAffiliation = _m.CombatUnitAffiliation;
export const CombatUnitType = _m.CombatUnitType;
export const CombatUnitClass = _m.CombatUnitClass;
export const CombatUnitSpec = _m.CombatUnitSpec;
export const CombatUnitPowerType = _m.CombatUnitPowerType;
export const SpellTag = _m.SpellTag;
export const ArenaMatchEnd = _m.ArenaMatchEnd;
export const ArenaMatchStart = _m.ArenaMatchStart;
export const CombatAbsorbAction = _m.CombatAbsorbAction;
export const CombatAction = _m.CombatAction;
export const CombatAdvancedAction = _m.CombatAdvancedAction;
export const CombatExtraSpellAction = _m.CombatExtraSpellAction;
export const CombatHpUpdateAction = _m.CombatHpUpdateAction;
export const CombatSupportAction = _m.CombatSupportAction;
export const PIPELINE_FLUSH_SIGNAL = _m.PIPELINE_FLUSH_SIGNAL;
export const WoWCombatLogParser = _m.WoWCombatLogParser;
export const ZoneChange = _m.ZoneChange;
export const buildMMRHelpers = _m.buildMMRHelpers;
export const buildQueryHelpers = _m.buildQueryHelpers;
export const classMetadata = _m.classMetadata;
export const computeCanonicalHash = _m.computeCanonicalHash;
export const getBurstDps = _m.getBurstDps;
export const getClassColor = _m.getClassColor;
export const getEffectiveCombatDuration = _m.getEffectiveCombatDuration;
export const getEffectiveDps = _m.getEffectiveDps;
export const getEffectiveHps = _m.getEffectiveHps;
export const getPowerColor = _m.getPowerColor;
export const getUnitAffiliation = _m.getUnitAffiliation;
export const getUnitReaction = _m.getUnitReaction;
export const getUnitType = _m.getUnitType;
export const logLineToCombatEvent = _m.logLineToCombatEvent;
export const nullthrows = _m.nullthrows;
export const parseQuotedName = _m.parseQuotedName;
export const stringToLogLine = _m.stringToLogLine;
export default _m;
