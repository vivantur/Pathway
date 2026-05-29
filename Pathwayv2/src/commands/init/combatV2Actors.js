const { EmbedBuilder } = require('discord.js');
const characterState = require('../../state/characters');
const charOverlay = require('../../rules/characterOverlay');
const combatV2State = require('../../rules/combatV2/state');
const combatV2Rolls = require('../../rules/combatV2/rolls');
const { computeCharSkillModifier, calcCharacterProfNum } = require('../../rules/pf2eMath');
const { fmt, calcProfNum } = require('../../lib/format');
const { rollD20Plus } = require('../../lib/dice');
const { PATHWAY_GOLD, PATHWAY_DICE_BUFFER, PATHWAY_DICE_REF } = require('../../discord/rollEmbeds');

const { getCharacterWeapons, splitCharacterDamage } = characterState;

const COMBAT_V2_SKILL_LABELS = {
  acrobatics: 'Acrobatics',
  arcana: 'Arcana',
  athletics: 'Athletics',
  crafting: 'Crafting',
  deception: 'Deception',
  diplomacy: 'Diplomacy',
  intimidation: 'Intimidation',
  medicine: 'Medicine',
  nature: 'Nature',
  occultism: 'Occultism',
  performance: 'Performance',
  religion: 'Religion',
  society: 'Society',
  stealth: 'Stealth',
  survival: 'Survival',
  thievery: 'Thievery',
};

function combatV2Initiative(modifier, resultOverride = null) {
  if (resultOverride !== null && resultOverride !== undefined) {
    return { initiative: resultOverride, text: `(set to ${resultOverride})` };
  }
  const roll = rollD20Plus(modifier ?? 0);
  return { initiative: roll.total, text: `(rolled ${roll.roll} ${fmt(roll.mod)})` };
}

function combatV2CharacterAttacks(charEntry) {
  return getCharacterWeapons(charEntry).map(w => {
    const damage = splitCharacterDamage(w.die ?? '1d4', w.damageType);
    return {
      name: w.display ?? w.name,
      bonus: w.attack ?? 0,
      damage: `${damage.die}${w.damageBonus ? (w.damageBonus > 0 ? '+' : '') + w.damageBonus : ''}`,
      damageType: damage.damageType,
      traits: w.traits ?? [],
      source: 'character',
    };
  });
}

function combatV2CharacterSave(c, saveType) {
  const key = saveType === 'fortitude' ? 'fortitude'
    : saveType === 'reflex' ? 'reflex'
    : saveType === 'will' ? 'will'
    : saveType;
  const abilityKey = key === 'fortitude' ? 'con'
    : key === 'reflex' ? 'dex'
    : 'wis';
  const abilityMod = Math.floor(((c.abilities?.[abilityKey] ?? 10) - 10) / 2);
  return abilityMod + calcCharacterProfNum(c, c.proficiencies?.[key] ?? 0, c.level ?? 1);
}

function combatV2NormalizeSkillName(input) {
  const q = String(input ?? '').toLowerCase().trim();
  if (!q) return null;
  const slug = q.replace(/[^a-z0-9]+/g, '');
  return Object.keys(COMBAT_V2_SKILL_LABELS).find(key => key === q || key.replace(/[^a-z0-9]+/g, '') === slug)
    ?? Object.keys(COMBAT_V2_SKILL_LABELS).find(key => key.startsWith(q) || COMBAT_V2_SKILL_LABELS[key].toLowerCase().startsWith(q))
    ?? null;
}

function combatV2CharacterSkills(charEntry) {
  const skills = {};
  for (const [key, label] of Object.entries(COMBAT_V2_SKILL_LABELS)) {
    const mod = computeCharSkillModifier(charEntry, key);
    if (mod) skills[key] = { label, modifier: mod.modifier, profLabel: mod.profLabel };
  }
  return skills;
}

function combatV2FindSkill(actor, input) {
  const requested = String(input ?? '').toLowerCase().trim();
  if (requested === 'perception' || requested === 'initiative' || requested === 'init') {
    const perception = actor?.perception ?? actor?.stats?.perception ?? actor?.core?.perception ?? null;
    if (perception != null) {
      return {
        key: requested === 'perception' ? 'perception' : 'initiative',
        label: requested === 'perception' ? 'Perception' : 'Initiative',
        modifier: Number(perception),
        usesPerception: true,
      };
    }
  }

  const skills = actor?.skills ?? {};
  const normalized = combatV2NormalizeSkillName(input);
  if (normalized && skills[normalized] != null) {
    const raw = skills[normalized];
    return typeof raw === 'number'
      ? { key: normalized, label: COMBAT_V2_SKILL_LABELS[normalized], modifier: raw }
      : { key: normalized, label: raw.label ?? COMBAT_V2_SKILL_LABELS[normalized], modifier: Number(raw.modifier ?? raw.total ?? 0) };
  }

  const q = requested;
  for (const [key, raw] of Object.entries(skills)) {
    const label = raw?.label ?? key;
    if (key.toLowerCase() === q || label.toLowerCase() === q || label.toLowerCase().includes(q)) {
      return typeof raw === 'number'
        ? { key, label, modifier: raw }
        : { key, label, modifier: Number(raw.modifier ?? raw.total ?? raw ?? 0) };
    }
  }
  return null;
}

function combatV2CheckEmbed(actor, result, thumbnail = null) {
  const lines = [
    `1d20 (${result.die}) ${fmt(result.stat)}`,
  ];
  if (result.effectBonus) lines[0] += ` ${fmt(result.effectBonus)} effects`;
  if (result.bonus) lines[0] += ` ${fmt(result.bonus)} bonus`;
  lines[0] += ` = \`${result.total}\``;
  if (result.dc != null) lines.push(`DC ${result.dc}: **${combatV2Rolls.degreeLabel(result.degree)}**`);
  const prettyLabel = String(result.label ?? '').replace(/ (Check|Save|Attack)$/i, (_m, w) => ` ${w.toLowerCase()}`);
  const embed = new EmbedBuilder()
    .setColor(result.degree === 'criticalSuccess' ? 0x2ecc71
      : result.degree === 'success' ? 0x27ae60
      : result.degree === 'criticalFailure' ? 0x992d22
      : result.degree === 'failure' ? 0xc0392b
      : PATHWAY_GOLD)
    .setTitle(`${actor.name} makes a ${prettyLabel}!`)
    .setDescription(lines.join('\n'));
  if (thumbnail) embed.setThumbnail(thumbnail);
  else if (PATHWAY_DICE_BUFFER) embed.setThumbnail(PATHWAY_DICE_REF);
  return embed;
}

function combatV2PickCaster(charEntry, spell, casterName = null) {
  const c = charEntry?.data ?? {};
  const casters = charOverlay.getCasters(c);
  if (!casters.length) return null;
  if (casterName) return charOverlay.findCaster(c, casterName);
  const spellTraditions = (spell.traditions ?? []).map(t => String(t).toLowerCase());
  return casters.find(sc => spellTraditions.includes(String(sc.magicTradition ?? '').toLowerCase())) ?? casters[0];
}

function combatV2CasterStats(charEntry, spell, casterName = null) {
  const c = charEntry?.data ?? {};
  const caster = combatV2PickCaster(charEntry, spell, casterName);
  const traditionProfMap = { arcane: 'castingArcane', divine: 'castingDivine', occult: 'castingOccult', primal: 'castingPrimal' };
  const tradAbilMap = { arcane: 'int', divine: 'wis', occult: 'cha', primal: 'wis' };
  const tradition = String(caster?.magicTradition ?? spell.traditions?.[0] ?? 'arcane').toLowerCase();
  const keyAbility = String(caster?.ability ?? tradAbilMap[tradition] ?? 'int').toLowerCase();
  const keyMod = Math.floor((((c.abilities ?? {})[keyAbility] ?? 10) - 10) / 2);
  const profKey = traditionProfMap[tradition] ?? 'castingArcane';
  const profNum = (c.proficiencies ?? {})[profKey] ?? 2;
  const profBonus = calcProfNum(profNum, c.level ?? 1);
  return { caster, attack: keyMod + profBonus, dc: 10 + keyMod + profBonus, tradition };
}

function combatV2PickActor(encounter, userId, actorName = null) {
  if (!encounter) return null;
  if (actorName) return combatV2State.findCombatant(encounter, actorName);
  const current = combatV2State.currentCombatant(encounter);
  if (current && (current.ownerId === userId || userId === encounter.gmId)) return current;
  const owned = encounter.combatants.filter(c => c.ownerId === userId && c.hp > 0);
  return owned.length === 1 ? owned[0] : null;
}

function combatV2PickTarget(encounter, actor, targetName = null) {
  if (!encounter || !actor) return null;
  if (targetName) return combatV2State.findCombatant(encounter, targetName);
  const enemies = encounter.combatants.filter(c =>
    c.id !== actor.id &&
    c.hp > 0 &&
    c.isNpc !== actor.isNpc
  );
  return enemies[0] ?? null;
}

function combatV2HasName(encounter, name) {
  return (encounter?.combatants ?? []).some(c => c.name.toLowerCase() === String(name).toLowerCase());
}

function findCharacterEntryForCombatant(characters, combatant) {
  if (!combatant?.ownerId) return null;
  const owned = characters[combatant.ownerId] ?? {};
  for (const key of Object.keys(owned).filter(k => !k.startsWith('_'))) {
    const entry = owned[key];
    const charName = entry?.data?.name ?? entry?.name;
    if (charName && charName.toLowerCase() === combatant.name.toLowerCase()) {
      return { charKey: key, char: entry, companion: null };
    }
    const companions = entry?.companions ?? {};
    const companion = Object.values(companions).find(c =>
      c?.displayName && c.displayName.toLowerCase() === combatant.name.toLowerCase()
    );
    if (companion) return { charKey: key, char: entry, companion };
  }
  return null;
}

module.exports = {
  COMBAT_V2_SKILL_LABELS,
  combatV2Initiative,
  combatV2CharacterAttacks,
  combatV2CharacterSave,
  combatV2CharacterSkills,
  combatV2FindSkill,
  combatV2CheckEmbed,
  combatV2CasterStats,
  combatV2PickActor,
  combatV2PickTarget,
  combatV2HasName,
  findCharacterEntryForCombatant,
};
