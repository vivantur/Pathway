const { EmbedBuilder } = require('discord.js');

const { fmt } = require('../../lib/format');
const { rollD20Plus } = require('../../lib/dice');
const { bestiaryDatabase, harvestRewardsDatabase } = require('../../reference/databases');

const HUNT_CREATURE_SKILLS = {
  aberration: ['Occultism'],
  animal: ['Nature'],
  astral: ['Occultism'],
  beast: ['Arcana', 'Nature'],
  celestial: ['Religion'],
  construct: ['Arcana', 'Crafting'],
  dragon: ['Arcana'],
  elemental: ['Arcana', 'Nature'],
  ethereal: ['Occultism'],
  fey: ['Nature'],
  fiend: ['Religion'],
  fungus: ['Nature'],
  humanoid: ['Society'],
  monitor: ['Religion'],
  ooze: ['Occultism'],
  plant: ['Nature'],
  spirit: ['Occultism'],
  undead: ['Religion'],
};

const HUNT_LEVEL_DCS = {
  '-1': 13, 0: 14, 1: 15, 2: 16, 3: 18, 4: 19, 5: 20, 6: 22, 7: 23, 8: 24, 9: 26,
  10: 27, 11: 28, 12: 30, 13: 31, 14: 32, 15: 34, 16: 35, 17: 36, 18: 38, 19: 39,
  20: 40, 21: 42, 22: 44, 23: 46, 24: 48, 25: 50,
};

const HUNT_DIFFICULTY_BUDGETS = { trivial: 40, low: 60, moderate: 80, severe: 120, extreme: 160 };
const HUNT_XP_BY_RELATIVE_LEVEL = new Map([
  [-4, 10], [-3, 15], [-2, 20], [-1, 30], [0, 40], [1, 60], [2, 80], [3, 120], [4, 160],
]);

function huntDcByLevel(level) {
  const lvl = Math.max(-1, Math.min(25, Number(level) || 0));
  return HUNT_LEVEL_DCS[lvl] ?? HUNT_LEVEL_DCS[String(lvl)] ?? 14;
}

function huntMonsterLevel(monster) {
  return monster?.core?.level ?? monster?.summary?.summary?.level ?? monster?.summary?.level ?? monster?.level ?? null;
}

function huntMonsterTraits(monster) {
  return (monster?.core?.traits ?? monster?.traits ?? []).map(t => String(t).toLowerCase());
}

function huntXpForCreature(partyLevel, creatureLevel) {
  const relative = Math.max(-4, Math.min(4, Number(creatureLevel) - Number(partyLevel)));
  return HUNT_XP_BY_RELATIVE_LEVEL.get(relative) ?? 40;
}

function huntTargetCreatureLevel(partyLevel, players, difficulty) {
  const baseBudget = HUNT_DIFFICULTY_BUDGETS[difficulty] ?? HUNT_DIFFICULTY_BUDGETS.moderate;
  const budget = Math.max(10, Math.round(baseBudget * Math.max(1, players) / 4));
  let bestLevel = Number(partyLevel);
  let bestXp = 0;
  for (let rel = -4; rel <= 4; rel++) {
    const xp = HUNT_XP_BY_RELATIVE_LEVEL.get(rel);
    if (xp <= budget && xp >= bestXp) {
      bestXp = xp;
      bestLevel = Number(partyLevel) + rel;
    }
  }
  return Math.max(-1, Math.min(25, bestLevel));
}

function findHuntCandidates({ trait, partyLevel, players, difficulty }) {
  const targetLevel = huntTargetCreatureLevel(partyLevel, players, difficulty);
  const entries = Object.values(bestiaryDatabase).filter(m => {
    const level = huntMonsterLevel(m);
    if (level == null || Number(level) !== targetLevel) return false;
    return huntMonsterTraits(m).includes(trait);
  });
  if (entries.length) return { candidates: entries, targetLevel };

  const fallback = Object.values(bestiaryDatabase)
    .filter(m => {
      const level = huntMonsterLevel(m);
      return level != null
        && Math.abs(Number(level) - targetLevel) <= 1
        && huntMonsterTraits(m).includes(trait);
    })
    .sort((a, b) => Math.abs(huntMonsterLevel(a) - targetLevel) - Math.abs(huntMonsterLevel(b) - targetLevel));
  return { candidates: fallback, targetLevel };
}

function huntDegree(total, die, dc) {
  let degree = total >= dc + 10 ? 2 : total >= dc ? 1 : total <= dc - 10 ? -1 : 0;
  if (die === 20) degree += 1;
  if (die === 1) degree -= 1;
  return Math.max(-1, Math.min(2, degree));
}

function huntDegreeLabel(degree) {
  return degree === 2 ? 'Critical Success'
    : degree === 1 ? 'Success'
    : degree === 0 ? 'Failure'
    : 'Critical Failure';
}

const HARVEST_RARITY_RANK = { common: 0, uncommon: 1, rare: 2, unique: 3 };

function harvestTraitTable(trait) {
  const tables = harvestRewardsDatabase?.creature_types ?? {};
  const wanted = String(trait ?? '').toLowerCase();
  return Object.entries(tables).find(([key]) => key.toLowerCase() === wanted)?.[1] ?? null;
}

function harvestScaleValue(value, level) {
  const base = Number(value) || 0;
  if (base <= 0) return 0;
  const scale = Math.max(1, (Number(level) || 0) / 5);
  return Math.round(base * scale * 100) / 100;
}

function harvestAllowedRarity(degree) {
  if (degree >= 2) return 2;
  if (degree === 1) return 1;
  if (degree === 0) return 0;
  return -1;
}

function pickHarvestRewards(trait, level, degree) {
  const table = harvestTraitTable(trait);
  if (!table?.harvest_items?.length || degree < 0) {
    return { table, items: [], totalValue: 0 };
  }

  const maxRank = harvestAllowedRarity(degree);
  const pool = table.harvest_items.filter(item => {
    const rank = HARVEST_RARITY_RANK[String(item.rarity ?? 'common').toLowerCase()] ?? 0;
    return rank <= maxRank;
  });
  const fallbackPool = table.harvest_items.filter(item => String(item.rarity ?? 'common').toLowerCase() !== 'unique');
  const source = pool.length ? pool : fallbackPool;
  if (!source.length) return { table, items: [], totalValue: 0 };

  const count = degree >= 2 ? Math.min(2, source.length) : 1;
  const shuffled = [...source].sort(() => Math.random() - 0.5);
  const items = shuffled.slice(0, count).map(item => ({
    ...item,
    scaled_value_gp: harvestScaleValue(item.value_gp, level),
  }));
  const valueMultiplier = degree === 0 ? 0.25 : 1;
  const totalValue = Math.round(items.reduce((sum, item) => sum + item.scaled_value_gp, 0) * valueMultiplier * 100) / 100;
  return { table, items, totalValue };
}

function formatHarvestValue(value) {
  return `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} gp`;
}

function buildHuntEmbed({ monster, trait, skill, modifier, roll, total, dc, degree, targetLevel, players, difficulty }) {
  const level = huntMonsterLevel(monster);
  const traits = huntMonsterTraits(monster).map(t => t.charAt(0).toUpperCase() + t.slice(1));
  const xp = huntXpForCreature(targetLevel, level);
  const description = degree >= 1
    ? `The party tracks signs of suitable prey and finds **${monster.name}**. Complete the encounter, then use \`/harvest creature:${monster.name}\`.`
    : `The trail goes cold. The GM can still choose to run a complication, false trail, or different encounter.`;
  return new EmbedBuilder()
    .setColor(degree >= 1 ? 0x2ecc71 : 0x95a5a6)
    .setTitle(`Hunt: ${monster.name}`)
    .setDescription(description)
    .addFields(
      { name: 'Hunt Check', value: `${skill} ${fmt(modifier)}: d20 ${roll.roll} ${fmt(modifier)} = **${total}** vs DC ${dc}\n**${huntDegreeLabel(degree)}**`, inline: false },
      { name: 'Encounter', value: `Party level ${targetLevel}, ${players} player${players === 1 ? '' : 's'}, ${difficulty}\nCreature ${level} (${xp} XP each by PF2e relative-level budget)`, inline: false },
      { name: 'Creature Traits', value: traits.join(', ') || 'None listed', inline: false },
    );
}

function buildHarvestEmbed({ monster, trait, skill, modifier, roll, total, dc, degree }) {
  const level = huntMonsterLevel(monster) ?? 0;
  const rewards = pickHarvestRewards(trait, level, degree);
  const traitName = trait.charAt(0).toUpperCase() + trait.slice(1);
  const reward = degree >= 1
    ? `Recover useful **${traitName}** components worth about **${formatHarvestValue(rewards.totalValue)}**.`
    : degree === 0
      ? `Recover damaged **${traitName}** scraps worth about **${formatHarvestValue(rewards.totalValue)}**.`
      : 'The useful parts are ruined or unsafe to use.';
  const embed = new EmbedBuilder()
    .setColor(degree >= 1 ? 0xf1c40f : 0x7f8c8d)
    .setTitle(`Harvest: ${monster.name}`)
    .setDescription(reward)
    .addFields(
      { name: 'Harvest Check', value: `${skill} ${fmt(modifier)}: d20 ${roll.roll} ${fmt(modifier)} = **${total}** vs DC ${dc}\n**${huntDegreeLabel(degree)}**`, inline: false },
    );
  if (rewards.items.length) {
    embed.addFields({
      name: degree === 0 ? 'Damaged Component' : 'Harvested Components',
      value: rewards.items.map(item => {
        const rarity = String(item.rarity ?? 'common');
        const type = String(item.type ?? 'component').replace(/_/g, ' ');
        return `**${item.name}** (${rarity}, ${type}) - ${formatHarvestValue(item.scaled_value_gp)}\n${item.use ?? 'Useful as a crafting, alchemical, spell, or trophy component.'}`;
      }).join('\n\n').slice(0, 1024),
      inline: false,
    });
    const sources = [...new Set(rewards.items.map(item => item.source).filter(Boolean))];
    if (sources.length) {
      embed.addFields({ name: 'Source Notes', value: sources.join('; ').slice(0, 1024), inline: false });
    }
  } else {
    embed.addFields({
      name: 'Suggested Use',
      value: 'Use as crafting materials, alchemical ingredients, trophies, spell components, or sellable monster parts at GM discretion.',
      inline: false,
    });
  }
  return embed;
}

module.exports = {
  HUNT_CREATURE_SKILLS,
  rollD20Plus,
  huntDcByLevel,
  huntMonsterLevel,
  huntMonsterTraits,
  findHuntCandidates,
  huntDegree,
  buildHuntEmbed,
  buildHarvestEmbed,
};
