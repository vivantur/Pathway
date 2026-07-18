// ── commands/use/command.js ─────────────────────────────────────────────────
//
// /use — run an authored automation tree against your active character.
//
// This is the command that closes the loop: core computes the rules, the bot's
// host adapts a stored character into an execution context, the mutations are
// written back, and the player sees both what happened and what could not.
//
// It is deliberately thin. It resolves the character, picks the action, and
// renders — every rule, roll, and number comes from `@pathway/core` by way of
// rules/automation.js. If logic starts accumulating here, it belongs in core.

const characterState = require('../../state/characters');
const { findAction, searchActions, formatActionCost } = require('../../rules/authoredActions');
const { run, describeOutcome, describeApplied } = require('../../rules/automation');
const { randomSeed, applyOutcome } = require('../../state/automation');
const { buildUseEmbed } = require('./embed');

async function execute(interaction) {
  const characters = characterState.getAll();
  const { error, charKey, char: charEntry } = characterState.resolveChar(
    interaction.user.id,
    interaction.options.getString('character'),
    characters,
  );
  if (error) return interaction.reply({ content: error, ephemeral: true });

  const query = interaction.options.getString('action');
  const action = findAction(query);
  if (!action) {
    const known = searchActions('', 10).map(a => `\`${a.name}\``).join(', ');
    return interaction.reply({
      content: `❌ No authored action matches **"${query}"**.\nAvailable: ${known}`,
      ephemeral: true,
    });
  }
  if (!action.automation || action.automation.length === 0) {
    return interaction.reply({
      content: `❌ **${action.name}** has no automation to run — it is descriptive only.`,
      ephemeral: true,
    });
  }

  // The seed is generated once, used for the run, and reported in the embed
  // footer: core threads a seeded RNG through every roll precisely so a result
  // can be reproduced, and a seed nobody can see is a seed nobody can use.
  const seed = randomSeed();

  let outcome;
  try {
    outcome = run(charEntry, action.automation, { seed });
  } catch (err) {
    console.error('[use] automation failed', { action: action.id, error: err });
    return interaction.reply({
      content: `❌ **${action.name}** failed to run: ${err.message}`,
      ephemeral: true,
    });
  }

  const report = applyOutcome(charEntry, outcome);

  // Only persist when something actually changed — a pure-narration action
  // (a roll, a text node) has no reason to write to Supabase.
  if (report.applied.length > 0) {
    characters[interaction.user.id][charKey] = charEntry;
    await characterState.saveAll(characters);
  }

  return interaction.reply({
    embeds: [
      buildUseEmbed({
        charEntry,
        action,
        costLabel: formatActionCost(action.actionCost),
        narration: describeOutcome(outcome),
        applied: describeApplied(report),
        seed,
      }),
    ],
  });
}

/** Autocomplete over the authored catalog. */
async function autocomplete(interaction) {
  const focused = interaction.options.getFocused();
  return interaction.respond(
    searchActions(focused, 25).map(a => ({ name: `${a.name} ${formatActionCost(a.actionCost)}`.trim(), value: a.id })),
  );
}

module.exports = {
  name: 'use',
  execute,
  autocomplete,
};
