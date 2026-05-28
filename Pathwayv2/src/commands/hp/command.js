// ── commands/hp/command.js ──────────────────────────────────────────────────
// /hp slash command: view, set, add (heal/damage), reset, max (override).
//
// Receives `ctx` for the helpers that still live in index.js (resolveChar,
// loadCharacters, saveCharacters). HP math comes directly from
// state/characters; the embed builder is co-located in ./embed.js.

const { buildCharHpEmbed } = require('./embed');
const characterState = require('../../state/characters');
const {
  computeCharMaxHp,
  getCharacterHp,
  setCharacterHp,
  resolveChar,
} = characterState;

// Zero ctx as of Phase 3.7 — all dependencies come through explicit imports.
async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const characters = characterState.getAll();
  const charNameArg = interaction.options.getString('character');
  const { error, charKey, char: charEntry } = resolveChar(interaction.user.id, charNameArg, characters);
  if (error) return interaction.reply({ content: error, ephemeral: true });
  const char = charEntry.data;

  if (sub === 'view') {
    return interaction.reply({ embeds: [buildCharHpEmbed(char, charEntry)] });
  }

  if (sub === 'set') {
    const value = interaction.options.getInteger('value');
    if (value < 0) return interaction.reply({ content: '❌ HP cannot be negative.', ephemeral: true });
    const maxHp = computeCharMaxHp(charEntry);
    const oldHp = getCharacterHp(charEntry);
    const newHp = setCharacterHp(charEntry, value);
    characters[interaction.user.id][charKey] = charEntry;
    await characterState.saveAll(characters);
    const note = value > maxHp
      ? `✏️ Set to **${newHp}/${maxHp}** (clamped from requested ${value}).`
      : `✏️ Set to **${newHp}/${maxHp}** (was ${oldHp}).`;
    return interaction.reply({ embeds: [buildCharHpEmbed(char, charEntry, note)] });
  }

  if (sub === 'add') {
    const value = interaction.options.getInteger('value');
    if (value === 0) return interaction.reply({ content: '❌ Amount cannot be 0.', ephemeral: true });
    const maxHp = computeCharMaxHp(charEntry);
    const oldHp = getCharacterHp(charEntry);
    const newHp = setCharacterHp(charEntry, oldHp + value);
    characters[interaction.user.id][charKey] = charEntry;
    await characterState.saveAll(characters);
    const actuallyChanged = newHp - oldHp;
    let note;
    if (actuallyChanged === 0 && value > 0) note = `💚 Already at full HP (${maxHp}/${maxHp}).`;
    else if (actuallyChanged === 0 && value < 0) note = `💀 Already at 0 HP.`;
    else if (value > 0) note = `💚 Healed **+${actuallyChanged}** HP: ${oldHp} → **${newHp}**/${maxHp}.`;
    else note = `💔 Took **${value}** damage: ${oldHp} → **${newHp}**/${maxHp}.`;
    return interaction.reply({ embeds: [buildCharHpEmbed(char, charEntry, note)] });
  }

  if (sub === 'reset') {
    const maxHp = computeCharMaxHp(charEntry);
    charEntry.hp = maxHp;
    characters[interaction.user.id][charKey] = charEntry;
    await characterState.saveAll(characters);
    const note = `🌅 Fully healed: **${maxHp}/${maxHp}** HP.`;
    return interaction.reply({ embeds: [buildCharHpEmbed(char, charEntry, note)] });
  }

  // /hp max — override the max HP permanently. Used when the computed max
  // is wrong (homebrew rules, custom features, etc.). Stored on charEntry
  // as _hpMaxOverride; computeCharMaxHp honors it. action:clear removes
  // the override and falls back to the computed value.
  if (sub === 'max') {
    const action = interaction.options.getString('action');
    if (action === 'clear') {
      const oldOverride = charEntry._hpMaxOverride;
      delete charEntry._hpMaxOverride;
      const newMax = computeCharMaxHp(charEntry);
      if (typeof charEntry.hp === 'number' && charEntry.hp > newMax) {
        charEntry.hp = newMax;
      }
      characters[interaction.user.id][charKey] = charEntry;
      await characterState.saveAll(characters);
      const note = oldOverride
        ? `🧹 Cleared max HP override (was ${oldOverride}). Now using computed max: **${newMax}**.`
        : `ℹ️ No override was set. Computed max: **${newMax}**.`;
      return interaction.reply({ embeds: [buildCharHpEmbed(char, charEntry, note)] });
    }

    const value = interaction.options.getInteger('value');
    if (value === null || value === undefined) {
      return interaction.reply({ content: '❌ Provide either `value:` (a new max) or `action:clear`.', ephemeral: true });
    }
    if (value < 1) return interaction.reply({ content: '❌ Max HP must be at least 1.', ephemeral: true });
    if (value > 9999) return interaction.reply({ content: '❌ Max HP must be 9999 or less.', ephemeral: true });

    const oldMax = computeCharMaxHp(charEntry);
    charEntry._hpMaxOverride = value;
    // If they were at full HP (or no overlay), bump current to new max.
    // If they were already wounded, leave current HP alone.
    if (typeof charEntry.hp !== 'number' || charEntry.hp === oldMax) {
      charEntry.hp = value;
    }
    characters[interaction.user.id][charKey] = charEntry;
    await characterState.saveAll(characters);
    const note = `🔧 Max HP override set to **${value}** (was ${oldMax}). Use \`/hp max action:Clear override\` to revert.`;
    return interaction.reply({ embeds: [buildCharHpEmbed(char, charEntry, note)] });
  }
}

module.exports = {
  name: 'hp',
  execute,
};
