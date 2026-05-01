// systems/combatV2/render.js
// Discord embed rendering for combat v2.

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const { currentCombatant } = require('./state');
const { degreeLabel, fmt } = require('./rolls');

const PAGE_SIZE = 5;

function hpDisplay(combatant, { gmView = false } = {}) {
  if (combatant.hidden && !gmView) return 'HP hidden';
  const temp = combatant.tempHp ? ` +${combatant.tempHp} temp` : '';
  return `${combatant.hp}/${combatant.maxHp}${temp}`;
}

function combatantLine(combatant, index, active, opts = {}) {
  const marker = active ? '>' : `${index + 1}.`;
  const group = combatant.groupId ? ` [${combatant.groupId}]` : '';
  const ac = combatant.hidden && !opts.gmView ? '' : (combatant.ac != null ? ` · AC ${combatant.ac}` : '');
  const effects = combatant.effects?.length
    ? ` · ${combatant.effects.map(e => e.duration != null ? `${e.name}(${e.duration})` : e.name).join(', ')}`
    : '';
  return `${marker} **${combatant.initiative}** ${combatant.name}${group} · ${hpDisplay(combatant, opts)}${ac}${effects}`;
}

function pageForTurn(encounter) {
  return Math.floor((encounter.turnIndex ?? 0) / PAGE_SIZE);
}

function renderEncounter(encounter, { page = pageForTurn(encounter), gmView = false } = {}) {
  const totalPages = Math.max(1, Math.ceil(encounter.combatants.length / PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const start = safePage * PAGE_SIZE;
  const shown = encounter.combatants.slice(start, start + PAGE_SIZE);
  const current = currentCombatant(encounter);
  const description = shown.length
    ? shown.map((c, i) => combatantLine(c, start + i, c.id === current?.id, { gmView })).join('\n\n')
    : '*No combatants yet.*';
  const embed = new EmbedBuilder()
    .setColor(0x8b0000)
    .setTitle(`${encounter.name} · Round ${encounter.round}`)
    .setDescription(description)
    .setFooter({ text: `${encounter.combatants.length} combatants · Page ${safePage + 1}/${totalPages}${gmView ? ' · GM view' : ''}` });
  return { embed, page: safePage, totalPages };
}

function pageButtons(channelId, page, totalPages) {
  if (totalPages <= 1) return [];
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`cv2_page_${channelId}_${Math.max(0, page - 1)}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel('Prev')
        .setDisabled(page <= 0),
      new ButtonBuilder()
        .setCustomId(`cv2_page_${channelId}_${Math.min(totalPages - 1, page + 1)}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel('Next')
        .setDisabled(page >= totalPages - 1),
    ),
  ];
}

function renderAttackResult(result) {
  const attack = result.attack;
  const target = result.target;
  const attackParts = [
    `1d20 (${result.die})`,
    fmt(result.attackBonus),
    result.mapPenalty ? fmt(result.mapPenalty) : null,
    result.bonus ? fmt(result.bonus) : null,
    result.effectBonus ? fmt(result.effectBonus) : null,
  ].filter(Boolean);
  const lines = [
    `**Attack Roll**`,
    `${attackParts.join(' ')} = **${result.total}**`,
  ];
  if (target && result.ac != null) lines.push(`vs **${target.name}** AC ${result.ac}: **${degreeLabel(result.degree)}**`);
  if (result.damageRoll && ['success', 'criticalSuccess'].includes(result.degree ?? 'success')) {
    const crit = result.degree === 'criticalSuccess' ? ' (crit x2)' : '';
    lines.push('', `**Damage${crit}**`, `${result.damageRoll.display} = **${result.finalDamage} ${attack.damageType ?? ''}**`);
    if (result.defenseNotes.length) lines.push(`*${result.defenseNotes.join(' · ')}*`);
  }
  return new EmbedBuilder()
    .setColor(0xc0392b)
    .setTitle(`${attack.name}`)
    .setDescription(lines.join('\n'));
}

module.exports = {
  PAGE_SIZE,
  renderEncounter,
  pageButtons,
  renderAttackResult,
};
