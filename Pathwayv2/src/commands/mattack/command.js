const { EmbedBuilder } = require('discord.js');

const monsterState = require('../../state/monster');
const combatV2State = require('../../rules/combatV2/state');
const combatV2Rolls = require('../../rules/combatV2/rolls');
const combatV2Render = require('../../rules/combatV2/render');
const ca = require('../../rules/combatAutomation');
const { sumEffectModifiers } = require('../../rules/combatEffects');
const { fmt } = require('../../lib/format');
const { rollDamageExpression, determineDegreeOfSuccess, calculateMap } = require('../../lib/dice');
const { PATHWAY_DICE_REF, PATHWAY_DICE_BUFFER, rollFallbackFiles, combatDeathPayload, combatDyingSuffix } = require('../../discord/rollEmbeds');
const { getEncounter } = require('../encounters');
const { updateSummary } = require('../init/legacySummary');
const { updateCombatV2Summary } = require('../init/combatV2Summary');
const { findMonster } = require('../monster/lookup');
const { monsterKey, lookupMonsterArt, getMonsterEdit, applyMonsterEdits, applyMonsterAttackLibrary } = require('../monster/helpers');
const { combatV2FindAttack, combatV2AttackListText } = require('../monster/combatV2Helpers');
const { normalizeAttackForRolling } = require('../monsterattack/command');

function loadMonsterAttacks() {
  return monsterState.getAllAttacks();
}

function getGuildMonsters(store, guildId) {
  if (!store[guildId]) store[guildId] = {};
  return store[guildId];
}

function resolveMonsterDisplayName(inputName) {
  try {
    const hit = findMonster(inputName);
    if (hit.monster) return hit.monster.name;
  } catch {}
  return inputName;
}

function formatEffectContributions(effects, kind) {
  const contributions = effects
    .filter(e => {
      if (kind === 'attack') return e.attackBonus !== 0;
      if (kind === 'damage') return e.damageBonus !== 0;
      if (kind === 'ac') return e.acBonus !== 0;
      return false;
    })
    .map(e => {
      const val = kind === 'attack' ? e.attackBonus : kind === 'damage' ? e.damageBonus : e.acBonus;
      return `${e.name} ${fmt(val)}`;
    });
  return contributions.length > 0 ? ` (${contributions.join(', ')})` : '';
}

async function execute(interaction) {
    const channelId = interaction.channel.id;
    const userId = interaction.user.id;
    const v2Encounter = combatV2State.getEncounter(channelId);
    if (v2Encounter) {
      if (userId !== v2Encounter.gmId) return interaction.reply({ content: 'Only the GM can use `/mattack` in combat v2.', ephemeral: true });
      const attackerName = interaction.options.getString('attacker');
      const attackName = interaction.options.getString('name');
      const targetName = interaction.options.getString('target');
      const manualBonus = interaction.options.getInteger('bonus');
      const manualDamage = interaction.options.getString('damage');
      const manualType = interaction.options.getString('type');
      const mapOverride = interaction.options.getInteger('map');
      const agile = interaction.options.getBoolean('agile') ?? false;

      const attacker = combatV2State.findCombatant(v2Encounter, attackerName);
      if (!attacker) return interaction.reply({ content: `No combatant named **"${attackerName}"** in combat.`, ephemeral: true });
      const target = combatV2State.findCombatant(v2Encounter, targetName);
      if (!target) return interaction.reply({ content: `No combatant named **"${targetName}"** in combat.`, ephemeral: true });

      let attack = combatV2FindAttack(attacker, attackName);
      if (!attack && manualBonus == null && !manualDamage) {
        return interaction.reply({ content: `No saved attack matching **"${attackName}"** found for **${attacker.name}**. Add manual \`bonus\` and \`damage\`, or use one of:\n${combatV2AttackListText(attacker)}`, ephemeral: true });
      }
      if (!attack) {
        attack = {
          name: attackName,
          bonus: manualBonus ?? 0,
          damage: manualDamage ?? '1d4',
          damageType: manualType ?? 'damage',
          traits: agile ? ['agile'] : [],
          source: 'manual',
        };
      } else {
        attack = {
          ...attack,
          bonus: manualBonus ?? attack.bonus,
          damage: manualDamage ?? attack.damage,
          damageType: manualType ?? attack.damageType,
          traits: agile && !(attack.traits ?? []).some(t => String(t).toLowerCase() === 'agile')
            ? [...(attack.traits ?? []), 'agile']
            : (attack.traits ?? []),
        };
      }

      const [result] = combatV2Rolls.rollAttack({ attacker, target, attack, map: mapOverride, count: 1 });
      const embed = combatV2Render.renderAttackResult(result).setTitle(`${attacker.name} attacks with ${attack.name}`);
      // Monster art lookup — guild-specific override first, then bestiary fallback.
      const thumbnail = lookupMonsterArt(interaction.guildId, attacker.name);
      if (thumbnail) embed.setThumbnail(thumbnail);
      else if (PATHWAY_DICE_BUFFER) embed.setThumbnail(PATHWAY_DICE_REF);
      let content;
      let embedDeath = [];
      if (['success', 'criticalSuccess'].includes(result.degree) && result.finalDamage > 0) {
        const beforeHp = target.hp;
        const applied = combatV2State.applyHp(channelId, target.name, -result.finalDamage);
        content = `**${target.name}** took **${result.finalDamage}** damage: ${beforeHp}/${target.maxHp} -> ${applied.combatant.hp}/${applied.combatant.maxHp} HP${combatDyingSuffix(applied)}`;
        const deathPayload = combatDeathPayload(applied);
        if (deathPayload?.embeds?.length) embedDeath = deathPayload.embeds;
      }
      if (mapOverride === null) attacker.attacksThisTurn = (attacker.attacksThisTurn ?? 0) + 1;
      await interaction.reply({ content, embeds: [embed, ...(embedDeath ?? [])].slice(0, 10), files: rollFallbackFiles(thumbnail) });
      await updateCombatV2Summary(interaction.channel, v2Encounter);
      return;
    }

    const outOfCombatAttackerName = interaction.options.getString('attacker');
    const outOfCombatAttackName = interaction.options.getString('name');
    const outOfCombatTargetName = interaction.options.getString('target');
    const outOfCombatBonus = interaction.options.getInteger('bonus');
    const outOfCombatDamage = interaction.options.getString('damage');
    const outOfCombatType = interaction.options.getString('type') ?? 'damage';
    const outOfCombatMap = interaction.options.getInteger('map');
    const outOfCombatAgile = interaction.options.getBoolean('agile') ?? false;

    let outOfCombatAttack = null;
    let outOfCombatDisplayName = outOfCombatAttackerName;

    if (outOfCombatBonus != null && outOfCombatDamage) {
      outOfCombatAttack = {
        name: outOfCombatAttackName,
        bonus: outOfCombatBonus,
        damage: outOfCombatDamage,
        damageType: outOfCombatType,
        traits: outOfCombatAgile ? ['agile'] : [],
        source: 'manual',
      };
    } else {
      const displayName = resolveMonsterDisplayName(outOfCombatAttackerName);
      const { monster } = findMonster(displayName);
      let bestiaryAttacks = [];
      if (monster) {
        outOfCombatDisplayName = monster.name;
        const edits = getMonsterEdit(interaction.guildId, monster.name);
        const edited = applyMonsterEdits(monster, edits);
        const withLibrary = applyMonsterAttackLibrary(edited, interaction.guildId);
        const rawAttacks = Array.isArray(withLibrary?.rich?.attacks) ? withLibrary.rich.attacks : [];
        bestiaryAttacks = rawAttacks.map(a => normalizeAttackForRolling(a));
      }

      const store = loadMonsterAttacks();
      const guild = getGuildMonsters(store, interaction.guildId);
      const libEntry = guild[monsterKey(outOfCombatDisplayName)] ?? guild[monsterKey(displayName)];
      const libAttacks = libEntry?.attacks ?? [];
      const allAttacks = bestiaryAttacks.length > 0 ? bestiaryAttacks : libAttacks;
      const q = String(outOfCombatAttackName ?? '').toLowerCase().trim();
      outOfCombatAttack = allAttacks.find(a => String(a.name ?? '').toLowerCase() === q) ?? null;
      if (!outOfCombatAttack) {
        const partial = allAttacks.filter(a => String(a.name ?? '').toLowerCase().includes(q));
        if (partial.length === 1) outOfCombatAttack = partial[0];
        else if (partial.length > 1) {
          return interaction.reply({
            content: `🔍 Multiple attacks match **"${outOfCombatAttackName}"** on **${outOfCombatDisplayName}**: ${partial.map(a => `\`${a.name}\``).join(', ')}. Be more specific.`,
            ephemeral: true,
          });
        }
      }
      if (!outOfCombatAttack) {
        const available = allAttacks.length ? allAttacks.map(a => `\`${a.name}\``).join(', ') : 'none';
        return interaction.reply({
          content: `❌ **${outOfCombatDisplayName}** has no attack matching **"${outOfCombatAttackName}"**.\nAvailable: ${available}\n\nYou can also roll manually with \`bonus:\` and \`damage:\`.`,
          ephemeral: true,
        });
      }
      outOfCombatAttack = {
        ...outOfCombatAttack,
        bonus: outOfCombatBonus ?? outOfCombatAttack.bonus ?? 0,
        damage: outOfCombatDamage ?? outOfCombatAttack.damage,
        damageType: outOfCombatType !== 'damage' ? outOfCombatType : (outOfCombatAttack.damageType ?? outOfCombatType),
        traits: outOfCombatAgile && !(outOfCombatAttack.traits ?? []).some(t => String(t).toLowerCase() === 'agile')
          ? [...(outOfCombatAttack.traits ?? []), 'agile']
          : (outOfCombatAttack.traits ?? []),
      };
    }

    if (outOfCombatAttack.kind === 'save') {
      const damageResult = rollDamageExpression(outOfCombatAttack.damage);
      if (!damageResult) return interaction.reply({ content: `❌ Couldn't parse damage expression **"${outOfCombatAttack.damage}"**.`, ephemeral: true });
      const saveDisplay = String(outOfCombatAttack.saveType ?? 'save');
      const embed = new EmbedBuilder()
        .setColor(0xD35400)
        .setTitle(`${outOfCombatDisplayName} uses ${outOfCombatAttack.name}${outOfCombatTargetName ? ` on ${outOfCombatTargetName}` : ''}!`)
        .setDescription(
          `**${saveDisplay.charAt(0).toUpperCase() + saveDisplay.slice(1)} Save DC ${outOfCombatAttack.saveDC}**\n\n` +
          `**Damage Rolled:** ${damageResult.display} = **${damageResult.total} ${outOfCombatAttack.damageType ?? ''}**\n\n` +
          `• Crit Success → **0** damage\n` +
          `• Success → **${Math.floor(damageResult.total / 2)}** damage\n` +
          `• Failure → **${damageResult.total}** damage\n` +
          `• Crit Failure → **${damageResult.total * 2}** damage`
        )
        .setFooter({ text: `${outOfCombatDisplayName} · out of initiative` });
      return interaction.reply({ embeds: [embed] });
    }

    if (!outOfCombatAttack.damage) {
      return interaction.reply({
        content: `❌ **${outOfCombatAttack.name}** on **${outOfCombatDisplayName}** does not have rollable damage. Use manual \`damage:\` to override it.`,
        ephemeral: true,
      });
    }

    const [outOfCombatResult] = combatV2Rolls.rollAttack({
      attacker: { name: outOfCombatDisplayName, attacksThisTurn: 0, effects: [] },
      target: null,
      attack: outOfCombatAttack,
      map: outOfCombatMap,
      count: 1,
    });
    const outOfCombatEmbed = combatV2Render.renderAttackResult(outOfCombatResult)
      .setTitle(`${outOfCombatDisplayName} attacks${outOfCombatTargetName ? ` ${outOfCombatTargetName}` : ''} with ${outOfCombatAttack.name}`)
      .setFooter({ text: `${outOfCombatDisplayName} · out of initiative${outOfCombatAttack.traits?.length ? ` · ${outOfCombatAttack.traits.join(', ')}` : ''}` });
    const outOfCombatThumb = lookupMonsterArt(interaction.guildId, outOfCombatDisplayName);
    if (outOfCombatThumb) outOfCombatEmbed.setThumbnail(outOfCombatThumb);
    else if (PATHWAY_DICE_BUFFER) outOfCombatEmbed.setThumbnail(PATHWAY_DICE_REF);
    return interaction.reply({ embeds: [outOfCombatEmbed], files: rollFallbackFiles(outOfCombatThumb) });

    const enc = getEncounter(channelId);
    if (userId !== enc.gmId) return interaction.reply({ content: '❌ Only the GM can use `/mattack`.', ephemeral: true });

    const attackerName = interaction.options.getString('attacker');
    const attackName = interaction.options.getString('name');
    const attackBonus = interaction.options.getInteger('bonus');
    const damageExpr = interaction.options.getString('damage');
    const targetName = interaction.options.getString('target');
    const damageType = (interaction.options.getString('type') ?? 'damage').toLowerCase();
    const explicitMap = interaction.options.getInteger('map'); // null if unset
    const agile = interaction.options.getBoolean('agile') ?? false;

    if (attackBonus == null || !damageExpr) {
      return interaction.reply({ content: 'Legacy `/mattack` needs both `bonus` and `damage`. In combat v2 those are optional when using a saved attack.', ephemeral: true });
    }

    const attacker = enc.combatants.find(x => x.name.toLowerCase() === attackerName.toLowerCase());
    if (!attacker) return interaction.reply({ content: `❌ No combatant named "${attackerName}" in this encounter.`, ephemeral: true });

    const target = enc.combatants.find(x => x.name.toLowerCase() === targetName.toLowerCase());
    if (!target) return interaction.reply({ content: `❌ No combatant named "${targetName}" in this encounter.`, ephemeral: true });

    const damageResult = rollDamageExpression(damageExpr);
    if (!damageResult) return interaction.reply({ content: `❌ Couldn't parse damage expression "${damageExpr}". Use something like \`1d6+2\` or \`2d8\`.`, ephemeral: true });

    const attackerMods = sumEffectModifiers(attacker);
    const targetMods = sumEffectModifiers(target);

    // Auto-MAP if not explicitly provided
    let mapPenalty, mapNoteText;
    if (explicitMap !== null) {
      mapPenalty = calculateMap(explicitMap, agile);
      mapNoteText = explicitMap > 0 ? `MAP ${mapPenalty} (manual)` : null;
    } else {
      const mapInfo = ca.computeMapForNextAttack(attacker, agile);
      mapPenalty = mapInfo.penalty;
      mapNoteText = mapInfo.noteText;
    }
    const dieRoll = Math.floor(Math.random() * 20) + 1;
    const attackTotal = dieRoll + attackBonus + mapPenalty + attackerMods.attackBonus;

    const baseTargetAc = target.ac ?? null;
    const effectiveTargetAc = baseTargetAc !== null ? baseTargetAc + targetMods.acBonus : null;
    const degree = effectiveTargetAc !== null
      ? determineDegreeOfSuccess(attackTotal, dieRoll, effectiveTargetAc)
      : null;

    // Build attack line
    const mapText = mapPenalty !== 0 ? ` ${mapPenalty}` : '';
    const attackerEffectText = formatEffectContributions(attackerMods.activeEffects, 'attack');
    let attackLine = `**Attack Roll**\n1d20 (${dieRoll}) ${fmt(attackBonus)}${mapText}${attackerEffectText ? ` ${fmt(attackerMods.attackBonus)}` : ''} = **${attackTotal}**`;
    if (mapNoteText) attackLine += `\n*${mapNoteText}*`;
    if (attackerEffectText) attackLine += `\n*${attackerEffectText.trim().slice(1, -1)}*`;
    if (dieRoll === 20) attackLine += '\n⭐ Natural 20!';
    if (dieRoll === 1)  attackLine += '\n💀 Natural 1!';

    // Damage
    const totalDamageBonus = attackerMods.damageBonus;
    let finalDamage = Math.max(1, damageResult.total + totalDamageBonus);
    const damageContribText = formatEffectContributions(attackerMods.activeEffects, 'damage');
    let damageLine;
    if (degree === 'crit-success') {
      finalDamage = finalDamage * 2;
      damageLine = `**Damage (CRIT × 2)**\n${damageResult.display}${totalDamageBonus ? ` ${fmt(totalDamageBonus)}` : ''} = ${damageResult.total + totalDamageBonus} × 2 = **${finalDamage} ${damageType}**`;
    } else {
      damageLine = `**Damage**\n${damageResult.display}${totalDamageBonus ? ` ${fmt(totalDamageBonus)}` : ''} = **${finalDamage} ${damageType}**`;
    }
    if (damageContribText) damageLine += `\n*${damageContribText.trim().slice(1, -1)}*`;

    const acBreakdown = baseTargetAc !== null && targetMods.acBonus !== 0
      ? ` (base ${baseTargetAc}${fmt(targetMods.acBonus)} from effects = ${effectiveTargetAc})`
      : '';
    let outcomeLine;
    if (degree === 'crit-success')      outcomeLine = `🎯 **Critical Hit on ${target.name}!** AC ${effectiveTargetAc}${acBreakdown}`;
    else if (degree === 'success')      outcomeLine = `✅ **Hit on ${target.name}!** AC ${effectiveTargetAc}${acBreakdown}`;
    else if (degree === 'failure')      outcomeLine = `❌ **Miss on ${target.name}.** AC ${effectiveTargetAc}${acBreakdown}`;
    else if (degree === 'crit-failure') outcomeLine = `💢 **Critical Miss on ${target.name}.** AC ${effectiveTargetAc}${acBreakdown}`;
    else                                outcomeLine = `🎯 Attack against **${target.name}** (AC unknown — GM decides)`;

    let hpLine = '';
    let deathPayload = null;
    let mentionLine = '';
    if (degree === 'success' || degree === 'crit-success') {
      const dmgResult = ca.applyDamage(channelId, target.name, finalDamage);
      const dyingNote = dmgResult?.displaySuffix ?? '';
      hpLine = target.isNpc
        ? `\n❤️ **${target.name}** took ${finalDamage} damage${dyingNote}`
        : `\n❤️ **${target.name}**: ${target.hp}/${target.maxHp} HP${dyingNote}`;
      deathPayload = combatDeathPayload(dmgResult);
    }
    if (!target.isNpc && target.ownerId) mentionLine = `<@${target.ownerId}>`;

    const showDamage = (degree === 'success' || degree === 'crit-success' || degree === null);
    const description = [
      attackLine,
      '',
      showDamage ? damageLine : null,
      outcomeLine,
      hpLine || null,
    ].filter(s => s !== null).join('\n');

    const embed = new EmbedBuilder()
      .setColor(0x8B0000)
      .setTitle(`${attacker.name} attacks with ${attackName}!`)
      .setDescription(description)
      .setFooter({ text: `GM attack · Attack ${fmt(attackBonus)} · ${damageExpr} ${damageType}` });

    const replyPayload = { embeds: [embed, ...(deathPayload?.embeds ?? [])].slice(0, 10) };
    if (mentionLine) replyPayload.content = mentionLine;
    await interaction.reply(replyPayload);
    // Record attack for MAP tracking (only if MAP wasn't manually overridden)
    if (explicitMap === null) {
      ca.recordAttack(channelId, attacker.name);
    }
    await updateSummary(interaction.channel, enc);
}

module.exports = {
  name: 'mattack',
  execute,
};
