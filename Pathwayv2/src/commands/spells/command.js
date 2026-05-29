const { EmbedBuilder } = require('discord.js');

const charOverlay = require('../../rules/characterOverlay');
const characterState = require('../../state/characters');
const { findSpell, spellAmbiguityMessage } = require('../spell/lookup');
const { normalizeSpell } = require('../spell/embed');

function getCasterPicker(c, casters) {
  return function pickCaster(explicitName) {
    if (explicitName) {
      const found = charOverlay.findCaster(c, explicitName);
      if (!found) {
        return { error: `No caster named "${explicitName}" on **${c.name}**. Available: ${casters.map(x => x.name).join(', ')}` };
      }
      return { caster: found };
    }
    if (casters.length === 1) return { caster: casters[0] };
    return { error: `**${c.name}** has multiple casters. Specify one with the \`caster\` option: ${casters.map(x => x.name).join(', ')}` };
  };
}

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const characters = characterState.getAll();
  const { error, char: charEntry } = characterState.resolveChar(
    interaction.user.id,
    interaction.options.getString('character'),
    characters
  );
  if (error) return interaction.reply({ content: error, ephemeral: true });

  const c = charEntry.data;
  const casters = charOverlay.getCasters(c);
  if (!casters.length) return interaction.reply({ content: `**${c.name}** has no spellcasting!`, ephemeral: true });

  const pickCaster = getCasterPicker(c, casters);

  if (sub === 'learn') {
    const spellName = interaction.options.getString('spell');
    const explicitCaster = interaction.options.getString('caster');
    const picked = pickCaster(explicitCaster);
    if (picked.error) return interaction.reply({ content: picked.error, ephemeral: true });

    const rawSpell = findSpell(spellName);
    if (rawSpell?.ambiguous) return interaction.reply({ content: spellAmbiguityMessage(rawSpell), ephemeral: true });
    if (!rawSpell) return interaction.reply({ content: `\u274c Couldn't find a spell called **${spellName}**.`, ephemeral: true });

    const spell = normalizeSpell(rawSpell);
    const rank = spell.type === 'Cantrip' ? 0 : Number(spell.level ?? 1);
    const casterTradition = picked.caster.magicTradition?.toLowerCase() ?? '';
    const spellTraditions = (spell.traditions ?? []).map(t => t.toLowerCase());
    const traditionMismatch = spellTraditions.length && !spellTraditions.includes(casterTradition);
    const result = charOverlay.learnSpell(charEntry, picked.caster.name, spell.name, rank);
    if (!result.ok) return interaction.reply({ content: `\u274c ${result.error}`, ephemeral: true });

    await characterState.saveAll(characters);
    const embed = new EmbedBuilder()
      .setColor(0x9B59B6)
      .setTitle(`\ud83d\udcd8 ${c.name} learned ${spell.name}`)
      .setDescription(`Added to **${picked.caster.name}**'s ${rank === 0 ? 'cantrips' : `rank ${rank} spells`}.`)
      .setFooter({ text: 'Use /spellbook to see the full list \u00b7 /spells forget to undo' });

    if (traditionMismatch) {
      embed.addFields({
        name: '\u26a0\ufe0f Tradition note',
        value: `**${spell.name}** is ${spell.traditions.join('/')}. **${picked.caster.name}** casts ${picked.caster.magicTradition}. Added anyway - if you meant a different caster, use \`/spells forget\` and retry with the \`caster\` option.`,
        inline: false,
      });
    }
    return interaction.reply({ embeds: [embed] });
  }

  if (sub === 'forget') {
    const spellName = interaction.options.getString('spell');
    const explicitCaster = interaction.options.getString('caster');
    const picked = pickCaster(explicitCaster);
    if (picked.error) return interaction.reply({ content: picked.error, ephemeral: true });

    const result = charOverlay.forgetSpell(charEntry, picked.caster.name, spellName);
    if (!result.ok) return interaction.reply({ content: `\u274c ${result.error}`, ephemeral: true });
    await characterState.saveAll(characters);
    return interaction.reply({ content: `\ud83d\uddd1\ufe0f **${c.name}** forgot **${spellName}** (from ${picked.caster.name}).` });
  }

  if (sub === 'prepare') {
    const spellName = interaction.options.getString('spell');
    const rank = interaction.options.getInteger('rank');
    const explicitCaster = interaction.options.getString('caster');
    const picked = pickCaster(explicitCaster);
    if (picked.error) return interaction.reply({ content: picked.error, ephemeral: true });

    const result = charOverlay.prepareSpell(charEntry, picked.caster.name, spellName, rank);
    if (!result.ok) return interaction.reply({ content: `\u274c ${result.error}`, ephemeral: true });
    await characterState.saveAll(characters);
    const slots = charOverlay.getSlotsRemaining(charEntry, picked.caster.name, rank);
    return interaction.reply({ content: `\ud83d\udccb Prepared **${spellName}** at rank ${rank} for **${picked.caster.name}**. Slots filled this rank: ${result.slot_index + 1}/${slots.max || '?'}.` });
  }

  if (sub === 'unprepare') {
    const spellName = interaction.options.getString('spell');
    const rank = interaction.options.getInteger('rank');
    const explicitCaster = interaction.options.getString('caster');
    const picked = pickCaster(explicitCaster);
    if (picked.error) return interaction.reply({ content: picked.error, ephemeral: true });

    const result = charOverlay.unprepareSpell(charEntry, picked.caster.name, spellName, rank);
    if (!result.ok) return interaction.reply({ content: `\u274c ${result.error}`, ephemeral: true });
    await characterState.saveAll(characters);
    return interaction.reply({ content: `\ud83d\uddd1\ufe0f Unprepared **${spellName}** (rank ${rank}) from **${picked.caster.name}**.` });
  }

  if (sub === 'swap') {
    const removeName = interaction.options.getString('remove');
    const addName = interaction.options.getString('add');
    const rank = interaction.options.getInteger('rank');
    const explicitCaster = interaction.options.getString('caster');
    const picked = pickCaster(explicitCaster);
    if (picked.error) return interaction.reply({ content: picked.error, ephemeral: true });

    const rawSpell = findSpell(addName);
    if (rawSpell?.ambiguous) return interaction.reply({ content: spellAmbiguityMessage(rawSpell), ephemeral: true });
    if (!rawSpell) return interaction.reply({ content: `\u274c Couldn't find a spell called **${addName}** in the database.`, ephemeral: true });

    const result = charOverlay.swapRepertoire(charEntry, picked.caster.name, rank, removeName, addName);
    if (!result.ok) return interaction.reply({ content: `\u274c ${result.error}`, ephemeral: true });
    await characterState.saveAll(characters);
    return interaction.reply({ content: `\ud83d\udd04 **${picked.caster.name}** swapped **${removeName}** \u2192 **${addName}** (rank ${rank}).` });
  }

  if (sub === 'list') {
    const explicitCaster = interaction.options.getString('caster');
    charOverlay.ensureOverlay(charEntry);
    const embed = new EmbedBuilder().setColor(0x9B59B6).setTitle(`\ud83d\udd2e ${c.name}'s Spells`);
    if (charEntry.art) embed.setThumbnail(charEntry.art);

    const showCasters = explicitCaster
      ? casters.filter(x => (x.name || '').toLowerCase() === explicitCaster.toLowerCase())
      : casters;
    if (!showCasters.length) return interaction.reply({ content: `No caster named "${explicitCaster}" on **${c.name}**.`, ephemeral: true });

    for (const caster of showCasters) {
      const merged = charOverlay.getMergedSpellbook(charEntry, caster.name);
      if (!merged) continue;
      const fmtList = (names) => names.map(n => merged.overlayNames.has(n) ? `${n} \u2728` : n).join(', ');
      const sections = [];
      if (merged.cantrips.length) sections.push(`**Cantrips:** ${fmtList(merged.cantrips)}`);

      for (const rank of Object.keys(merged.ranks).map(Number).sort((a, b) => a - b)) {
        const max = Number(caster.perDay?.[rank] ?? 0);
        const slotSuffix = max > 0
          ? ` *(${charOverlay.getSlotsRemaining(charEntry, caster.name, rank).current}/${max} slots)*`
          : '';
        sections.push(`**Rank ${rank}${slotSuffix}:** ${fmtList(merged.ranks[rank])}`);
      }

      const overlay = charEntry.overlay;
      const prepList = overlay.prepared_override?.[caster.name] ?? [];
      if (caster.spellcastingType === 'prepared' && prepList.length) {
        const byRank = {};
        for (const prepared of prepList) (byRank[prepared.rank] = byRank[prepared.rank] ?? []).push(prepared.spell);
        const lines = Object.keys(byRank)
          .map(Number)
          .sort((a, b) => a - b)
          .map(rank => `Rank ${rank}: ${byRank[rank].join(', ')}`);
        sections.push(`**\ud83d\udccb Prepared today:**\n${lines.join('\n')}`);
      }

      const casterType = caster.spellcastingType || 'unknown';
      const innateTag = caster.innate ? ' \u00b7 innate' : '';
      const header = `${caster.name} (${caster.magicTradition} \u00b7 ${casterType}${innateTag})`;
      embed.addFields({ name: header, value: (sections.join('\n') || '*No spells known.*').slice(0, 1024), inline: false });
    }

    embed.setFooter({ text: '\u2728 = added via /spells learn or /spells swap' });
    return interaction.reply({ embeds: [embed] });
  }

  return interaction.reply({ content: '\u274c Unknown subcommand.', ephemeral: true });
}

module.exports = {
  name: 'spells',
  execute,
};
