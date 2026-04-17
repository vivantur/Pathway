// src/commands/initiative.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const {
  getEncounter,
  createEncounter,
  deleteEncounter,
  addCombatant,
  removeCombatant,
  advanceTurn,
  modifyHp,
} = require('../encounters');

// Path to your characters.json file — adjust if yours is named/located differently
const CHAR_FILE = path.join(__dirname, '..', '..', 'characters.json');

// Convert an ability score (e.g. 14) to its modifier (e.g. +2)
function abilityMod(score) {
  return Math.floor((score - 10) / 2);
}

// Convert a proficiency value (0/2/4/6/8) to a bonus for a given level.
// In PF2e: untrained = 0, else level + proficiency rank bonus.
function profBonus(level, profValue) {
  if (!profValue || profValue === 0) return 0;
  return level + profValue;
}

// Compute max HP from the character's stored ingredients
function computeMaxHp(data) {
  const ancestry = data.attributes?.ancestryhp ?? 0;
  const classHp = data.attributes?.classhp ?? 0;
  const bonus = data.attributes?.bonushp ?? 0;
  const bonusPerLevel = data.attributes?.bonushpPerLevel ?? 0;
  const conMod = abilityMod(data.abilities?.con ?? 10);
  const level = data.level ?? 1;
  // At level 1: ancestry + (class + con) + bonus
  // Each additional level: + (class + con + bonusPerLevel)
  return ancestry + classHp + conMod + bonus + (level - 1) * (classHp + conMod + bonusPerLevel);
}

// Compute Perception bonus
function computePerception(data) {
  const level = data.level ?? 1;
  const wisMod = abilityMod(data.abilities?.wis ?? 10);
  const profValue = data.proficiencies?.perception ?? 0;
  return profBonus(level, profValue) + wisMod;
}

// Load the active character for a given Discord user ID.
// Your schema: { userId: { charNameLower: { name, data, saved, art } } }
// For now we grab the first character under that user. If you later add a
// "currently loaded" pointer, update this to respect it.
function loadCharacter(userId) {
  if (!fs.existsSync(CHAR_FILE)) return null;
  let file;
  try {
    file = JSON.parse(fs.readFileSync(CHAR_FILE, 'utf8'));
  } catch {
    return null;
  }
  const userBlock = file[userId];
  if (!userBlock) return null;

  const keys = Object.keys(userBlock);
  if (keys.length === 0) return null;
  const charEntry = userBlock[keys[0]]; // first character
  const data = charEntry.data;
  if (!data) return null;

  // Return a normalized object the tracker can use directly
  return {
    name: data.name,
    maxHp: computeMaxHp(data),
    perception: computePerception(data),
    art: charEntry.art ?? null,
    raw: data,
  };
}

// Rolls 1d20 + modifier
function rollInitiative(modifier) {
  const roll = Math.floor(Math.random() * 20) + 1;
  return { total: roll + modifier, roll, mod: modifier };
}

// Builds the turn-order embed
function buildOrderEmbed(enc) {
  const lines = enc.combatants.map((c, i) => {
    const marker = i === enc.turnIndex ? '▶️ ' : '   ';
    const hp = c.isNpc
      ? `(HP hidden)`
      : `${c.hp}/${c.maxHp} HP`;
    const dead = c.hp === 0 ? ' 💀' : '';
    return `${marker}**${c.initiative}** — ${c.name} ${hp}${dead}`;
  });

  return new EmbedBuilder()
    .setTitle(`⚔️ Initiative — Round ${enc.round}`)
    .setDescription(lines.join('\n') || '*No combatants yet*')
    .setColor(0xaa0000);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('init')
    .setDescription('Initiative tracker for combat')
    .addSubcommand(sub =>
      sub.setName('start').setDescription('Start a new encounter in this channel')
    )
    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription('Add your loaded character to initiative')
        .addIntegerOption(opt =>
          opt.setName('bonus')
            .setDescription('Override initiative bonus (defaults to Perception)')
            .setRequired(false)
        )
        .addIntegerOption(opt =>
          opt.setName('result')
            .setDescription('Use this exact initiative result instead of rolling')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('addnpc')
        .setDescription('GM: add a monster/NPC to initiative')
        .addStringOption(opt =>
          opt.setName('name').setDescription('Monster name').setRequired(true)
        )
        .addIntegerOption(opt =>
          opt.setName('bonus').setDescription('Initiative modifier').setRequired(true)
        )
        .addIntegerOption(opt =>
          opt.setName('hp').setDescription('Max HP').setRequired(true)
        )
        .addIntegerOption(opt =>
          opt.setName('result')
            .setDescription('Use exact initiative instead of rolling')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName('next').setDescription('Advance to the next turn')
    )
    .addSubcommand(sub =>
      sub.setName('list').setDescription('Show current initiative order')
    )
    .addSubcommand(sub =>
      sub
        .setName('hp')
        .setDescription('Modify a combatant\'s HP')
        .addStringOption(opt =>
          opt.setName('name').setDescription('Combatant name').setRequired(true)
        )
        .addIntegerOption(opt =>
          opt.setName('change')
            .setDescription('Positive to heal, negative to damage')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('Remove a combatant')
        .addStringOption(opt =>
          opt.setName('name').setDescription('Combatant name').setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('end').setDescription('End the encounter')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const channelId = interaction.channel.id;
    const userId = interaction.user.id;

    // ---------- START ----------
    if (sub === 'start') {
      if (getEncounter(channelId)) {
        return interaction.reply({
          content: '⚠️ An encounter is already active here. Use `/init end` first.',
          ephemeral: true,
        });
      }
      createEncounter(channelId, userId);
      return interaction.reply(
        `⚔️ Combat started! <@${userId}> is the GM.\n` +
        `Players: use \`/init add\` to join. GM: use \`/init addnpc\` for monsters.\n` +
        `When everyone is in, the GM uses \`/init next\` to begin.`
      );
    }

    // For everything else, we need an active encounter
    const enc = getEncounter(channelId);
    if (!enc) {
      return interaction.reply({
        content: '❌ No active encounter. Start one with `/init start`.',
        ephemeral: true,
      });
    }

    // ---------- ADD (player character) ----------
    if (sub === 'add') {
      const char = loadCharacter(userId);
      if (!char) {
        return interaction.reply({
          content: '❌ No loaded character found. Use your character command first.',
          ephemeral: true,
        });
      }

      const bonusOverride = interaction.options.getInteger('bonus');
      const resultOverride = interaction.options.getInteger('result');
      const bonus = bonusOverride ?? char.perception;

      let initiative, rollText;
      if (resultOverride !== null) {
        initiative = resultOverride;
        rollText = `(set to ${resultOverride})`;
      } else {
        const r = rollInitiative(bonus);
        initiative = r.total;
        rollText = `(rolled ${r.roll} + ${r.mod})`;
      }

      // Check for duplicate name
      if (enc.combatants.some(c => c.name.toLowerCase() === char.name.toLowerCase())) {
        return interaction.reply({
          content: `❌ ${char.name} is already in the encounter.`,
          ephemeral: true,
        });
      }

      addCombatant(channelId, {
        name: char.name,
        initiative,
        hp: char.maxHp,
        maxHp: char.maxHp,
        ownerId: userId,
        isNpc: false,
      });

      return interaction.reply(
        `✅ **${char.name}** joined initiative at **${initiative}** ${rollText}.`
      );
    }

    // ---------- ADDNPC (GM only) ----------
    if (sub === 'addnpc') {
      if (userId !== enc.gmId) {
        return interaction.reply({
          content: '❌ Only the GM can add NPCs.',
          ephemeral: true,
        });
      }

      const name = interaction.options.getString('name');
      const bonus = interaction.options.getInteger('bonus');
      const hp = interaction.options.getInteger('hp');
      const resultOverride = interaction.options.getInteger('result');

      if (enc.combatants.some(c => c.name.toLowerCase() === name.toLowerCase())) {
        return interaction.reply({
          content: `❌ A combatant named "${name}" already exists. Use a unique name (e.g. "Goblin 1").`,
          ephemeral: true,
        });
      }

      let initiative, rollText;
      if (resultOverride !== null) {
        initiative = resultOverride;
        rollText = `(set to ${resultOverride})`;
      } else {
        const r = rollInitiative(bonus);
        initiative = r.total;
        rollText = `(rolled ${r.roll} + ${r.mod})`;
      }

      addCombatant(channelId, {
        name,
        initiative,
        hp,
        maxHp: hp,
        ownerId: userId,
        isNpc: true,
      });

      return interaction.reply(
        `👹 **${name}** joined initiative at **${initiative}** ${rollText}.`
      );
    }

    // ---------- NEXT ----------
    if (sub === 'next') {
      if (userId !== enc.gmId) {
        return interaction.reply({
          content: '❌ Only the GM can advance turns.',
          ephemeral: true,
        });
      }
      if (enc.combatants.length === 0) {
        return interaction.reply({
          content: '❌ No combatants in the encounter yet.',
          ephemeral: true,
        });
      }

      advanceTurn(channelId);
      const current = enc.combatants[enc.turnIndex];
      const mention = current.isNpc ? `<@${enc.gmId}>` : `<@${current.ownerId}>`;

      const embed = buildOrderEmbed(enc);
      return interaction.reply({
        content: `🎯 It's **${current.name}**'s turn! ${mention}`,
        embeds: [embed],
      });
    }

    // ---------- LIST ----------
    if (sub === 'list') {
      return interaction.reply({ embeds: [buildOrderEmbed(enc)] });
    }

    // ---------- HP ----------
    if (sub === 'hp') {
      const name = interaction.options.getString('name');
      const change = interaction.options.getInteger('change');
      const combatant = enc.combatants.find(
        c => c.name.toLowerCase() === name.toLowerCase()
      );
      if (!combatant) {
        return interaction.reply({
          content: `❌ No combatant named "${name}".`,
          ephemeral: true,
        });
      }
      // Only the owner or GM can modify HP
      if (combatant.ownerId !== userId && enc.gmId !== userId) {
        return interaction.reply({
          content: '❌ You can only modify HP for your own character (or any, if GM).',
          ephemeral: true,
        });
      }
      modifyHp(channelId, name, change);
      const verb = change >= 0 ? 'healed' : 'took';
      const amount = Math.abs(change);
      const downed = combatant.hp === 0 ? ' 💀 **Down!**' : '';
      return interaction.reply(
        `❤️ **${combatant.name}** ${verb} ${amount} → ${combatant.hp}/${combatant.maxHp} HP${downed}`
      );
    }

    // ---------- REMOVE ----------
    if (sub === 'remove') {
      const name = interaction.options.getString('name');
      const result = removeCombatant(channelId, name);
      if (!result) {
        return interaction.reply({
          content: `❌ No combatant named "${name}".`,
          ephemeral: true,
        });
      }
      return interaction.reply(`🗑️ Removed **${name}** from initiative.`);
    }

    // ---------- END ----------
    if (sub === 'end') {
      if (userId !== enc.gmId) {
        return interaction.reply({
          content: '❌ Only the GM can end the encounter.',
          ephemeral: true,
        });
      }
      deleteEncounter(channelId);
      return interaction.reply('🏁 Combat ended. Well fought!');
    }
  },
};