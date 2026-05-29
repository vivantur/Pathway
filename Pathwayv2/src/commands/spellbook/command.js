const { EmbedBuilder } = require('discord.js');

const charOverlay = require('../../rules/characterOverlay');
const characterState = require('../../state/characters');

function formatSlotPips(current, max) {
  if (max <= 0) return '';
  const cap = 15;
  const filled = Math.max(0, Math.min(current, max));
  const empty = max - filled;
  if (max > cap) return `**(${current}/${max})**`;
  return `${'\u25cf'.repeat(filled)}${'\u25cb'.repeat(empty)}`;
}

async function execute(interaction) {
  await interaction.deferReply();
  const characters = characterState.getAll();
  const { error, char: charEntry } = characterState.resolveChar(
    interaction.user.id,
    interaction.options.getString('name'),
    characters
  );
  if (error) return interaction.editReply(error);

  const c = charEntry.data;
  if (!c.spellCasters?.length) return interaction.editReply(`**${c.name}** has no spellcasting!`);

  charOverlay.ensureOverlay(charEntry);
  const embed = new EmbedBuilder().setColor(0x9B59B6).setTitle(`\ud83d\udd2e ${c.name}'s Spellbook`);
  if (charEntry.art) embed.setThumbnail(charEntry.art);

  for (const caster of c.spellCasters) {
    const merged = charOverlay.getMergedSpellbook(charEntry, caster.name);
    if (!merged) continue;

    const fmtList = (names) => names.map(n => merged.overlayNames.has(n) ? `${n} \u2728` : n).join(', ');
    const sections = [];

    if (merged.cantrips.length) {
      sections.push(`**__Cantrips__**\n${fmtList(merged.cantrips)}`);
    }

    const ranks = Object.keys(merged.ranks).map(Number).sort((a, b) => a - b);
    for (const rank of ranks) {
      const spellList = merged.ranks[rank];
      if (!spellList.length) continue;
      const max = Number(caster.perDay?.[rank] ?? 0);
      let header = `**__Rank ${rank}__**`;
      if (max > 0) {
        const { current } = charOverlay.getSlotsRemaining(charEntry, caster.name, rank);
        header += ` ${formatSlotPips(current, max)}`;
      }
      sections.push(`${header}\n${fmtList(spellList)}`);
    }

    const overlay = charEntry.overlay;
    const prepList = overlay.prepared_override?.[caster.name] ?? [];
    if (caster.spellcastingType === 'prepared' && prepList.length) {
      const byRank = {};
      for (const prepared of prepList) {
        (byRank[prepared.rank] = byRank[prepared.rank] ?? []).push(prepared.spell);
      }
      const lines = Object.keys(byRank)
        .map(Number)
        .sort((a, b) => a - b)
        .map(rank => `**__Rank ${rank}__:** ${byRank[rank].join(', ')}`);
      sections.push(`**\ud83d\udccb Prepared today:**\n${lines.join('\n')}`);
    }

    const body = sections.join('\n\n') || '*No spells known.*';
    const casterType = caster.spellcastingType || 'unknown';
    const innateTag = caster.innate ? ' \u00b7 innate' : '';
    const header = `${caster.name} (${caster.magicTradition} \u00b7 ${casterType}${innateTag})`;
    embed.addFields({ name: header, value: body.slice(0, 1024), inline: false });
  }

  const focus = c.focus ?? {};
  const focusLines = [];
  for (const [tradition, byAbility] of Object.entries(focus)) {
    for (const [ability, fdata] of Object.entries(byAbility)) {
      const spells = [...(fdata.focusCantrips ?? []), ...(fdata.focusSpells ?? [])];
      if (spells.length) {
        focusLines.push(`**${tradition.charAt(0).toUpperCase() + tradition.slice(1)} (${ability.toUpperCase()}):** ${spells.join(', ')}`);
      }
    }
  }
  if (focusLines.length) {
    const { current, max } = charOverlay.getCurrentFocus(charEntry);
    embed.addFields({
      name: `\ud83c\udf1f Focus Spells (${current}/${max} points)`,
      value: focusLines.join('\n').slice(0, 1024),
      inline: false,
    });
  }

  embed.setFooter({ text: '\u2728 = added via /spells \u00b7 /cast <spell> to cast \u00b7 /rest to refresh' });
  await characterState.saveAll(characters);
  return interaction.editReply({ embeds: [embed] });
}

async function executePrepared(interaction) {
  await interaction.deferReply({ ephemeral: false });
  const characters = characterState.getAll();
  const { error, char: charEntry } = characterState.resolveChar(
    interaction.user.id,
    interaction.options.getString('name'),
    characters
  );
  if (error) return interaction.editReply(error);

  const c = charEntry.data;
  if (!c.spellCasters?.length) return interaction.editReply(`**${c.name}** has no spellcasting!`);

  charOverlay.ensureOverlay(charEntry);
  const embed = new EmbedBuilder().setColor(0x9B59B6).setTitle(`\ud83d\udccb ${c.name}'s Prepared Spells`);
  if (charEntry.art) embed.setThumbnail(charEntry.art);

  const overlay = charEntry.overlay ?? {};
  let anyPreparedCaster = false;
  let anyPreparedSpells = false;

  for (const caster of c.spellCasters) {
    if (caster.spellcastingType !== 'prepared') continue;
    anyPreparedCaster = true;

    const prepList = overlay.prepared_override?.[caster.name] ?? [];
    const merged = charOverlay.getMergedSpellbook(charEntry, caster.name);
    const cantrips = merged?.cantrips ?? [];

    const sections = [];
    if (cantrips.length) {
      sections.push(`**__Cantrips__** *(at-will)*\n${cantrips.join(', ')}`);
    }

    if (prepList.length === 0) {
      sections.push('*Nothing prepared yet today. Use `/spells prepare` to fill slots.*');
    } else {
      anyPreparedSpells = true;
      const byRank = {};
      for (const prepared of prepList) {
        (byRank[prepared.rank] = byRank[prepared.rank] ?? []).push(prepared.spell);
      }
      const ranks = Object.keys(byRank).map(Number).sort((a, b) => a - b);
      for (const rank of ranks) {
        const max = Number(caster.perDay?.[rank] ?? 0);
        let header = `**__Rank ${rank}__**`;
        if (max > 0) {
          const { current } = charOverlay.getSlotsRemaining(charEntry, caster.name, rank);
          header += ` ${formatSlotPips(current, max)}`;
        }
        sections.push(`${header}\n${byRank[rank].join(', ')}`);
      }
    }

    const innateTag = caster.innate ? ' \u00b7 innate' : '';
    const casterHeader = `${caster.name} (${caster.magicTradition} \u00b7 prepared${innateTag})`;
    embed.addFields({ name: casterHeader, value: sections.join('\n\n').slice(0, 1024), inline: false });
  }

  const spontCasters = c.spellCasters.filter(sc => sc.spellcastingType === 'spontaneous');
  if (spontCasters.length) {
    const names = spontCasters.map(sc => sc.name).join(', ');
    embed.addFields({ name: '\ud83c\udfb5 Spontaneous casters (no daily prep)', value: `${names} \u2014 use \`/spellbook\` to see their repertoire.`, inline: false });
  }

  if (!anyPreparedCaster && !spontCasters.length) {
    embed.setDescription('This character has no prepared or spontaneous casters configured.');
  } else if (!anyPreparedCaster) {
    embed.setDescription(`**${c.name}** has no prepared casters. Use \`/spellbook\` to see the repertoire.`);
  } else if (!anyPreparedSpells) {
    embed.setFooter({ text: 'Nothing is prepared yet \u2014 use /spells prepare to fill slots before combat.' });
  } else {
    embed.setFooter({ text: '/cast <spell> to cast \u00b7 /rest to refresh slots' });
  }

  return interaction.editReply({ embeds: [embed] });
}

module.exports = {
  name: 'spellbook',
  execute,
  executePrepared,
  formatSlotPips,
};
