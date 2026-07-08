const { EmbedBuilder } = require('discord.js');
const characterState = require('../../state/characters');
const charOverlay = require('../../rules/characterOverlay');
const combatV2State = require('../../rules/combatV2/state');
const combatV2Render = require('../../rules/combatV2/render');
const combatV2Rolls = require('../../rules/combatV2/rolls');
const { computeCharPerception } = require('../../rules/characterChecks');
const { fmt } = require('../../lib/format');
const { basicSaveDamage } = require('../../lib/dice');
const { resolveSpellDamage, rollCompoundExpression } = require('../../lib/spellDamage');
const {
  PATHWAY_DICE_BUFFER,
  PATHWAY_DICE_REF,
  rollFallbackFiles,
  combatDeathPayload,
  combatDyingSuffix,
} = require('../../discord/rollEmbeds');
const { buildCharHpEmbed } = require('../hp/embed');
const { findSpell, spellAmbiguityMessage } = require('../spell/lookup');
const { normalizeSpell } = require('../spell/embed');
const { updateCombatV2Summary } = require('../init/combatV2Summary');
const {
  combatV2SaveKey,
  combatV2SaveModifier,
  combatV2DegreeLabel,
  combatV2LegacyDegree,
  combatV2AttackListText,
  combatV2FindAttack,
} = require('../monster/combatV2Helpers');
const {
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
} = require('../init/combatV2Actors');

const { computeCharMaxHp, getCharacterHp, setCharacterHp, resolveChar } = characterState;

function loadCharacters() {
  return characterState.getAll();
}

async function saveCharacters(data) {
  await characterState.saveAll(data);
}

async function execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const channelId = interaction.channel.id;
    const userId = interaction.user.id;
    const encounter = combatV2State.getEncounter(channelId);

    if (sub === 'join') {
      if (!encounter) return interaction.reply({ content: 'No active combat v2 encounter here. Ask the GM to use `/init start`.', ephemeral: true });
      await interaction.deferReply();
      const characters = loadCharacters();
      const { error, char: charEntry } = resolveChar(userId, interaction.options.getString('character'), characters);
      if (error) return interaction.editReply(error);
      const c = charEntry.data;
      if (combatV2HasName(encounter, c.name)) return interaction.editReply(`**${c.name}** is already in combat.`);
      const maxHp = computeCharMaxHp(charEntry);
      const initMod = interaction.options.getInteger('bonus') ?? computeCharPerception(charEntry);
      const rolled = combatV2Initiative(initMod, interaction.options.getInteger('result'));
      const { combatant } = combatV2State.addCombatant(channelId, {
        name: c.name,
        type: 'pc',
        isNpc: false,
        hidden: false,
        initiative: rolled.initiative,
        hp: charEntry.hp ?? maxHp,
        maxHp,
        ac: c.acTotal?.acTotal ?? null,
        ownerId: userId,
        attacks: combatV2CharacterAttacks(charEntry),
        saves: {
          fort: combatV2CharacterSave(c, 'fortitude'),
          ref: combatV2CharacterSave(c, 'reflex'),
          will: combatV2CharacterSave(c, 'will'),
        },
        skills: combatV2CharacterSkills(charEntry),
      });
      let warning = '';
      try {
        await updateCombatV2Summary(interaction.channel, encounter);
      } catch (err) {
        console.error('combat v2 join summary update failed:', err);
        warning = '\n⚠️ Joined, but I could not update the pinned combat tracker. Check my channel permissions.';
      }
      return interaction.editReply(`**${combatant.name}** joined combat at **${combatant.initiative}** ${rolled.text}.${warning}`);
    }

    if (sub === 'attacks') {
      const actorName = interaction.options.getString('actor');
      const actor = encounter ? combatV2PickActor(encounter, userId, actorName) : null;
      if (actor) {
        if (userId !== encounter.gmId && actor.ownerId !== userId) return interaction.reply({ content: 'You can only list attacks for your own combatant.', ephemeral: true });
        const embed = new EmbedBuilder().setColor(0x8b0000).setTitle(`${actor.name}'s Attacks`).setDescription(combatV2AttackListText(actor));
        return interaction.reply({ embeds: [embed], ephemeral: actor.hidden && userId === encounter.gmId });
      }

      const characters = loadCharacters();
      const { error, char: charEntry } = resolveChar(userId, null, characters);
      if (error) return interaction.reply({ content: error, ephemeral: true });
      const pseudo = { name: charEntry.data.name, attacks: combatV2CharacterAttacks(charEntry) };
      const embed = new EmbedBuilder().setColor(0x8b0000).setTitle(`${pseudo.name}'s Attacks`).setDescription(combatV2AttackListText(pseudo));
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'reaction') {
      if (!encounter) return interaction.reply({ content: 'No active combat v2 encounter here.', ephemeral: true });
      const actorName = interaction.options.getString('actor');
      const reason = interaction.options.getString('reason') ?? 'reaction';
      const actor = combatV2PickActor(encounter, userId, actorName);
      if (!actor) return interaction.reply({ content: 'I could not find exactly one combatant you control. Use `actor:` to choose one.', ephemeral: true });
      if (userId !== encounter.gmId && actor.ownerId !== userId) {
        return interaction.reply({ content: 'You can only mark reactions for your own combatant.', ephemeral: true });
      }
      if (actor.hasReaction === false) return interaction.reply({ content: `**${actor.name}** does not have reactions enabled.`, ephemeral: true });
      if (actor.reactionUsed) return interaction.reply({ content: `**${actor.name}** has already used their reaction this round.`, ephemeral: true });
      actor.reactionUsed = true;
      encounter.updatedAt = new Date().toISOString();
      encounter.log.push({ at: encounter.updatedAt, kind: 'reaction', name: actor.name, reason });
      await updateCombatV2Summary(interaction.channel, encounter);
      return interaction.reply(`**${actor.name}** used their reaction: ${reason}.`);
    }

    if (sub === 'hp') {
      const actorName = interaction.options.getString('actor');
      const change = interaction.options.getInteger('change');
      const setValue = interaction.options.getInteger('set');
      if (change == null && setValue == null) return interaction.reply({ content: 'Use either `change:` or `set:`.', ephemeral: true });
      if (change != null && setValue != null) return interaction.reply({ content: 'Use only one of `change:` or `set:`.', ephemeral: true });

      const actor = encounter ? combatV2PickActor(encounter, userId, actorName) : null;
      if (actor) {
        if (userId !== encounter.gmId && actor.ownerId !== userId) {
          return interaction.reply({ content: 'You can only modify HP for your own combatant.', ephemeral: true });
        }
        const result = setValue != null
          ? combatV2State.applyHp(channelId, actor.name, setValue, { mode: 'set' })
          : combatV2State.applyHp(channelId, actor.name, change);
        await updateCombatV2Summary(interaction.channel, result.encounter);
        return interaction.reply({
          content: `**${result.combatant.name}** HP: ${result.before.hp}/${result.combatant.maxHp} -> **${result.combatant.hp}/${result.combatant.maxHp}**${result.combatant.tempHp ? ` (${result.combatant.tempHp} temp)` : ''}${combatDyingSuffix(result)}`,
          ...(combatDeathPayload(result) ?? {}),
        });
      }

      const characters = loadCharacters();
      const { error, charKey, char: charEntry } = resolveChar(userId, null, characters);
      if (error) return interaction.reply({ content: error, ephemeral: true });
      const oldHp = getCharacterHp(charEntry);
      const newHp = setCharacterHp(charEntry, setValue != null ? setValue : oldHp + change);
      characters[userId][charKey] = charEntry;
      await saveCharacters(characters);
      return interaction.reply({ embeds: [buildCharHpEmbed(charEntry.data, charEntry, `HP: ${oldHp} -> **${newHp}**.`)] });
    }

    if (sub === 'thp') {
      const amount = interaction.options.getInteger('amount');
      if (!encounter) return interaction.reply({ content: 'Temporary HP is currently tracked on combat v2 combatants. Start/join initiative first.', ephemeral: true });
      const actorName = interaction.options.getString('actor');
      const actor = combatV2PickActor(encounter, userId, actorName);
      if (!actor) return interaction.reply({ content: 'I could not find exactly one combatant you control. Use `actor:` to choose one.', ephemeral: true });
      if (userId !== encounter.gmId && actor.ownerId !== userId) {
        return interaction.reply({ content: 'You can only set temp HP for your own combatant.', ephemeral: true });
      }
      const result = combatV2State.setTempHp(channelId, actor.name, amount);
      await updateCombatV2Summary(interaction.channel, result.encounter);
      return interaction.reply(`**${result.combatant.name}** temp HP: ${result.before} -> **${result.combatant.tempHp}**.`);
    }

    if (sub === 'effect') {
      if (!encounter) return interaction.reply({ content: 'No active combat v2 encounter here.', ephemeral: true });
      const actorName = interaction.options.getString('actor');
      const actor = combatV2PickActor(encounter, userId, actorName);
      if (!actor) return interaction.reply({ content: 'I could not find exactly one combatant you control. Use `actor:` to choose one.', ephemeral: true });
      if (userId !== encounter.gmId && actor.ownerId !== userId) {
        return interaction.reply({ content: 'You can only view effects for your own combatant.', ephemeral: true });
      }
      const lines = (actor.effects ?? []).map(e => {
        const value = e.value != null ? ` ${e.value}` : '';
        const durationText = e.duration != null ? ` (${e.duration} rounds)` : '';
        const desc = e.modifiers?.description ? ` - ${e.modifiers.description}` : '';
        return `• **${e.name}${value}**${durationText}${desc}`;
      });
      const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle(`${actor.name}'s Effects`)
        .setDescription(lines.length ? lines.join('\n') : 'No active effects.');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'remove') {
      if (!encounter) return interaction.reply({ content: 'No active combat v2 encounter here.', ephemeral: true });
      const actorName = interaction.options.getString('actor');
      const actor = combatV2PickActor(encounter, userId, actorName);
      if (!actor) return interaction.reply({ content: 'I could not find exactly one combatant you control. Use `actor:` to choose one.', ephemeral: true });
      if (userId !== encounter.gmId && actor.ownerId !== userId) {
        return interaction.reply({ content: 'You can only remove your own combatant.', ephemeral: true });
      }
      const result = combatV2State.removeCombatant(channelId, actor.name);
      await updateCombatV2Summary(interaction.channel, result.encounter);
      return interaction.reply(`Removed **${result.combatant.name}** from combat.`);
    }

    if (sub === 'attack') {
      const attackName = interaction.options.getString('name');
      const targetName = interaction.options.getString('target');
      const count = interaction.options.getInteger('n') ?? 1;
      const bonus = interaction.options.getInteger('bonus') ?? 0;
      const mapOverride = interaction.options.getInteger('map');

      let actor = encounter ? combatV2PickActor(encounter, userId, null) : null;
      let target = encounter ? combatV2PickTarget(encounter, actor, targetName) : null;
      const inCombat = !!actor;
      let thumbnail = null;

      if (actor && userId !== encounter.gmId && actor.ownerId !== userId) {
        return interaction.reply({ content: 'It is not your combatant. Use `/init view` to check the tracker.', ephemeral: true });
      }

      // Resolve the attacker's portrait. For an in-encounter combatant, walk
      // the owner's characters/companions to find the matching entry. For an
      // ad-hoc actor (no active encounter), the charEntry we just loaded has
      // it directly.
      if (actor) {
        const characters = loadCharacters();
        const match = findCharacterEntryForCombatant(characters, actor);
        thumbnail = match?.companion?.art ?? match?.char?.art ?? null;
      }

      if (!actor) {
        const characters = loadCharacters();
        const { error, char: charEntry } = resolveChar(userId, null, characters);
        if (error) return interaction.reply({ content: error, ephemeral: true });
        thumbnail = charEntry.art ?? null;
        actor = {
          id: `char-${userId}`,
          name: charEntry.data.name,
          ownerId: userId,
          isNpc: false,
          hp: charEntry.hp ?? computeCharMaxHp(charEntry),
          maxHp: computeCharMaxHp(charEntry),
          ac: charEntry.data.acTotal?.acTotal ?? null,
          attacks: combatV2CharacterAttacks(charEntry),
          saves: {
            fort: combatV2CharacterSave(charEntry.data, 'fortitude'),
            ref: combatV2CharacterSave(charEntry.data, 'reflex'),
            will: combatV2CharacterSave(charEntry.data, 'will'),
          },
          skills: combatV2CharacterSkills(charEntry),
          effects: [],
          attacksThisTurn: 0,
        };
        target = null;
      }

      const attack = combatV2FindAttack(actor, attackName);
      if (!attack) return interaction.reply({ content: `No attack ${attackName ? `matching **"${attackName}" ` : ''}found for **${actor.name}**.\n${combatV2AttackListText(actor)}`, ephemeral: true });
      if (targetName && !target) return interaction.reply({ content: `No target named **"${targetName}"** in combat.`, ephemeral: true });

      const results = combatV2Rolls.rollAttack({ attacker: actor, target, attack, bonus, map: mapOverride, count });
      const embeds = [];
      const hpLines = [];
      const deathEmbeds = [];
      for (const result of results) {
        const embed = combatV2Render.renderAttackResult(result).setTitle(`${actor.name} attacks with ${attack.name}`);
        if (thumbnail) embed.setThumbnail(thumbnail);
        else if (PATHWAY_DICE_BUFFER) embed.setThumbnail(PATHWAY_DICE_REF);
        embeds.push(embed);
        if (inCombat && target && ['success', 'criticalSuccess'].includes(result.degree) && result.finalDamage > 0) {
          const beforeHp = target.hp;
          const applied = combatV2State.applyHp(channelId, target.name, -result.finalDamage, { isCrit: result.degree === 'criticalSuccess' });
          hpLines.push(`**${target.name}** took **${result.finalDamage}** damage: ${beforeHp}/${target.maxHp} -> ${applied.combatant.hp}/${applied.combatant.maxHp} HP${combatDyingSuffix(applied)}`);
          const deathPayload = combatDeathPayload(applied);
          if (deathPayload?.embeds?.length) deathEmbeds.push(...deathPayload.embeds);
          if (applied.died) break;
        }
      }
      if (inCombat && mapOverride === null) actor.attacksThisTurn = (actor.attacksThisTurn ?? 0) + count;
      if (inCombat) await updateCombatV2Summary(interaction.channel, encounter);
      return interaction.reply({
        content: hpLines.length ? hpLines.join('\n') : undefined,
        embeds: embeds.concat(deathEmbeds).slice(0, 10),
        files: rollFallbackFiles(thumbnail),
      });
    }

    if (sub === 'save') {
      const saveKey = interaction.options.getString('name');
      const dc = interaction.options.getInteger('dc');
      const bonus = interaction.options.getInteger('bonus') ?? 0;
      let actor = encounter ? combatV2PickActor(encounter, userId, null) : null;
      let thumbnail = null;

      if (actor && userId !== encounter.gmId && actor.ownerId !== userId) {
        return interaction.reply({ content: 'It is not your combatant. Use `/init view` to check the tracker.', ephemeral: true });
      }

      if (!actor) {
        const characters = loadCharacters();
        const { error, char: charEntry } = resolveChar(userId, null, characters);
        if (error) return interaction.reply({ content: error, ephemeral: true });
        thumbnail = charEntry.art ?? null;
        actor = {
          name: charEntry.data.name,
          ownerId: userId,
          saves: {
            fort: combatV2CharacterSave(charEntry.data, 'fortitude'),
            ref: combatV2CharacterSave(charEntry.data, 'reflex'),
            will: combatV2CharacterSave(charEntry.data, 'will'),
          },
          effects: [],
        };
      }

      const saveLabels = { fort: 'Fortitude Save', ref: 'Reflex Save', will: 'Will Save' };
      const stat = combatV2SaveModifier(actor, saveKey, interaction.guildId);
      if (stat == null) return interaction.reply({ content: `**${actor.name}** does not have a ${saveLabels[saveKey] ?? saveKey} modifier recorded.`, ephemeral: true });
      const result = combatV2Rolls.rollCheck({ actor, stat: Number(stat), dc, bonus, label: saveLabels[saveKey] ?? 'Save', effectKind: 'save' });
      return interaction.reply({ embeds: [combatV2CheckEmbed(actor, result, thumbnail)], files: rollFallbackFiles(thumbnail) });
    }

    if (sub === 'skill') {
      const skillName = interaction.options.getString('name');
      const dc = interaction.options.getInteger('dc');
      const bonus = interaction.options.getInteger('bonus') ?? 0;
      let actor = encounter ? combatV2PickActor(encounter, userId, null) : null;
      let thumbnail = null;

      if (actor && userId !== encounter.gmId && actor.ownerId !== userId) {
        return interaction.reply({ content: 'It is not your combatant. Use `/init view` to check the tracker.', ephemeral: true });
      }

      if (!actor) {
        const characters = loadCharacters();
        const { error, char: charEntry } = resolveChar(userId, null, characters);
        if (error) return interaction.reply({ content: error, ephemeral: true });
        thumbnail = charEntry.art ?? null;
        actor = {
          name: charEntry.data.name,
          ownerId: userId,
          skills: combatV2CharacterSkills(charEntry),
          effects: [],
        };
      }

      const skill = combatV2FindSkill(actor, skillName);
      if (!skill) {
        const available = Object.keys(actor.skills ?? {}).slice(0, 20).join(', ') || 'none';
        return interaction.reply({ content: `No skill matching **"${skillName}"** found for **${actor.name}**. Available: ${available}.`, ephemeral: true });
      }
      const result = combatV2Rolls.rollCheck({ actor, stat: skill.modifier, dc, bonus, label: `${skill.label} Check`, effectKind: 'skill' });
      return interaction.reply({ embeds: [combatV2CheckEmbed(actor, result, thumbnail)], files: rollFallbackFiles(thumbnail) });
    }

    if (sub === 'cast') {
      await interaction.deferReply();
      const spellName = interaction.options.getString('spell');
      const castLevel = interaction.options.getInteger('level');
      const targetName = interaction.options.getString('target');
      const casterName = interaction.options.getString('caster');
      const bonus = interaction.options.getInteger('bonus') ?? 0;

      const characters = loadCharacters();
      const { error, char: charEntry } = resolveChar(userId, null, characters);
      if (error) return interaction.editReply(error);

      const rawSpell = findSpell(spellName);
      if (rawSpell?.ambiguous) return interaction.editReply(spellAmbiguityMessage(rawSpell));
      if (!rawSpell) return interaction.editReply(`Couldn't find a spell called **${spellName}**.`);
      const spell = normalizeSpell(rawSpell);
      charOverlay.ensureOverlay(charEntry);
      const casterStats = combatV2CasterStats(charEntry, spell, casterName);
      if (!casterStats.caster) return interaction.editReply(`**${charEntry.data.name}** does not have a spellcaster entry configured.`);

      let actor = encounter ? combatV2PickActor(encounter, userId, null) : null;
      let target = encounter ? combatV2PickTarget(encounter, actor, targetName) : null;
      const inCombat = !!actor;
      if (actor && userId !== encounter.gmId && actor.ownerId !== userId) {
        return interaction.editReply('It is not your combatant. Use `/init view` to check the tracker.');
      }
      if (!actor) {
        actor = {
          name: charEntry.data.name,
          ownerId: userId,
          effects: [],
        };
        target = null;
      }
      if (targetName && !target) return interaction.editReply(`No target named **"${targetName}"** in combat.`);

      const effectiveLevel = castLevel ?? spell.level ?? 1;
      const isCantrip = spell.type === 'Cantrip';
      const consumesSlot = !isCantrip && effectiveLevel > 0;
      const warnings = [];
      if (consumesSlot) {
        const slots = charOverlay.getSlotsRemaining(charEntry, casterStats.caster.name, effectiveLevel);
        if (slots && slots.max > 0 && slots.current <= 0) {
          warnings.push(`${casterStats.caster.name} has no rank ${effectiveLevel} slots remaining. Casting anyway.`);
        } else if (slots && slots.max === 0) {
          warnings.push(`${casterStats.caster.name} has no rank ${effectiveLevel} slots. Casting anyway.`);
        }
        charOverlay.spendSlot(charEntry, casterStats.caster.name, effectiveLevel);
        await saveCharacters(characters);
      }

      const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle(`${actor.name} casts ${spell.name}`);
      if (charEntry.art) embed.setThumbnail(charEntry.art);

      const lines = [];
      lines.push(`*${isCantrip ? `Cantrip ${effectiveLevel}` : `Rank ${effectiveLevel}`} ${casterStats.tradition} spell*`);
      if (spell.cast) lines.push(`**Cast** ${spell.cast}`);
      if (spell.range) lines.push(`**Range** ${spell.range}`);
      if (spell.area) lines.push(`**Area** ${spell.area}`);
      if (spell.target) lines.push(`**Target** ${spell.target}`);
      lines.push(`**Duration** ${spell.duration || 'Instantaneous'}`);
      if (target) lines.push(`**Combat Target** ${target.name}`);
      lines.push('');

      const resolved = resolveSpellDamage(spell, effectiveLevel);
      const damageRoll = resolved?.diceExpr ? rollCompoundExpression(resolved.diceExpr) : null;
      const damageType = resolved?.damageType ?? spell.damageType ?? null;
      let appliedLine = null;

      if (spell.isAttackSpell) {
        const targetEffects = combatV2Rolls.effectTotals(target);
        const dc = target?.ac != null ? target.ac + targetEffects.ac : null;
        const result = combatV2Rolls.rollCheck({
          actor,
          stat: casterStats.attack,
          dc,
          bonus,
          label: 'Spell Attack',
          effectKind: 'attack',
        });
        lines.push(`**Spell Attack**`);
        lines.push(`1d20 (${result.die}) ${fmt(casterStats.attack)}${result.effectBonus ? ` ${fmt(result.effectBonus)} effects` : ''}${bonus ? ` ${fmt(bonus)} bonus` : ''} = **${result.total}**`);
        if (target && dc != null) lines.push(`vs AC ${dc}: **${combatV2DegreeLabel(result.degree)}**`);
        if (damageRoll) {
          if (['success', 'criticalSuccess'].includes(result.degree)) {
            const baseDamage = result.degree === 'criticalSuccess' ? damageRoll.total * 2 : damageRoll.total;
            const defended = target ? combatV2Rolls.applyDefenses(baseDamage, damageType, target) : { finalDamage: baseDamage, notes: [] };
            lines.push(`**Damage${result.degree === 'criticalSuccess' ? ' (crit x2)' : ''}** ${damageRoll.display} = **${defended.finalDamage}**${damageType ? ` ${damageType}` : ''}`);
            if (defended.notes.length) lines.push(`*${defended.notes.join(', ')}*`);
            if (inCombat && target && defended.finalDamage > 0) {
              const beforeHp = target.hp;
              const applied = combatV2State.applyHp(channelId, target.name, -defended.finalDamage, { isCrit: result.degree === 'criticalSuccess' });
              appliedLine = `**${target.name}** took **${defended.finalDamage}** damage: ${beforeHp}/${target.maxHp} -> ${applied.combatant.hp}/${applied.combatant.maxHp} HP`;
            }
          } else {
            lines.push('*No damage.*');
          }
        }
      } else if (spell.savingThrow) {
        const saveKey = combatV2SaveKey(spell.savingThrow);
        lines.push(`**${spell.saveIsBasic ? 'Basic ' : ''}${spell.savingThrow} Save DC ${casterStats.dc}**`);
        const targetSave = target && saveKey ? combatV2SaveModifier(target, saveKey, interaction.guildId) : null;
        if (target && saveKey && targetSave != null) {
          const result = combatV2Rolls.rollCheck({
            actor: target,
            stat: targetSave,
            dc: casterStats.dc,
            bonus: 0,
            label: `${spell.savingThrow} Save`,
            effectKind: 'save',
          });
          lines.push(`${target.name}: 1d20 (${result.die}) ${fmt(result.stat)}${result.effectBonus ? ` ${fmt(result.effectBonus)} effects` : ''} = **${result.total}**`);
          lines.push(`**${combatV2DegreeLabel(result.degree)}**`);
          if (damageRoll) {
            const fullDamage = spell.saveIsBasic ? basicSaveDamage(damageRoll.total, combatV2LegacyDegree(result.degree)) : damageRoll.total;
            const defended = target ? combatV2Rolls.applyDefenses(fullDamage, damageType, target) : { finalDamage: fullDamage, notes: [] };
            lines.push(`**Damage** ${damageRoll.display} -> **${defended.finalDamage}**${damageType ? ` ${damageType}` : ''}`);
            if (defended.notes.length) lines.push(`*${defended.notes.join(', ')}*`);
            if (inCombat && target && defended.finalDamage > 0 && (spell.saveIsBasic || result.degree === 'failure' || result.degree === 'criticalFailure')) {
              const beforeHp = target.hp;
              const applied = combatV2State.applyHp(channelId, target.name, -defended.finalDamage, { isCrit: result.degree === 'criticalFailure' });
              appliedLine = `**${target.name}** took **${defended.finalDamage}** damage: ${beforeHp}/${target.maxHp} -> ${applied.combatant.hp}/${applied.combatant.maxHp} HP`;
            }
          }
        } else if (target) {
          lines.push(`${target.name}'s save bonus is not recorded.`);
          if (damageRoll) {
            lines.push(`Damage if applicable: ${damageRoll.display} = **${damageRoll.total}**${damageType ? ` ${damageType}` : ''}`);
            if (spell.saveIsBasic) {
              lines.push(`*Basic save: crit-success 0 · success ${Math.floor(damageRoll.total / 2)} · failure ${damageRoll.total} · crit-fail ${damageRoll.total * 2}*`);
            } else {
              lines.push('*Non-basic save — see spell text for effect per degree.*');
            }
          }
        } else if (damageRoll) {
          lines.push(`Damage if applicable: ${damageRoll.display} = **${damageRoll.total}**${damageType ? ` ${damageType}` : ''}`);
        }
      } else if (damageRoll) {
        lines.push(`**Damage** ${damageRoll.display} = **${damageRoll.total}**${damageType ? ` ${damageType}` : ''}`);
      }

      if (resolved?.heightenedNote) lines.push(`*Heightened: ${resolved.heightenedNote}*`);
      const shortDesc = spell.description ?? '';
      if (shortDesc && shortDesc !== '*No description available.*') {
        lines.push('');
        lines.push(shortDesc.length > 300 ? `${shortDesc.slice(0, 300)}...\n*Use \`/spell ${spell.name}\` for full details.*` : shortDesc);
      }
      embed.setDescription(lines.join('\n').slice(0, 4096));
      let footer = `${charEntry.data.name} · Spell Attack ${fmt(casterStats.attack)} · DC ${casterStats.dc}`;
      if (consumesSlot) {
        const slotsNow = charOverlay.getSlotsRemaining(charEntry, casterStats.caster.name, effectiveLevel);
        if (slotsNow?.max > 0) footer += ` · Rank ${effectiveLevel} slots: ${slotsNow.current}/${slotsNow.max}`;
      }
      embed.setFooter({ text: footer });

      if (inCombat) await updateCombatV2Summary(interaction.channel, encounter);
      const content = [warnings.join('\n'), appliedLine].filter(Boolean).join('\n') || undefined;
      return interaction.editReply({ content, embeds: [embed] });
    }

    return interaction.reply({ content: `Unknown /i action: ${sub}`, ephemeral: true });
}

module.exports = {
  name: 'i',
  execute,
};
