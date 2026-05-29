// commands/combatV2.js
// Slash command builders for the combat v2 surface. These are not wired into
// deploy.js yet; keeping them here lets us iterate without disturbing v1.

const { SlashCommandBuilder } = require('discord.js');

function combatCommands() {
  const init = new SlashCommandBuilder()
    .setName('init')
    .setDescription('Combat v2 initiative tracker.')
    .addSubcommand(s => s.setName('start').setDescription('Start combat in this channel.'))
    .addSubcommand(s => s.setName('end').setDescription('End combat in this channel.'))
    .addSubcommand(s => s.setName('next').setDescription('Advance to the next turn.'))
    .addSubcommand(s => s.setName('prev').setDescription('Move back to the previous turn.'))
    .addSubcommand(s => s.setName('view').setDescription('Show the pinned combat view.'))
    .addSubcommand(s => s.setName('add')
      .setDescription('Add a PC, monster, NPC, or companion at a specific initiative.')
      .addStringOption(o => o.setName('kind').setDescription('What to add.').setRequired(true)
        .addChoices(
          { name: 'Player', value: 'pc' },
          { name: 'Monster', value: 'monster' },
          { name: 'NPC', value: 'npc' },
          { name: 'Companion', value: 'companion' },
        ))
      .addStringOption(o => o.setName('name').setDescription('Name or lookup query.').setRequired(true).setAutocomplete(true))
      .addNumberOption(o => o.setName('initiative').setDescription('Specific initiative count.').setRequired(false))
      .addIntegerOption(o => o.setName('count').setDescription('How many copies to add.').setRequired(false).setMinValue(1).setMaxValue(50))
      .addStringOption(o => o.setName('group').setDescription('Shared group name/initiative label.').setRequired(false)));

  const i = new SlashCommandBuilder()
    .setName('i')
    .setDescription('Avrae-style combat actions.')
    .addSubcommand(s => s.setName('join').setDescription('Join the active combat.').addNumberOption(o => o.setName('initiative').setDescription('Specific initiative result.').setRequired(false)))
    .addSubcommand(s => s.setName('attack').setDescription('Attack from in or out of initiative.')
      .addStringOption(o => o.setName('name').setDescription('Attack name. Omit for primary/current attack.').setRequired(false).setAutocomplete(true))
      .addStringOption(o => o.setName('target').setDescription('Target combatant.').setRequired(false).setAutocomplete(true))
      .addIntegerOption(o => o.setName('n').setDescription('Number of attack rolls.').setRequired(false).setMinValue(1).setMaxValue(10))
      .addStringOption(o => o.setName('args').setDescription('Flags like adv, dis, map:1, hidden, public.').setRequired(false)))
    .addSubcommand(s => s.setName('cast').setDescription('Cast a spell from in or out of initiative.')
      .addStringOption(o => o.setName('spell').setDescription('Spell name.').setRequired(true).setAutocomplete(true))
      .addStringOption(o => o.setName('target').setDescription('Target combatant(s).').setRequired(false).setAutocomplete(true))
      .addStringOption(o => o.setName('args').setDescription('Flags like rank:3, dc:22, hidden, public.').setRequired(false)))
    .addSubcommand(s => s.setName('skill').setDescription('Roll a skill.')
      .addStringOption(o => o.setName('skill').setDescription('Skill name.').setRequired(true).setAutocomplete(true))
      .addStringOption(o => o.setName('args').setDescription('Flags like dc:20, adv, dis.').setRequired(false)))
    .addSubcommand(s => s.setName('save').setDescription('Roll a saving throw.')
      .addStringOption(o => o.setName('save').setDescription('Save type.').setRequired(true)
        .addChoices({ name: 'Fortitude', value: 'fort' }, { name: 'Reflex', value: 'ref' }, { name: 'Will', value: 'will' }))
      .addStringOption(o => o.setName('args').setDescription('Flags like dc:20, basic, hidden.').setRequired(false)))
    .addSubcommand(s => s.setName('hp').setDescription('Heal or damage a combatant.')
      .addStringOption(o => o.setName('target').setDescription('Target name.').setRequired(true).setAutocomplete(true))
      .addIntegerOption(o => o.setName('amount').setDescription('Positive heals, negative damages.').setRequired(true)))
    .addSubcommand(s => s.setName('thp').setDescription('Add temporary HP.')
      .addStringOption(o => o.setName('target').setDescription('Target name.').setRequired(true).setAutocomplete(true))
      .addIntegerOption(o => o.setName('amount').setDescription('Temporary HP amount.').setRequired(true).setMinValue(0)))
    .addSubcommand(s => s.setName('effect').setDescription('Add or update an initiative effect.')
      .addStringOption(o => o.setName('target').setDescription('Target name.').setRequired(true).setAutocomplete(true))
      .addStringOption(o => o.setName('name').setDescription('Effect name.').setRequired(true))
      .addIntegerOption(o => o.setName('duration').setDescription('Duration in rounds.').setRequired(false)))
    .addSubcommand(s => s.setName('remove').setDescription('Remove a combatant or effect.')
      .addStringOption(o => o.setName('target').setDescription('Combatant name.').setRequired(true).setAutocomplete(true))
      .addStringOption(o => o.setName('effect').setDescription('Effect name, if removing an effect.').setRequired(false)))
    .addSubcommand(s => s.setName('attacks').setDescription('List available attacks for the current actor or a named actor.')
      .addStringOption(o => o.setName('actor').setDescription('Actor name.').setRequired(false).setAutocomplete(true)));

  return [init, i];
}

module.exports = { combatCommands };
