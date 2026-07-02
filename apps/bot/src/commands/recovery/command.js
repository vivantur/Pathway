const { EmbedBuilder } = require('discord.js');
const characterState = require('../../state/characters');

const OUTCOME_LABELS = {
  'crit-success': 'Critical Success',
  success: 'Success',
  failure: 'Failure',
  'crit-failure': 'Critical Failure',
};

function rollRecoveryForCharacter(charEntry) {
  if (!charEntry || (charEntry.dying ?? 0) <= 0) return null;

  const dyingBefore = Math.max(0, Math.floor(charEntry.dying ?? 0));
  const wounded = Math.max(0, Math.floor(charEntry.wounded ?? 0));
  const doomed = Math.max(0, Math.floor(charEntry.doomed ?? charEntry.data?.doomed ?? 0));
  const maxDying = Math.max(1, 4 - doomed);
  const dc = 10 + dyingBefore;
  const roll = Math.floor(Math.random() * 20) + 1;

  // Degree of success from the DC bands first...
  let outcome;
  if (roll >= dc + 10) {
    outcome = 'crit-success';
  } else if (roll >= dc) {
    outcome = 'success';
  } else if (roll <= dc - 10) {
    outcome = 'crit-failure';
  } else {
    outcome = 'failure';
  }

  // ...then a natural 20 shifts the result one step better and a natural 1 one
  // step worse (PF2e). A nat 20 is NOT an automatic critical success.
  const DEGREES = ['crit-failure', 'failure', 'success', 'crit-success'];
  let degreeIdx = DEGREES.indexOf(outcome);
  if (roll === 20) degreeIdx = Math.min(DEGREES.length - 1, degreeIdx + 1);
  else if (roll === 1) degreeIdx = Math.max(0, degreeIdx - 1);
  outcome = DEGREES[degreeIdx];

  const DELTA_BY_OUTCOME = {
    'crit-success': -2,
    success: -1,
    failure: 1,
    'crit-failure': 2,
  };
  const baseDelta = DELTA_BY_OUTCOME[outcome];

  let delta = baseDelta;
  let woundedAdded = 0;
  if (baseDelta > 0 && wounded > 0) {
    delta += wounded;
    woundedAdded = wounded;
  }

  const dyingAfterRaw = dyingBefore + delta;
  let dyingAfter = dyingAfterRaw;
  let died = false;
  let stabilized = false;

  if (dyingAfter >= maxDying) {
    died = true;
    dyingAfter = maxDying;
    charEntry.dying = maxDying;
    characterState.setCharacterHp(charEntry, 0);
  } else if (dyingAfter <= 0) {
    stabilized = true;
    dyingAfter = 0;
    charEntry.dying = 0;
    charEntry.wounded = wounded + 1;
    characterState.setCharacterHp(charEntry, 0);
  } else {
    charEntry.dying = dyingAfter;
    characterState.setCharacterHp(charEntry, 0);
  }

  let narration;
  if (died) {
    narration = doomed > 0
      ? `Death threshold is Dying ${maxDying} because of Doomed ${doomed}.`
      : `Reached Dying ${maxDying}.`;
  } else if (stabilized) {
    narration = `Dying cleared. Wounded increases to ${charEntry.wounded}. The character remains unconscious at 0 HP until healed.`;
  } else if (delta < 0) {
    narration = `Dying reduced from ${dyingBefore} to ${dyingAfter}.`;
  } else {
    const woundedNote = woundedAdded > 0 ? ` (+${baseDelta} base, +${woundedAdded} from Wounded ${wounded})` : '';
    narration = `Dying increased from ${dyingBefore} to ${dyingAfter}${woundedNote}.`;
  }

  return {
    roll,
    dc,
    outcome,
    baseDelta,
    delta,
    dyingBefore,
    dyingAfter,
    wounded,
    woundedAfter: charEntry.wounded ?? wounded,
    woundedAdded,
    doomed,
    maxDying,
    died,
    stabilized,
    narration,
  };
}

function buildRecoveryEmbed(charEntry, result) {
  const name = charEntry.name ?? charEntry.data?.name ?? 'Character';
  const color = result.died
    ? 0x8b0000
    : result.stabilized
      ? 0x2ecc71
      : result.delta < 0
        ? 0x27ae60
        : 0xe74c3c;

  const lines = [
    `Flat check vs DC ${result.dc}: 1d20 (${result.roll})`,
    `**${OUTCOME_LABELS[result.outcome] ?? result.outcome}**`,
  ];
  if (result.doomed > 0) {
    lines.push(`Doomed ${result.doomed}: death threshold is Dying ${result.maxDying}.`);
  }
  lines.push(result.narration);
  lines.push(`Status: HP ${characterState.getCharacterHp(charEntry)}/${characterState.computeCharMaxHp(charEntry)} · Dying ${charEntry.dying ?? 0} · Wounded ${charEntry.wounded ?? 0}`);

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${name}'s Recovery Check`)
    .setDescription(lines.join('\n'));
  if (charEntry.art) embed.setThumbnail(charEntry.art);
  return embed;
}

async function execute(interaction) {
  const characters = characterState.getAll();
  const { error, charKey, char: charEntry } = characterState.resolveChar(
    interaction.user.id,
    interaction.options.getString('character'),
    characters
  );
  if (error) return interaction.reply({ content: error, ephemeral: true });

  const setDying = interaction.options.getInteger('set_dying');
  if (setDying !== null && setDying !== undefined) {
    charEntry.dying = Math.max(0, Math.min(4, setDying));
    if (charEntry.dying > 0) characterState.setCharacterHp(charEntry, 0);
  }

  if ((charEntry.dying ?? 0) <= 0) {
    return interaction.reply({
      content: `**${charEntry.name}** is not dying. Use \`set_dying:1\` if you need to start an out-of-initiative recovery check.`,
      ephemeral: true,
    });
  }

  const result = rollRecoveryForCharacter(charEntry);
  if (!result) {
    return interaction.reply({ content: 'Could not roll recovery for that character.', ephemeral: true });
  }

  characters[interaction.user.id][charKey] = charEntry;
  await characterState.saveAll(characters);

  return interaction.reply({ embeds: [buildRecoveryEmbed(charEntry, result)] });
}

module.exports = {
  name: 'recovery',
  execute,
};
