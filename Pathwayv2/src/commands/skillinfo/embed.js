// ── commands/skillinfo/embed.js ─────────────────────────────────────────────
// Three-page renderer for /skillinfo:
//   • buildSkillOverviewPage  — description + key attribute + character mod
//   • buildSkillActionsPage   — actions this skill unlocks (e.g. Tumble Through)
//   • buildSkillDcsPage       — example DCs + general PF2e DC guide
//
// `charMod` is optional on the Overview page. When the user has a character
// loaded, the embed shows their current modifier and proficiency rank — a
// nice "this is your real number" touch that turns the reference into a
// useful at-the-table tool.

const { EmbedBuilder } = require('discord.js');

const SKILL_COLORS = {
  overview: 0x2a8fbd, // blue   — the skill description
  actions:  0xc45f00, // orange — the actions it unlocks
  dcs:      0x7b5ea7, // purple — DC examples
};

/**
 * Action-cost icon for the skill action list. Note this differs from
 * `lib/format.actionCostIcon` — that one takes integer/symbolic costs,
 * this one takes the display string ("1 action", "2 actions", "1 reaction")
 * that skill action data uses. Falls back to the raw string for unusual
 * costs.
 */
function skillActionCostIcon(cost) {
  if (!cost) return '';
  const c = String(cost).toLowerCase().trim();
  const map = {
    '1 action':    '◆',
    '2 actions':   '◆◆',
    '3 actions':   '◆◆◆',
    'reaction':    '⤾',
    '1 reaction':  '⤾',
    'free action': '◇',
  };
  return map[c] ?? cost;
}

function buildSkillOverviewPage(skill, charMod = null) {
  const embed = new EmbedBuilder()
    .setColor(SKILL_COLORS.overview)
    .setTitle(`🎯 ${skill.name}`)
    .setDescription(skill.description)
    .setFooter({ text: `Page 1/3 • Pathfinder 2e Remaster` });

  // Key attribute + (if character loaded) the character's modifier
  const attrFields = [{ name: '🔑 Key Attribute', value: skill.keyAttribute, inline: true }];
  if (charMod) {
    const sign = charMod.modifier >= 0 ? '+' : '';
    attrFields.push({
      name: '📊 Your Modifier',
      value: `**${sign}${charMod.modifier}** · *${charMod.profLabel}*`,
      inline: true,
    });
  }
  embed.addFields(attrFields);

  // Common uses as a bullet list
  const usesList = (skill.commonUses ?? []).map(u => `• ${u}`).join('\n');
  if (usesList) {
    embed.addFields({ name: '🌟 Common Uses', value: usesList.slice(0, 1024), inline: false });
  }

  return embed;
}

function buildSkillActionsPage(skill) {
  const embed = new EmbedBuilder()
    .setColor(SKILL_COLORS.actions)
    .setTitle(`🎯 ${skill.name} — Actions`)
    .setDescription(`Actions that use **${skill.name}**. Proficiency indicates the minimum rank required.`)
    .setFooter({ text: `Page 2/3 • Pathfinder 2e Remaster` });

  // One field per action — readable and inside Discord's 25-field limit
  // (no skill has more than ~10 actions).
  const actions = skill.actions ?? [];
  for (const action of actions) {
    const costIcon = skillActionCostIcon(action.cost);
    const costPart = costIcon ? `${costIcon} · ` : '';
    const heading = `${costPart}**${action.name}** *(${action.proficiency})*`;
    const body = String(action.description).slice(0, 950);
    embed.addFields({
      name: heading.slice(0, 256),
      value: body,
      inline: false,
    });
  }

  if (actions.length === 0) {
    embed.addFields({ name: '​', value: '*No actions listed for this skill.*', inline: false });
  }

  return embed;
}

function buildSkillDcsPage(skill) {
  const embed = new EmbedBuilder()
    .setColor(SKILL_COLORS.dcs)
    .setTitle(`🎯 ${skill.name} — DCs & Examples`)
    .setDescription(`Example DCs for **${skill.name}** checks. Actual DCs depend on level, circumstance, and GM adjudication.`)
    .setFooter({ text: `Page 3/3 • Pathfinder 2e Remaster` });

  const examples = skill.dcExamples ?? [];
  if (examples.length) {
    const lines = examples.map(e => `**DC ${e.dc}** — ${e.example}`).join('\n');
    embed.addFields({ name: '📐 Example DCs', value: lines.slice(0, 1024), inline: false });
  }

  // General PF2e DC guidance (skill-independent, always the same).
  embed.addFields({
    name: '📊 General DC Guide (by difficulty)',
    value:
      '**Trivial** — usually no check needed\n' +
      '**Easy** — DC -2 (for the task\'s level)\n' +
      '**Standard** — DC for the level\n' +
      '**Hard** — DC +2\n' +
      '**Very Hard** — DC +5\n' +
      '**Incredibly Hard** — DC +10',
    inline: false,
  });

  embed.addFields({
    name: '🎲 Degrees of Success',
    value:
      '🌟 **Crit Success** — roll ≥ DC + 10, or nat 20 one step up\n' +
      '✅ **Success** — roll ≥ DC\n' +
      '❌ **Failure** — roll < DC\n' +
      '💥 **Crit Failure** — roll ≤ DC − 10, or nat 1 one step down',
    inline: false,
  });

  return embed;
}

module.exports = {
  SKILL_COLORS,
  skillActionCostIcon,
  buildSkillOverviewPage,
  buildSkillActionsPage,
  buildSkillDcsPage,
};
