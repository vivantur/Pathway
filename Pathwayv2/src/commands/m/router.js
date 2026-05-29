function routeMonsterAlias(interaction) {
  const group = interaction.options.getSubcommandGroup(false);
  if (group === 'roll') return 'monsterroll';
  if (group === 'attack') return 'monsterattack';
  if (group === 'edit') return 'monsteredit';
  if (group === 'add') return 'monsteradd';

  const sub = interaction.options.getSubcommand(false);
  if (sub === 'show') return 'monster';
  if (sub === 'save' || sub === 'skill') return 'monsterroll';
  if (sub === 'cast') return 'monstercast';
  if (sub === 'ability') return 'monsterability';
  if (sub === 'attacks') return 'monsterattacks';

  return 'm';
}

module.exports = { routeMonsterAlias };
