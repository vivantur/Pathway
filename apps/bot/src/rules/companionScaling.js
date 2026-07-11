// Companion derived-stat engine (pure PF2e rules; no I/O, no Discord).
//
// ⚠️ MIRROR OF @pathway/core's companion.ts. The bot cannot `require`
// @pathway/core at runtime — Railway builds apps/bot with Root Directory
// `apps/bot`, so packages/core isn't on disk (see apps/bot/CLAUDE.md deploy
// notes). This is a deliberate second implementation, chosen to keep the
// current deploy working. If you change a companion rule HERE, change it in
// packages/core/src/companion.ts too, or the website and Discord will drift.
//
// RULES SOURCE (non-negotiable): Pathfinder 2e Remaster, Player Core pg. 206-211
// (docs/rules-sources/companions.md at the repo root):
//   - HP = ancestry HP + (6 + Con) per handler level.
//   - Everything is TRAINED from level 1 (proficiency = level + 2×rank, so a
//     young companion's AC/attacks/saves already carry the +2 for trained).
//   - Mature: +1 Str/Dex/Con/Wis; Perception + saves + the type skill to
//     expert; unarmed damage 1 die → 2 dice; grows one size if Medium or
//     smaller.
//   - Nimble: +2 Dex, +1 Str/Con/Wis (cumulative over mature); Acrobatics
//     expert; +2 damage.
//   - Savage: +2 Str, +1 Dex/Con/Wis (cumulative); Athletics expert; +3
//     damage; grows one size if Medium or smaller.
//   - Specialized (nimble/savage only): unarmed attacks expert; saves +
//     Perception master; +1 Dex, +2 Int; dice 2 → 3; additional damage
//     doubles; plus the specialization's own benefit.

const SIZE_ORDER = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'];

const SKILL_ABILITY = {
  acrobatics: 'dex', arcana: 'int', athletics: 'str', crafting: 'int',
  deception: 'cha', diplomacy: 'cha', intimidation: 'cha', medicine: 'wis',
  nature: 'wis', occultism: 'int', performance: 'cha', religion: 'wis',
  society: 'int', stealth: 'dex', survival: 'wis', thievery: 'dex',
};

// Cumulative ability-mod increases each form adds over the young baseline.
const FORM_ABILITY_DELTA = {
  young: {},
  mature: { str: 1, dex: 1, con: 1, wis: 1 },
  nimble: { str: 2, dex: 3, con: 2, wis: 2 },
  savage: { str: 3, dex: 2, con: 2, wis: 2 },
};
// Flat damage a form adds to Strikes (beyond doubling dice).
const FORM_DAMAGE_BONUS = { young: 0, mature: 0, nimble: 2, savage: 3 };
// Advancement stages that re-check the "Medium or smaller" size gate.
const FORM_GROWTH_STAGES = { young: 0, mature: 1, nimble: 1, savage: 2 };

// Specializations (Player Core pg. 211 + Secrets of Magic Shade). `mods` are
// increases BEYOND the shared specialized package (+1 Dex, +2 Int).
const COMPANION_SPECIALIZATIONS = [
  { slug: 'ambusher', name: 'Ambusher', mods: { dex: 1 }, skill: 'stealth', unarmoredExpert: true },
  { slug: 'bully', name: 'Bully', mods: { str: 1, cha: 3 }, skill: 'intimidation' },
  { slug: 'daredevil', name: 'Daredevil', mods: { dex: 1 }, skill: 'acrobatics', unarmoredExpert: true },
  { slug: 'racer', name: 'Racer', mods: { con: 1 }, fortLegendary: true },
  { slug: 'tracker', name: 'Tracker', mods: { wis: 1 }, skill: 'survival' },
  { slug: 'wrecker', name: 'Wrecker', mods: { str: 1 }, skill: 'athletics' },
  { slug: 'shade', name: 'Shade', mods: {}, unarmoredExpert: true },
];

function findSpecialization(slug) {
  if (!slug) return null;
  const s = String(slug).toLowerCase();
  return COMPANION_SPECIALIZATIONS.find((d) => d.slug === s) ?? null;
}

// Grow a size one step per advancement stage, re-checking "Medium or smaller"
// at each stage — a Medium base grows to Large at mature, then stops.
function growSize(size, stages) {
  let i = SIZE_ORDER.indexOf(String(size || '').toLowerCase());
  if (i < 0) return size;
  const medium = SIZE_ORDER.indexOf('medium');
  for (let s = 0; s < stages; s += 1) {
    if (i > medium) break;
    i += 1;
  }
  return SIZE_ORDER[Math.min(i, SIZE_ORDER.length - 1)] ?? size;
}

// Multiply the dice count of a young damage die, e.g. "1d8" ×3 → "3d8".
function multiplyDice(die, factor) {
  const m = String(die || '').match(/^(\d+)(d\d+)$/i);
  if (!m) return die;
  return `${Number(m[1]) * factor}${m[2]}`;
}

/**
 * Derive a companion's statistics.
 *
 * @param {object} type Normalized companion type:
 *   { abilityMods:{str,dex,con,int,wis,cha}, ancestryHp:number, size:string,
 *     skill:string|null, attacks:[{name,traits:[],damageDie,damageType}] }
 * @param {number} level Handler level.
 * @param {'young'|'mature'|'nimble'|'savage'} form
 * @param {number} [itemAcBonus=0] Barding (capped at +3).
 * @param {string|null} [specialization] Slug; applies only on nimble/savage.
 * @returns scaled stats (core-style: saves.fortitude/reflex/will; attacks
 *   carry `attack`, `damage`, `damageBonus`, `damageType`).
 */
function scaleCompanionStats(type, level, form, itemAcBonus = 0, specialization = null) {
  const lvl = Math.max(1, Math.min(20, Math.round(level || 1)));
  const base = type.abilityMods || {};
  const delta = FORM_ABILITY_DELTA[form] || {};
  const spec = form === 'nimble' || form === 'savage' ? findSpecialization(specialization) : null;
  const sm = spec ? spec.mods || {} : {};

  const mods = {
    str: (base.str || 0) + (delta.str || 0) + (sm.str || 0),
    dex: (base.dex || 0) + (delta.dex || 0) + (spec ? 1 : 0) + (sm.dex || 0),
    con: (base.con || 0) + (delta.con || 0) + (sm.con || 0),
    int: (base.int || 0) + (spec ? 2 : 0),
    wis: (base.wis || 0) + (delta.wis || 0) + (sm.wis || 0),
    cha: (base.cha || 0) + (sm.cha || 0),
  };

  const matured = form !== 'young' && Boolean(FORM_ABILITY_DELTA[form]);
  const acRank = spec && spec.unarmoredExpert ? 2 : 1;
  const attackRank = spec ? 2 : 1;
  const saveRank = spec ? 3 : matured ? 2 : 1;
  const fortRank = spec && spec.fortLegendary ? 4 : saveRank;
  const prof = (rank) => lvl + 2 * rank;
  const itemAc = Math.max(0, Math.min(3, itemAcBonus || 0));

  const maxHp = (type.ancestryHp || 0) + (6 + mods.con) * lvl;
  const ac = 10 + prof(acRank) + mods.dex + itemAc;
  const perception = prof(saveRank) + mods.wis;
  const saves = {
    fortitude: prof(fortRank) + mods.con,
    reflex: prof(saveRank) + mods.dex,
    will: prof(saveRank) + mods.wis,
  };

  const diceFactor = spec ? 3 : matured ? 2 : 1;
  const flatDamage = (FORM_DAMAGE_BONUS[form] || 0) * (spec ? 2 : 1);
  const attacks = (type.attacks || []).map((a) => {
    const traits = a.traits || [];
    const finesse = traits.includes('finesse');
    const attackAbility = finesse ? Math.max(mods.str, mods.dex) : mods.str;
    return {
      name: a.name,
      traits,
      attack: prof(attackRank) + attackAbility,
      damage: multiplyDice(a.damageDie, diceFactor),
      damageBonus: mods.str + flatDamage,
      damageType: a.damageType,
    };
  });

  const mindless = !type.skill || /^none/i.test(type.skill);
  const skillRank = spec && spec.skill === type.skill ? 3 : matured ? 2 : 1;
  const skillAbility = SKILL_ABILITY[type.skill] || 'str';
  const skill = mindless
    ? null
    : { name: type.skill, modifier: prof(skillRank) + (mods[skillAbility] || 0) };

  return {
    level: lvl,
    form,
    size: growSize(type.size, FORM_GROWTH_STAGES[form] || 0),
    abilityMods: mods,
    maxHp,
    ac,
    perception,
    saves,
    attacks,
    skill,
    specialization: spec,
  };
}

module.exports = {
  COMPANION_SPECIALIZATIONS,
  findSpecialization,
  growSize,
  multiplyDice,
  scaleCompanionStats,
};
