const charOverlay = require('./characterOverlay');
const { loreKey } = require('./lore');
const {
  canonicalProfValue,
  calcCharacterProfNum,
  calcEditableProfNum,
} = require('./pf2eMath');
const { computeCharPerception } = require('./characterChecks');
const { computeCharMaxHp } = require('../state/characters');

const SKILL_ABILITIES_FULL = {
  acrobatics: 'dex',
  arcana: 'int',
  athletics: 'str',
  crafting: 'int',
  deception: 'cha',
  diplomacy: 'cha',
  intimidation: 'cha',
  medicine: 'wis',
  nature: 'wis',
  occultism: 'int',
  performance: 'cha',
  religion: 'wis',
  society: 'int',
  stealth: 'dex',
  survival: 'wis',
  thievery: 'dex',
};

function abilityMod(ab, key) {
  const score = ab?.[key];
  if (typeof score !== 'number') return 0;
  return Math.floor((score - 10) / 2);
}

function resolveVariable(rawName, charEntry) {
  if (!charEntry || !charEntry.data) return undefined;
  const c = charEntry.data;
  const name = String(rawName).trim().toLowerCase();
  if (!name) return undefined;
  const ab = c.abilities ?? {};
  const prof = c.proficiencies ?? {};
  const lvl = c.level ?? 1;

  const cvars = charEntry.overlay?.cvars ?? {};
  if (Object.prototype.hasOwnProperty.call(cvars, name)) return cvars[name];

  if (name.startsWith('counter.')) {
    const counters = charEntry.overlay?.counters ?? {};
    const rest = name.slice('counter.'.length);
    const dotIdx = rest.indexOf('.');
    const cname = dotIdx === -1 ? rest : rest.slice(0, dotIdx);
    const field = dotIdx === -1 ? 'current' : rest.slice(dotIdx + 1);
    const ctr = counters[cname];
    if (!ctr) return undefined;
    if (field === 'current' || field === '') return ctr.current;
    if (field === 'max') return ctr.max;
    return undefined;
  }

  if (name.startsWith('rank.')) {
    const skill = name.slice('rank.'.length);
    return Number(prof[skill] ?? 0);
  }

  switch (name) {
    case 'name':       return charEntry.name || c.name || '';
    case 'level':      return lvl;
    case 'speed':      return c.stats?.speed ?? ((c.attributes?.speed ?? 25) + (c.attributes?.speedBonus ?? 0));
    case 'ac':         return c.acTotal?.acTotal ?? 10;
    case 'hp':         return charEntry.hp ?? c.attributes?.ancestryhp ?? 0;
    case 'maxhp':      return computeCharMaxHp(charEntry);
    case 'hero':       return charOverlay.getHeroPoints(charEntry);
    case 'classdc':    return 10 + abilityMod(ab, c.keyability) + calcCharacterProfNum(c, canonicalProfValue(prof, 'class_dc', 'classDC'), lvl);
    case 'str': case 'dex': case 'con':
    case 'int': case 'wis': case 'cha':
      return abilityMod(ab, name);
    case 'key':        return abilityMod(ab, c.keyability);
    case 'fort': case 'fortitude':
      return abilityMod(ab, 'con') + calcCharacterProfNum(c, prof.fortitude ?? 0, lvl);
    case 'ref': case 'reflex':
      return abilityMod(ab, 'dex') + calcCharacterProfNum(c, prof.reflex ?? 0, lvl);
    case 'will':
      return abilityMod(ab, 'wis') + calcCharacterProfNum(c, prof.will ?? 0, lvl);
    case 'perception':
      return computeCharPerception(charEntry);
    default:
      break;
  }

  if (Object.prototype.hasOwnProperty.call(SKILL_ABILITIES_FULL, name)) {
    const abilKey = SKILL_ABILITIES_FULL[name];
    return abilityMod(ab, abilKey) + calcCharacterProfNum(c, prof[name] ?? 0, lvl);
  }

  if (name.endsWith('-lore') || name.endsWith('_lore') || name === 'lore') {
    const normalized = loreKey(name);
    const profEntry = Object.entries(prof).find(([key]) => loreKey(key) === normalized);
    return abilityMod(ab, 'int') + calcEditableProfNum(profEntry?.[1] ?? 0, lvl);
  }

  return undefined;
}

function expandVariables(text, charEntry) {
  if (!text || typeof text !== 'string') return text;
  if (text.indexOf('{{') === -1) return text;
  return text.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_.\-]*)\s*\}\}/g, (match, name) => {
    const value = resolveVariable(name, charEntry);
    if (value === undefined) return match;
    return String(value);
  });
}

module.exports = {
  resolveVariable,
  expandVariables,
};
