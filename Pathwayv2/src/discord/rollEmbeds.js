const fs = require('fs');
const path = require('path');
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');

// Pathway brand colors used across roll embeds. Gold matches the d20 art.
const PATHWAY_GOLD = 0xC9A24A;

// Pathway dice fallback art shown when a character/companion has no portrait
// set. Loaded once at startup; if the file is missing, embeds gracefully omit
// the thumbnail.
const PATHWAY_DICE_NAME = 'pathway-dice.png';
const PATHWAY_DICE_REF = `attachment://${PATHWAY_DICE_NAME}`;
let PATHWAY_DICE_BUFFER = null;
try {
  PATHWAY_DICE_BUFFER = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', PATHWAY_DICE_NAME));
} catch {
  // No fallback art on disk - embeds will render without a thumbnail.
}

function rollFallbackFiles(thumbnail) {
  if (thumbnail || !PATHWAY_DICE_BUFFER) return [];
  return [new AttachmentBuilder(PATHWAY_DICE_BUFFER, { name: PATHWAY_DICE_NAME })];
}

function buildRollEmbed({ title, breakdown, charName, thumbnail }) {
  const embed = new EmbedBuilder().setColor(PATHWAY_GOLD).setTitle(title).setDescription(breakdown);
  if (thumbnail) embed.setThumbnail(thumbnail);
  else if (PATHWAY_DICE_BUFFER) embed.setThumbnail(PATHWAY_DICE_REF);
  if (charName) embed.setFooter({ text: charName });
  return embed;
}

function buildCombatDeathEmbed(name) {
  return new EmbedBuilder()
    .setColor(0x8b0000)
    .setTitle(`${name} has Died!`)
    .setDescription(`**${name}** reached Dying 4 and has been removed from initiative.`);
}

function combatDeathPayload(result) {
  const name = result?.removed?.name ?? result?.name ?? result?.combatant?.name;
  return result?.died && name ? { embeds: [buildCombatDeathEmbed(name)] } : null;
}

function combatDyingSuffix(result) {
  if (!result) return '';
  if (result.died) return `\n☠️ **${result.removed?.name ?? result.combatant?.name ?? result.name} has Died!** Removed from initiative.`;
  if (result.wentDown && result.dying > 0) return `\n💀 **Down!** (Dying ${result.dying})`;
  if (result.dyingIncreased && result.dying > 0) return `\n💀 **Dying increased to ${result.dying}**`;
  if (result.wokeUp) return `\n✨ **Recovered from dying!** (now Wounded ${result.wounded})`;
  return '';
}

function formatRollBreakdown(dieRoll, modifier, extraBonus, total, sides) {
  const isCrit = sides === 20 && dieRoll === 20;
  const isFumble = sides === 20 && dieRoll === 1;
  const modPart = modifier !== 0 ? ` + ${modifier}` : '';
  const extraPart = extraBonus && extraBonus !== 0 ? ` + ${extraBonus}` : '';
  let line = `1d20 (${dieRoll})${modPart}${extraPart} = \`${total}\``;
  if (isCrit) line += '\n⭐ Natural 20!';
  if (isFumble) line += '\n💀 Natural 1!';
  return line;
}

module.exports = {
  PATHWAY_GOLD,
  PATHWAY_DICE_REF,
  PATHWAY_DICE_BUFFER,
  rollFallbackFiles,
  buildRollEmbed,
  combatDeathPayload,
  combatDyingSuffix,
  formatRollBreakdown,
};
