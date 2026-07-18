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
const combat = require('../../state/combat');
const { findAction, searchActions, requiresTarget, formatActionCost } = require('../../rules/authoredActions');
const { run, describeOutcome, describeApplied } = require('../../rules/automation');
const { randomSeed, applyOutcome } = require('../../state/automation');
const { buildUseEmbed } = require('./embed');

/**
 * Bind this invocation to the channel's encounter, when there is one.
 *
 * Two separate lookups, because they answer different questions: which combatant
 * is being AFFECTED (the named target), and whether the acting character is in
 * the fight at all (so their temp HP and conditions land on the tracker's copy
 * rather than nowhere). Either may be absent, and absence is not an error — it
 * just narrows what can be applied, and the report says so.
 */
function resolveCombatScope(interaction, charEntry, targetQuery) {
  const channelId = interaction.channelId;
  const encounter = channelId ? combat.getEncounter(channelId) : null;
  if (!encounter) return { scope: null, targetCombatant: null, error: null };

  const charName = charEntry?.data?.name || charEntry?.name;
  const selfCombatant = charName ? combat.findCombatant(encounter, charName) : null;

  let targetCombatant = null;
  if (targetQuery) {
    targetCombatant = combat.findCombatant(encounter, targetQuery);
    if (!targetCombatant) {
      const names = encounter.combatants.map(c => c.name).join(', ');
      return {
        scope: null,
        targetCombatant: null,
        error: `❌ No combatant matches **"${targetQuery}"** in this encounter.\nIn combat: ${names || '(nobody)'}`,
      };
    }
  }

  return {
    scope: {
      channelId,
      self: selfCombatant?.name ?? null,
      target: targetCombatant?.name ?? null,
    },
    targetCombatant,
    error: null,
  };
}

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

  const targetQuery = interaction.options.getString('target');
  const { scope, targetCombatant, error: scopeError } = resolveCombatScope(interaction, charEntry, targetQuery);
  if (scopeError) return interaction.reply({ content: scopeError, ephemeral: true });
  if (targetQuery && !scope) {
    return interaction.reply({
      content: '❌ There is no encounter in this channel, so there is nothing to target. Start one with `/init`.',
      ephemeral: true,
    });
  }

  // Refuse up front rather than running and reporting "damage failed" — the tree
  // would fail node by node, which is accurate but useless to read.
  if (requiresTarget(action) && !targetCombatant) {
    return interaction.reply({
      content: `❌ **${action.name}** needs a target. Add \`target:<combatant>\`${scope ? '' : ' — and this channel has no encounter yet (`/init`)'}.`,
      ephemeral: true,
    });
  }

  // The seed is generated once, used for the run, and reported in the embed
  // footer: core threads a seeded RNG through every roll precisely so a result
  // can be reproduced, and a seed nobody can see is a seed nobody can use.
  const seed = randomSeed();

  let outcome;
  try {
    outcome = run(charEntry, action.automation, {
      seed,
      targets: targetCombatant ? [targetCombatant] : [],
    });
  } catch (err) {
    console.error('[use] automation failed', { action: action.id, error: err });
    return interaction.reply({
      content: `❌ **${action.name}** failed to run: ${err.message}`,
      ephemeral: true,
    });
  }

  const report = applyOutcome(charEntry, outcome, scope);

  // Only persist when the CHARACTER changed. Combatant mutations are written by
  // state/combat.js on their own path, so a purely combat-scoped run must not
  // trigger a character upsert.
  const characterChanged = report.applied.some(a => !a.who);
  if (characterChanged) {
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
