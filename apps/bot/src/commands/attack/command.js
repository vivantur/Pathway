const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const characterState = require('../../state/characters');
const ca = require('../../rules/combatAutomation');
const { sumEffectModifiers } = require('../../rules/combatEffects');
const { fmt } = require('../../lib/format');
const { determineDegreeOfSuccess } = require('../../lib/dice');
const { combatDeathPayload } = require('../../discord/rollEmbeds');
const { getEncounter } = require('../encounters');
const { updateSummary } = require('../init/legacySummary');

function loadCharacters() {
  return characterState.getAll();
}

const { resolveChar, getCharacterWeapons } = characterState;

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
    const weaponName = interaction.options.getString('weapon');
    const targetName = interaction.options.getString('target');
    const extraBonus = interaction.options.getInteger('bonus') ?? 0;
    const explicitMap = interaction.options.getInteger('map'); // null if unset
    const noMap = interaction.options.getBoolean('no_map') ?? false;
    const characters = loadCharacters();

    const { error, char: charEntry } = resolveChar(interaction.user.id, interaction.options.getString('character'), characters);
    if (error) return interaction.reply({ content: error, ephemeral: true });

    const c = charEntry.data;
    const weapons = getCharacterWeapons(charEntry);

    const weapon = weapons.find(w => (w.display ?? w.name).toLowerCase() === weaponName.toLowerCase())
      ?? weapons.find(w => (w.display ?? w.name).toLowerCase().includes(weaponName.toLowerCase()));
    if (!weapon) {
      const available = weapons.map(w => w.display ?? w.name).join(', ') || 'none';
      return interaction.reply({ content: `❌ Couldn't find weapon "${weaponName}" on ${c.name}. Available: ${available}`, ephemeral: true });
    }

    const hasAgile = (weapon.traits ?? []).map(t => t.toLowerCase()).includes('agile');

    const channelId = interaction.channel.id;
    const enc = getEncounter(channelId);

    // Look up attacker in encounter to get their active effects + MAP state
    const attackerCombatant = enc ? enc.combatants.find(x => x.name.toLowerCase() === c.name.toLowerCase()) : null;
    const attackerMods = sumEffectModifiers(attackerCombatant);

    // ── Auto-MAP ──
    // If user passed map: explicitly, honor it. Otherwise, compute from
    // attacksThisTurn tracked on the combatant. The no_map flag (e.g. for
    // Flurry of Blows) skips MAP entirely.
    let mapPenalty, mapNoteText;
    if (noMap) {
      mapPenalty = 0;
      mapNoteText = null;
    } else if (explicitMap !== null) {
      mapPenalty = explicitMap === 0 ? 0 : explicitMap === 1 ? (hasAgile ? -4 : -5) : (hasAgile ? -8 : -10);
      mapNoteText = explicitMap > 0 ? `MAP ${mapPenalty} (manual)` : null;
    } else if (attackerCombatant) {
      const mapInfo = ca.computeMapForNextAttack(attackerCombatant, hasAgile);
      mapPenalty = mapInfo.penalty;
      mapNoteText = mapInfo.noteText;
    } else {
      // Not in an encounter — no MAP tracking possible
      mapPenalty = 0;
      mapNoteText = null;
    }

    // Look up target
    let target = null;
    if (targetName) {
      if (!enc) return interaction.reply({ content: '❌ Target specified but no active encounter in this channel. Start one with `/init start`.', ephemeral: true });
      target = enc.combatants.find(x => x.name.toLowerCase() === targetName.toLowerCase());
      if (!target) return interaction.reply({ content: `❌ No combatant named "${targetName}" in this encounter.`, ephemeral: true });
    }
    const targetMods = target ? sumEffectModifiers(target) : { acBonus: 0, activeEffects: [] };

    const baseAttackBonus = weapon.attack ?? 0;
    const dieRoll = Math.floor(Math.random() * 20) + 1;
    const attackTotal = dieRoll + baseAttackBonus + extraBonus + mapPenalty + attackerMods.attackBonus;

    // Effective target AC includes effect modifiers
    const baseTargetAc = target?.ac ?? null;
    const effectiveTargetAc = baseTargetAc !== null ? baseTargetAc + targetMods.acBonus : null;

    const targetDegree = effectiveTargetAc !== null
      ? determineDegreeOfSuccess(attackTotal, dieRoll, effectiveTargetAc)
      : null;

    // Roll damage
    const dieSize = weapon.die ?? 'd4';
    const damageBonusBase = weapon.damageBonus ?? 0;
    const damageType = weapon.damageType === 'P' ? 'piercing'
      : weapon.damageType === 'S' ? 'slashing'
      : weapon.damageType === 'B' ? 'bludgeoning'
      : (weapon.damageType ?? '').toLowerCase();

    const dieMatch = dieSize.match(/^(\d*)d(\d+)$/i);
    const numDice = dieMatch ? (parseInt(dieMatch[1]) || 1) : 1;
    const numSides = dieMatch ? parseInt(dieMatch[2]) : 4;
    const rolls = Array.from({ length: numDice }, () => Math.floor(Math.random() * numSides) + 1);
    const damageRollSum = rolls.reduce((a, b) => a + b, 0);
    const totalDamageBonus = damageBonusBase + attackerMods.damageBonus;
    const damageTotal = Math.max(1, damageRollSum + totalDamageBonus);

    // Build attack line. Auto-MAP shows "Attack #2 this turn · MAP -5" instead
    // of just "-5" so the player learns where the penalty came from.
    const mapText = mapPenalty !== 0 ? ` ${mapPenalty}` : '';
    const bonusText = extraBonus !== 0 ? ` ${fmt(extraBonus)}` : '';
    const attackerEffectText = formatEffectContributions(attackerMods.activeEffects, 'attack');
    let attackLine = `**Attack Roll**\n1d20 (${dieRoll}) ${fmt(baseAttackBonus)}${mapText}${bonusText}${attackerEffectText ? ` ${fmt(attackerMods.attackBonus)}` : ''} = **${attackTotal}**`;
    if (mapNoteText) attackLine += `\n*${mapNoteText}*`;
    if (attackerEffectText) attackLine += `\n*${attackerEffectText.trim().slice(1, -1)}*`;
    if (dieRoll === 20) attackLine += '\n⭐ Natural 20!';
    if (dieRoll === 1)  attackLine += '\n💀 Natural 1!';

    // Build damage line
    let finalDamage = damageTotal;
    const damageContribText = formatEffectContributions(attackerMods.activeEffects, 'damage');
    const damageBonusDisplay = totalDamageBonus !== 0 ? fmt(totalDamageBonus) : '';
    let damageLine;
    if (targetDegree === 'crit-success') {
      finalDamage = damageTotal * 2;
      damageLine = `**Damage (CRIT × 2)**\n${numDice}d${numSides}[${rolls.join(', ')}] ${damageBonusDisplay} = ${damageTotal} × 2 = **${finalDamage} ${damageType}**`;
    } else {
      damageLine = `**Damage**\n${numDice}d${numSides}[${rolls.join(', ')}] ${damageBonusDisplay} = **${finalDamage} ${damageType}**`;
    }
    if (damageContribText) damageLine += `\n*${damageContribText.trim().slice(1, -1)}*`;

    // Outcome with AC breakdown
    const acBreakdown = baseTargetAc !== null && targetMods.acBonus !== 0
      ? ` (base ${baseTargetAc}${fmt(targetMods.acBonus)} from effects = ${effectiveTargetAc})`
      : '';
    let outcomeLine = '';
    if (targetDegree === 'crit-success') outcomeLine = `🎯 **Critical Hit on ${target.name}!** AC ${effectiveTargetAc}${acBreakdown}`;
    else if (targetDegree === 'success')      outcomeLine = `✅ **Hit on ${target.name}!** AC ${effectiveTargetAc}${acBreakdown}`;
    else if (targetDegree === 'failure')      outcomeLine = `❌ **Miss on ${target.name}.** AC ${effectiveTargetAc}${acBreakdown}`;
    else if (targetDegree === 'crit-failure') outcomeLine = `💢 **Critical Miss on ${target.name}.** AC ${effectiveTargetAc}${acBreakdown}`;
    else if (target)                          outcomeLine = `🎯 Attack against **${target.name}** (AC unknown — GM decides)`;

    let hpLine = '';
    let deathPayload = null;
    let mentionLine = '';
    if (target && (targetDegree === 'success' || targetDegree === 'crit-success')) {
      const dmgResult = ca.applyDamage(channelId, target.name, finalDamage);
      const dyingNote = dmgResult?.displaySuffix ?? '';
      hpLine = target.isNpc
        ? `\n❤️ **${target.name}** took ${finalDamage} damage${dyingNote}`
        : `\n❤️ **${target.name}**: ${target.hp}/${target.maxHp} HP${dyingNote}`;
      deathPayload = combatDeathPayload(dmgResult);
      if (!target.isNpc && target.ownerId) mentionLine = `<@${target.ownerId}> `;
    } else if (target && !target.isNpc && target.ownerId) {
      mentionLine = `<@${target.ownerId}> `;
    }

    // Record attack for MAP tracking (after the attack resolves so the next one gets the bumped value)
    if (attackerCombatant && !noMap && explicitMap === null) {
      ca.recordAttack(channelId, c.name);
    }

    // ── Reaction prompts ──
    // Only prompt for a target's reactions (Reactive Strike triggers on attacks
    // by adjacent enemies). We can't know adjacency, so we only prompt for the
    // direct target — that's the simplest case where a reaction is plausible.
    let reactionPromptRow = null;
    let reactionPromptContent = '';
    if (target && target.hasReaction !== false && ca.hasReactionAvailable(target)) {
      // Skip if target is the attacker themselves
      if (target.name.toLowerCase() !== c.name.toLowerCase()) {
        const reactorMention = target.isNpc ? `<@${enc.gmId}>` : (target.ownerId ? `<@${target.ownerId}>` : '');
        reactionPromptContent = `\n${reactorMention} **${target.name}** may have a reaction available (e.g. Reactive Strike, Shield Block).`;
        reactionPromptRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`reaction_trigger_${target.name.replace(/[^a-zA-Z0-9]/g, '_')}`)
            .setLabel(`${target.name}: Trigger Reaction`)
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🎲'),
          new ButtonBuilder()
            .setCustomId(`reaction_skip_${target.name.replace(/[^a-zA-Z0-9]/g, '_')}`)
            .setLabel('Skip')
            .setStyle(ButtonStyle.Secondary),
        );
      }
    }

    const description = [
      attackLine,
      '',
      (targetDegree === 'success' || targetDegree === 'crit-success' || targetDegree === null) ? damageLine : null,
      outcomeLine || null,
      hpLine || null,
    ].filter(s => s !== null).join('\n');

    const embed = new EmbedBuilder()
      .setColor(0xC0392B)
      .setTitle(`⚔️ ${c.name} attacks with ${weapon.display ?? weapon.name}!`)
      .setDescription(description)
      .setFooter({ text: `${c.name} · Attack ${fmt(baseAttackBonus)} · ${weapon.die ?? ''}${damageBonusBase ? fmt(damageBonusBase) : ''} ${damageType}` });
    if (charEntry.art) embed.setThumbnail(charEntry.art);

    const replyPayload = { embeds: [embed, ...(deathPayload?.embeds ?? [])].slice(0, 10) };
    let content = (mentionLine || '').trim();
    if (reactionPromptContent) content = (content + reactionPromptContent).trim();
    if (content) replyPayload.content = content;
    if (reactionPromptRow) replyPayload.components = [reactionPromptRow];

    await interaction.reply(replyPayload);
    const encForSummary = getEncounter(interaction.channel.id);
    if (encForSummary && target) await updateSummary(interaction.channel, encForSummary);
}

module.exports = {
  name: 'attack',
  execute,
};
