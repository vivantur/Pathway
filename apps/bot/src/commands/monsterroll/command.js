const { EmbedBuilder } = require('discord.js');

const { findMonster } = require('../monster/lookup');
const {
  lookupMonsterArt,
  getMonsterEdit,
  applyMonsterEdits,
  applyMonsterAttackLibrary,
} = require('../monster/helpers');
const { buildRollEmbed, formatRollBreakdown, PATHWAY_GOLD, PATHWAY_DICE_BUFFER, PATHWAY_DICE_REF } = require('../../discord/rollEmbeds');
const { fmt } = require('../../lib/format');
const { sumEffectModifiers } = require('../../rules/combatEffects');
const combatV2State = require('../../state/combat');
const combatV2Rolls = require('../../rules/combatV2/rolls');

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

function combatV2NormalizeSkillName(input) {
  const q = String(input ?? '').toLowerCase().trim();
  if (!q) return null;
  const slug = q.replace(/[^a-z0-9]+/g, '');
  return Object.keys(COMBAT_V2_SKILL_LABELS).find(key => key === q || key.replace(/[^a-z0-9]+/g, '') === slug)
    ?? Object.keys(COMBAT_V2_SKILL_LABELS).find(key => key.startsWith(q) || COMBAT_V2_SKILL_LABELS[key].toLowerCase().startsWith(q))
    ?? null;
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

  for (const [key, raw] of Object.entries(skills)) {
    const label = raw?.label ?? key;
    if (key.toLowerCase() === requested || label.toLowerCase() === requested || label.toLowerCase().includes(requested)) {
      return typeof raw === 'number'
        ? { key, label, modifier: raw }
        : { key, label, modifier: Number(raw.modifier ?? raw.total ?? raw ?? 0) };
    }
  }
  return null;
}

function combatV2CheckEmbed(actor, result, thumbnail = null) {
  const lines = [`1d20 (${result.die}) ${fmt(result.stat)}`];
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

function combatV2SaveKey(saveType) {
  const key = String(saveType ?? '').toLowerCase();
  if (key.startsWith('fort')) return 'fort';
  if (key.startsWith('ref')) return 'ref';
  if (key.startsWith('will')) return 'will';
  return null;
}

function firstNumber(...values) {
  for (const value of values) {
    if (value == null || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function combatV2NormalizeMonsterSaves(core = {}, summary = {}, rich = null) {
  const summaryObj = summary.summary ?? summary ?? {};
  const richSaves = rich?.saves ?? rich?.defenses?.saves ?? {};
  const coreSaves = core.saves ?? {};
  return {
    fort: firstNumber(richSaves.fort, richSaves.fortitude, richSaves.Fortitude, coreSaves.fort, coreSaves.fortitude, core.fort, core.fortitude, summaryObj.fort, summaryObj.fortitude, summaryObj.Fortitude),
    ref: firstNumber(richSaves.ref, richSaves.reflex, richSaves.Reflex, coreSaves.ref, coreSaves.reflex, core.ref, core.reflex, summaryObj.ref, summaryObj.reflex, summaryObj.Reflex),
    will: firstNumber(richSaves.will, richSaves.Will, coreSaves.will, core.will, summaryObj.will, summaryObj.Will),
  };
}

function combatV2MonsterStats(monster, guildId) {
  const edits = guildId ? getMonsterEdit(guildId, monster.name) : null;
  const edited = applyMonsterEdits(monster, edits);
  const withLibrary = guildId ? applyMonsterAttackLibrary(edited, guildId) : edited;
  return {
    saves: combatV2NormalizeMonsterSaves(withLibrary.core ?? {}, withLibrary.summary ?? {}, withLibrary.rich ?? null),
  };
}

function combatV2SaveModifier(combatant, saveKey, guildId = null) {
  const direct = combatant?.saves?.[saveKey];
  if (direct != null) {
    const number = Number(direct);
    if (Number.isFinite(number)) return number;
  }
  const lookupName = combatant?.sourceKey ?? combatant?.bestiaryKey ?? combatant?.name;
  if (!lookupName) return null;
  try {
    const { monster } = findMonster(lookupName);
    if (!monster) return null;
    return combatV2MonsterStats(monster, guildId).saves?.[saveKey] ?? null;
  } catch {
    return null;
  }
}

function rollD20Plus(modifier) {
  const roll = Math.floor(Math.random() * 20) + 1;
  return { total: roll + modifier, roll, mod: modifier };
}

function determineDegreeOfSuccess(attackTotal, dieRoll, targetAc) {
  let degree = attackTotal >= targetAc + 10 ? 2 : attackTotal >= targetAc ? 1 : attackTotal <= targetAc - 10 ? -1 : 0;
  if (dieRoll === 20) degree += 1;
  if (dieRoll === 1) degree -= 1;
  return degree >= 2 ? 'crit-success' : degree === 1 ? 'success' : degree === 0 ? 'failure' : 'crit-failure';
}

function degreeText(degree) {
  return {
    'crit-success': 'Critical Success',
    success: 'Success',
    failure: 'Failure',
    'crit-failure': 'Critical Failure',
  }[degree] ?? degree;
}

function getLegacySaveModifier({ core, summary, rich, normalized }) {
  const saveMap = { fort: ['fort', 'fortitude'], ref: ['ref', 'reflex'], will: ['will'] };
  const richKey = { fort: 'Fortitude', ref: 'Reflex', will: 'Will' }[normalized];
  let modifier = null;
  for (const k of saveMap[normalized]) {
    if (core?.saves?.[k] != null) { modifier = core.saves[k]; break; }
    if (summary?.[k] != null) { modifier = summary[k]; break; }
  }
  if (modifier == null && rich?.defenses?.saves?.[richKey] != null) {
    modifier = rich.defenses.saves[richKey];
  }
  return modifier;
}

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const monsterInput = interaction.options.getString('monster');
  const dc = interaction.options.getInteger('dc');
  const wantPublic = interaction.options.getBoolean('public') ?? true;
  const guildId = interaction.guildId;
  const channelId = interaction.channel?.id;
  const v2Encounter = channelId ? combatV2State.getEncounter(channelId) : null;

  if (v2Encounter) {
    if (interaction.user.id !== v2Encounter.gmId) {
      return interaction.reply({ content: 'Only the GM can roll for monsters in active combat v2.', ephemeral: true });
    }
    const combatant = combatV2State.findCombatant(v2Encounter, monsterInput);
    if (!combatant) return interaction.reply({ content: `No combatant named **"${monsterInput}"** in combat v2.`, ephemeral: true });

    if (sub === 'save') {
      const saveKey = combatV2SaveKey(interaction.options.getString('save'));
      const saveLabels = { fort: 'Fortitude Save', ref: 'Reflex Save', will: 'Will Save' };
      const stat = combatV2SaveModifier(combatant, saveKey, interaction.guildId);
      if (stat == null) return interaction.reply({ content: `**${combatant.name}** does not have a ${saveLabels[saveKey] ?? 'save'} modifier recorded.`, ephemeral: true });
      const result = combatV2Rolls.rollCheck({ actor: combatant, stat: Number(stat), dc, label: saveLabels[saveKey], effectKind: 'save' });
      return interaction.reply({ embeds: [combatV2CheckEmbed(combatant, result)], ephemeral: !wantPublic });
    }

    if (sub === 'skill') {
      const skillName = interaction.options.getString('skill');
      const skill = combatV2FindSkill(combatant, skillName);
      if (!skill) {
        const available = Object.keys(combatant.skills ?? {}).slice(0, 20).join(', ') || 'none';
        return interaction.reply({ content: `No skill matching **"${skillName}"** found for **${combatant.name}**. Available: ${available}.`, ephemeral: true });
      }
      const result = combatV2Rolls.rollCheck({ actor: combatant, stat: skill.modifier, dc, label: `${skill.label} Check`, effectKind: 'skill' });
      return interaction.reply({ embeds: [combatV2CheckEmbed(combatant, result)], ephemeral: !wantPublic });
    }
  }

  // No v2 encounter in this channel → out-of-combat mode: roll straight from
  // the bestiary. (The legacy encounter store this used to consult is gone.)
  const combatant = null;

  const lookupName = combatant?.bestiaryKey ?? monsterInput;
  const { monster, matches } = findMonster(lookupName);
  if (!monster) {
    if (matches && matches.length > 1) {
      const preview = matches.slice(0, 5).map(n => `- **${n}**`).join('\n');
      return interaction.reply({ content: `Multiple matches for **"${monsterInput}"**:\n${preview}`, ephemeral: true });
    }
    return interaction.reply({ content: `No creature named **"${monsterInput}"** found in the bestiary or encounter.`, ephemeral: true });
  }

  const edits = guildId ? getMonsterEdit(guildId, monster.name) : null;
  const edited = applyMonsterEdits(monster, edits);
  const finalMonster = guildId ? applyMonsterAttackLibrary(edited, guildId) : edited;
  const rich = finalMonster.rich ?? null;
  const core = finalMonster.core ?? {};
  const summary = finalMonster.summary?.summary ?? {};

  if (sub === 'save') {
    const saveType = interaction.options.getString('save');
    const normalized = saveType.startsWith('fort') ? 'fort'
      : saveType.startsWith('ref') ? 'ref'
      : saveType.startsWith('will') ? 'will'
      : null;
    if (!normalized) return interaction.reply({ content: `Unknown save: ${saveType}`, ephemeral: true });

    const saveLabel = { fort: 'Fortitude', ref: 'Reflex', will: 'Will' }[normalized];
    const modifier = getLegacySaveModifier({ core, summary, rich, normalized });
    if (modifier == null) {
      return interaction.reply({ content: `**${monster.name}** has no ${saveLabel} save listed in the bestiary.`, ephemeral: true });
    }

    let effectBonus = 0;
    if (combatant) {
      const mods = sumEffectModifiers(combatant);
      effectBonus = mods.saveBonus ?? 0;
    }
    const totalModifier = Number(modifier) + effectBonus;
    const r = rollD20Plus(totalModifier);

    let breakdown = formatRollBreakdown(r.roll, totalModifier, 0, r.total, 20);
    if (effectBonus !== 0) {
      breakdown += `\n*base ${fmt(Number(modifier))}, effects ${fmt(effectBonus)}*`;
    }
    if (dc != null) {
      const degree = determineDegreeOfSuccess(r.total, r.roll, dc);
      breakdown += `\nvs DC ${dc}: **${degreeText(degree)}**`;
    }

    const art = guildId ? lookupMonsterArt(guildId, monster) : null;
    const embed = buildRollEmbed({
      title: `${monster.name} rolls a ${saveLabel} save!`,
      breakdown,
      charName: `${monster.name} - ${saveLabel} ${fmt(totalModifier)}`,
      thumbnail: art,
    });
    embed.setColor(0x8B0000);
    return interaction.reply({ embeds: [embed], ephemeral: !wantPublic });
  }

  if (sub === 'skill') {
    const skillInput = interaction.options.getString('skill').trim();
    const skillQuery = skillInput.toLowerCase();
    const isPerceptionRoll = ['perception', 'initiative', 'init'].includes(skillQuery);

    if (isPerceptionRoll) {
      const modifier = core.perception ?? summary.perception ?? rich?.perception ?? null;
      if (modifier == null) {
        return interaction.reply({ content: `**${monster.name}** has no Perception modifier listed in the bestiary.`, ephemeral: true });
      }

      let effectBonus = 0;
      if (combatant) {
        const mods = sumEffectModifiers(combatant);
        effectBonus = mods.perceptionBonus ?? mods.skillBonus ?? 0;
      }
      const totalModifier = Number(modifier) + effectBonus;
      const r = rollD20Plus(totalModifier);

      let breakdown = formatRollBreakdown(r.roll, totalModifier, 0, r.total, 20);
      if (effectBonus !== 0) {
        breakdown += `\n*base ${fmt(Number(modifier))}, effects ${fmt(effectBonus)}*`;
      }
      if (dc != null) {
        const degree = determineDegreeOfSuccess(r.total, r.roll, dc);
        breakdown += `\nvs DC ${dc}: **${degreeText(degree)}**`;
      }

      const art = guildId ? lookupMonsterArt(guildId, monster) : null;
      const label = skillQuery === 'perception' ? 'Perception' : 'Initiative';
      const embed = buildRollEmbed({
        title: `${monster.name} rolls ${label}!`,
        breakdown,
        charName: `${monster.name} - Perception ${fmt(totalModifier)}`,
        thumbnail: art,
      });
      embed.setColor(0x8B0000);
      return interaction.reply({ embeds: [embed], ephemeral: !wantPublic });
    }

    const skillsObj = rich?._skillTotals ?? rich?.skills ?? {};
    const skillKeys = Object.keys(skillsObj);
    if (skillKeys.length === 0) {
      return interaction.reply({ content: `**${monster.name}** has no skills listed in the bestiary.`, ephemeral: true });
    }
    const q = skillInput.toLowerCase();
    const exact = skillKeys.find(k => k.toLowerCase() === q);
    const partial = skillKeys.filter(k => k.toLowerCase().includes(q));
    let chosenKey = exact;
    if (!chosenKey && partial.length === 1) chosenKey = partial[0];
    if (!chosenKey) {
      if (partial.length > 1) {
        return interaction.reply({ content: `Multiple skills match "${skillInput}": ${partial.join(', ')}`, ephemeral: true });
      }
      return interaction.reply({ content: `**${monster.name}** has no **${skillInput}**. Available: ${skillKeys.join(', ')}`, ephemeral: true });
    }
    const modifier = Number(skillsObj[chosenKey]);

    let effectBonus = 0;
    if (combatant) {
      const mods = sumEffectModifiers(combatant);
      effectBonus = mods.skillBonus ?? 0;
    }
    const totalModifier = modifier + effectBonus;
    const r = rollD20Plus(totalModifier);

    let breakdown = formatRollBreakdown(r.roll, totalModifier, 0, r.total, 20);
    if (effectBonus !== 0) {
      breakdown += `\n*base ${fmt(modifier)}, effects ${fmt(effectBonus)}*`;
    }
    if (dc != null) {
      const degree = determineDegreeOfSuccess(r.total, r.roll, dc);
      breakdown += `\nvs DC ${dc}: **${degreeText(degree)}**`;
    }

    const art = guildId ? lookupMonsterArt(guildId, monster) : null;
    const embed = buildRollEmbed({
      title: `${monster.name} attempts ${chosenKey}!`,
      breakdown,
      charName: `${monster.name} - ${chosenKey} ${fmt(totalModifier)}`,
      thumbnail: art,
    });
    embed.setColor(0x8B0000);
    return interaction.reply({ embeds: [embed], ephemeral: !wantPublic });
  }

  return interaction.reply({ content: `Unknown subcommand: ${sub}`, ephemeral: true });
}

module.exports = {
  name: 'monsterroll',
  execute,
};
