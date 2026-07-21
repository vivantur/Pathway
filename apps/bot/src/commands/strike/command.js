// ── commands/strike/command.js ──────────────────────────────────────────────
//
// /strike — make a weapon Strike through the effects engine. The player analogue
// of /mattack (monster attack): pick one of your character's weapons and the bot
// runs it through core's Strike model and Layer-2 interpreter, exactly the host
// /use already uses.
//
// It is deliberately thin, like /use. It resolves the character and weapon, hands
// the weapon to `rules/strikeAdapter` (which delegates every number to
// @pathway/core), runs the resulting tree through `rules/automation`, applies the
// mutations via `state/automation`, and renders. No rules math lives here — if any
// starts to, it belongs in core.
//
// A Strike resolves against an AC, so the command needs one of:
//   • target:<combatant> — a combatant in this channel's encounter. Damage lands
//     on it through the tracker's `applyHp` (temp HP + dying already handled there).
//   • ac:<number>        — an explicit AC, no encounter needed. The attack is
//     rolled and the damage is shown, but nothing is applied (there is no one to
//     apply it to). This is the "just roll it at the table" path.

const characterState = require('../../state/characters');
const combat = require('../../state/combat');
const core = require('@pathway/core');
const { buildStrike } = require('../../rules/strikeAdapter');
const { findRider, listRiders } = require('../../rules/strikeRiders');
const { run, describeOutcome, describeApplied } = require('../../rules/automation');
const { randomSeed, applyOutcome } = require('../../state/automation');
const { buildStrikeEmbed } = require('./embed');

// MAP choices → the prior-attack count core reads to pick the penalty.
const MAP_PRIOR = { first: 0, second: 1, third: 2 };

/** Find one of the character's weapons by name: exact → prefix → substring. */
function findWeapon(weapons, query) {
  const q = String(query ?? '').toLowerCase().trim();
  if (!q) return null;
  const nameOf = (w) => String(w.display ?? w.name ?? '').toLowerCase();
  return (
    weapons.find(w => nameOf(w) === q) ??
    weapons.find(w => nameOf(w).startsWith(q)) ??
    weapons.find(w => nameOf(w).includes(q)) ??
    null
  );
}

/**
 * Resolve what this Strike is rolled against, and where its mutations may land.
 *
 * Returns `{ targetLike, scope, error }`. `targetLike` is a combatant (or a
 * phantom `{ name, ac }` for the ac-only path) fed to core as the target; `scope`
 * binds mutations to the encounter when there is one (null for the ac-only path,
 * so damage is reported rather than applied).
 */
function resolveStrikeTarget(interaction, charEntry, targetQuery, ac) {
  if (targetQuery) {
    const channelId = interaction.channelId;
    const encounter = channelId ? combat.getEncounter(channelId) : null;
    if (!encounter) {
      return { error: '❌ There is no encounter in this channel to target. Start one with `/init`, or pass `ac:<number>` instead.' };
    }
    const targetCombatant = combat.findCombatant(encounter, targetQuery);
    if (!targetCombatant) {
      const names = encounter.combatants.map(c => c.name).join(', ');
      return { error: `❌ No combatant matches **"${targetQuery}"** in this encounter.\nIn combat: ${names || '(nobody)'}` };
    }
    const charName = charEntry?.data?.name || charEntry?.name;
    const selfCombatant = charName ? combat.findCombatant(encounter, charName) : null;
    return {
      targetLike: targetCombatant,
      scope: { channelId, self: selfCombatant?.name ?? null, target: targetCombatant.name },
    };
  }

  if (Number.isFinite(ac)) {
    // A phantom combatant: core reads only its AC. No scope, so its damage is
    // reported, not applied — there is no tracked creature behind it.
    return { targetLike: { name: `AC ${ac}`, ac }, scope: null };
  }

  return { error: '❌ A Strike resolves against an AC. Add `target:<combatant>` (in an encounter) or `ac:<number>`.' };
}

async function execute(interaction) {
  const characters = characterState.getAll();
  const { error, charKey, char: charEntry } = characterState.resolveChar(
    interaction.user.id,
    interaction.options.getString('character'),
    characters,
  );
  if (error) return interaction.reply({ content: error, ephemeral: true });

  const weapons = characterState.getCharacterWeapons(charEntry);
  if (weapons.length === 0) {
    return interaction.reply({ content: `❌ **${charEntry?.data?.name ?? 'This character'}** has no weapons to Strike with.`, ephemeral: true });
  }
  const weapon = findWeapon(weapons, interaction.options.getString('weapon'));
  if (!weapon) {
    const known = weapons.slice(0, 15).map(w => `\`${w.display ?? w.name}\``).join(', ');
    return interaction.reply({ content: `❌ No weapon matches **"${interaction.options.getString('weapon')}"**.\nYou have: ${known}`, ephemeral: true });
  }

  const targetQuery = interaction.options.getString('target');
  const ac = interaction.options.getInteger('ac');
  const { targetLike, scope, error: targetError } = resolveStrikeTarget(interaction, charEntry, targetQuery, ac);
  if (targetError) return interaction.reply({ content: targetError, ephemeral: true });

  // Build the strike. The adapter delegates every number to core; a failure here
  // means the weapon's damage was unreadable, which we surface rather than guess.
  const actor = core.resolvedFromPathbuilder(charEntry?.data ?? {});
  const built = buildStrike(weapon, actor);
  if (built.error) {
    return interaction.reply({ content: `❌ Could not read **${weapon.display ?? weapon.name}**: ${built.error}`, ephemeral: true });
  }

  // Optional RIDERS — keywords tacked onto the Strike (Avrae-style). A single Strike
  // routinely carries several (Power Attack + a Rooting rune + …), so this takes a
  // comma-separated list and composes the whole SET onto the base tree via core.
  const riderQuery = interaction.options.getString('rider');
  const riders = [];
  if (riderQuery) {
    for (const token of riderQuery.split(',').map(t => t.trim()).filter(Boolean)) {
      const r = findRider(token);
      if (!r) {
        return interaction.reply({ content: `❌ No rider matches **"${token}"**. Known: \`intimidating\`, \`snagging\`.`, ephemeral: true });
      }
      riders.push(r);
    }
  }

  const seed = randomSeed();
  const attacksThisTurn = MAP_PRIOR[interaction.options.getString('map') ?? 'first'] ?? 0;
  // With riders, compose the set onto the base strike; without, run the plain strike.
  const nodes = riders.length ? core.composeStrikeRiders(built.strike, riders, { agile: built.agile }) : built.nodes;

  let outcome;
  try {
    outcome = run(charEntry, nodes, { seed, targets: [targetLike], attacksThisTurn });
  } catch (err) {
    console.error('[strike] automation failed', { weapon: weapon.name, riders: riders.map(r => r.id), error: err });
    return interaction.reply({ content: `❌ **${weapon.display ?? weapon.name}** failed to run: ${err.message}`, ephemeral: true });
  }

  const report = applyOutcome(charEntry, outcome, scope);

  // Only persist when the CHARACTER itself changed (it does not, for a Strike —
  // damage lands on the target — but a future rider might). Combatant mutations
  // are written by state/combat.js on their own path.
  if (report.applied.some(a => !a.who)) {
    characters[interaction.user.id][charKey] = charEntry;
    await characterState.saveAll(characters);
  }

  return interaction.reply({
    embeds: [buildStrikeEmbed({
      charEntry,
      weapon,
      built,
      outcome,
      narration: describeOutcome(outcome),
      applied: describeApplied(report),
      targetName: targetLike?.name ?? null,
      targetApplied: report.applied.some(a => a.kind === 'damage' || a.kind === 'healing'),
      riders,
      seed,
    })],
  });
}

/** Autocomplete: the character's weapons for `weapon:`, the rider catalog for `rider:`. */
async function autocomplete(interaction) {
  const focusedOpt = interaction.options.getFocused(true);
  const focused = String(focusedOpt?.value ?? '').toLowerCase();

  if (focusedOpt?.name === 'rider') {
    // `rider:` is comma-separated, so complete only the LAST token and keep the rest.
    const parts = focused.split(',');
    const prefix = parts.slice(0, -1).join(',');
    const head = parts.length > 1 ? `${prefix},` : '';
    const partial = (parts[parts.length - 1] ?? '').trim();
    const choices = listRiders()
      .filter(r => r.keyword.includes(partial) || r.name.toLowerCase().includes(partial))
      .slice(0, 25)
      .map(r => ({ name: `${r.name} (${r.keyword})`.slice(0, 100), value: `${head}${r.keyword}`.slice(0, 100) }));
    return interaction.respond(choices);
  }

  let weapons = [];
  try {
    const characters = characterState.getAll();
    const { char: charEntry } = characterState.resolveChar(
      interaction.user.id,
      interaction.options.getString('character'),
      characters,
    );
    if (charEntry) weapons = characterState.getCharacterWeapons(charEntry);
  } catch { /* no character resolved yet — offer nothing */ }

  const choices = weapons
    .map(w => String(w.display ?? w.name ?? '').trim())
    .filter(Boolean)
    .filter(n => n.toLowerCase().includes(focused))
    .slice(0, 25)
    .map(n => ({ name: n.slice(0, 100), value: n.slice(0, 100) }));
  return interaction.respond(choices);
}

module.exports = {
  name: 'strike',
  execute,
  autocomplete,
};
