// Regenerate src/metadata/cooldowns.json from the MiniCC enemy-cooldown database.
// Source: MiniCC addon Modules/Cooldowns/Rules.lua (BySpec/ByClass rules, OffensiveSpellIds, specToClass).
// Run manually: WAE_MINICC_RULES="/path/to/MiniCC/Modules/Cooldowns/Rules.lua" node scripts/import-cooldowns.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Index just after the matching close brace for the open brace at `openIdx`. -1 if unbalanced. */
export function matchBrace(s, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** key -> inner body text for every `<key> = { ... }` matched by keyRe at the top level of `body`. */
export function keyedGroups(body, keyRe) {
  const groups = {};
  const re = new RegExp(keyRe, 'g');
  let m;
  while ((m = re.exec(body))) {
    const open = m.index + m[0].length - 1; // m[0] ends with '{'
    const end = matchBrace(body, open);
    if (end < 0) break;
    groups[m[1]] = body.slice(open + 1, end);
    re.lastIndex = end;
  }
  return groups;
}

/** Inner text of each top-level `{ ... }` object inside `body` (handles nested tables). */
export function topLevelObjects(body) {
  const out = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '{') { const end = matchBrace(body, i); out.push(body.slice(i + 1, end)); i = end; }
  }
  return out;
}

function field(block, key) {
  const m = block.match(new RegExp('\\b' + key + '\\s*=\\s*(true|false|-?\\d+)'));
  if (!m) return undefined;
  return m[1] === 'true' ? true : m[1] === 'false' ? false : Number(m[1]);
}

function ruleToEntry(block) {
  const spellId = field(block, 'SpellId');
  if (typeof spellId !== 'number') return undefined;
  const cooldown = field(block, 'Cooldown');
  const buff = field(block, 'BuffDuration');
  const maxCharges = field(block, 'MaxCharges');
  const baseCharges = field(block, 'BaseCharges');
  const castSpellId = field(block, 'CastSpellId');
  const entry = {
    spellId,
    cooldownSec: typeof cooldown === 'number' ? cooldown : 0,
    buffDurationSec: typeof buff === 'number' ? buff : 0,
    charges: typeof maxCharges === 'number' ? maxCharges : (typeof baseCharges === 'number' ? baseCharges : 1),
    bigDefensive: field(block, 'BigDefensive') === true,
    externalDefensive: field(block, 'ExternalDefensive') === true,
    important: field(block, 'Important') === true,
  };
  if (typeof castSpellId === 'number') entry.castSpellId = castSpellId;
  if (field(block, 'NoAura') === true) entry.noAura = true;
  return entry;
}

/** Pure parse of Rules.lua text into the cooldowns.json data object (no I/O). Exported for tests. */
export function parseRules(src) {
  const clean = src.replace(/--.*$/gm, ''); // strip line comments (no braces live inside strings here)

  const sectionBody = (name) => {
    const m = clean.match(new RegExp(name + '\\s*=\\s*\\{'));
    if (!m) return '';
    const open = m.index + m[0].length - 1;
    const end = matchBrace(clean, open);
    if (end < 0) throw new Error('unbalanced braces for section ' + name);
    return clean.slice(open + 1, end);
  };

  const offensiveSpellIds = [];
  for (const mm of sectionBody('offensiveSpellIds').matchAll(/\[(\d+)\]\s*=\s*true/g))
    offensiveSpellIds.push(Number(mm[1]));

  const specToClass = {};
  for (const mm of sectionBody('specToClass').matchAll(/\[(\d+)\]\s*=\s*"([A-Z]+)"/g))
    specToClass[mm[1]] = mm[2];

  const parseSection = (name, keyRe) =>
    Object.fromEntries(
      Object.entries(keyedGroups(sectionBody(name), keyRe))
        .map(([k, body]) => [k, topLevelObjects(body).map(ruleToEntry).filter(Boolean)]),
    );
  const bySpec = parseSection('BySpec', '\\[(\\d+)\\]\\s*=\\s*\\{');
  const byClass = parseSection('ByClass', '\\b([A-Z]+)\\s*=\\s*\\{');

  return { source: 'MiniCC Rules.lua', offensiveSpellIds, specToClass, bySpec, byClass };
}

// CLI entry (skipped when imported by tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const rulesPath = process.env.WAE_MINICC_RULES;
  if (!rulesPath) {
    console.error('Set WAE_MINICC_RULES to the MiniCC Modules/Cooldowns/Rules.lua path.');
    process.exit(1);
  }
  const data = parseRules(readFileSync(rulesPath, 'utf8'));
  data.generatedAt = new Date().toISOString();
  const OUT = fileURLToPath(new URL('../src/metadata/cooldowns.json', import.meta.url));
  writeFileSync(OUT, JSON.stringify(data, null, 0) + '\n');
  const specCount = Object.keys(data.bySpec).length;
  const entries = Object.values(data.bySpec).reduce((n, a) => n + a.length, 0) + Object.values(data.byClass).reduce((n, a) => n + a.length, 0);
  console.log('imported cooldowns:', { specs: specCount, classes: Object.keys(data.byClass).length, entries, offensive: data.offensiveSpellIds.length });
}
