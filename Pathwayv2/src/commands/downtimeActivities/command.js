const { EmbedBuilder } = require('discord.js');

const characterState = require('../../state/characters');
const downtimeState = require('../../state/downtime');
const downtime = require('../downtime');
const { fmt, calcProfNum } = require('../../lib/format');

const { resolveChar } = characterState;

function loadCharacters() {
  return characterState.getAll();
}

function loadDowntime() {
  return downtimeState.getAll();
}

async function saveDowntime(data) {
  await downtimeState.saveAll(data);
}

const DOWNTIME_SKILL_ABILITIES = {
  acrobatics: 'dex',
  arcana: 'int',
  athletics: 'str',
  crafting: 'int',
  deception: 'cha',
  diplomacy: 'cha',
  intimidation: 'cha',
  medicine: 'wis',
  nature: 'wis',
  occultism: 'int',
  performance: 'cha',
  perception: 'wis',
  religion: 'wis',
  society: 'int',
  stealth: 'dex',
  survival: 'wis',
  thievery: 'dex',
};

function normalizeDowntimeSkillName(skillName) {
  return String(skillName ?? '').trim().toLowerCase().replace(/\s+/g, '-');
}

function getDowntimeSkillModifier(character, skillName) {
  const raw = String(skillName ?? '').trim();
  const key = normalizeDowntimeSkillName(raw);
  const baseSkillKey = key.endsWith('-lore') || key === 'lore' ? 'lore' : key;
  const abilityKey = DOWNTIME_SKILL_ABILITIES[baseSkillKey] ?? (key.includes('lore') ? 'int' : null);
  if (!abilityKey) return { error: `Unknown skill "${raw}".` };

  const abilities = character.abilities ?? {};
  const proficiencies = character.proficiencies ?? {};
  const level = Number(character.level ?? 1);
  const abilityMod = Math.floor(((abilities[abilityKey] ?? 10) - 10) / 2);
  const profValue = proficiencies[key]
    ?? proficiencies[baseSkillKey]
    ?? proficiencies[String(raw).toLowerCase()]
    ?? 0;
  const total = abilityMod + calcProfNum(Number(profValue) || 0, level);
  return {
    skill: raw,
    key,
    abilityKey,
    abilityMod,
    profNum: Number(profValue) || 0,
    profRank: downtime.profRankKey(Number(profValue) || 0),
    total,
  };
}

function downtimeRoll(total, dc, bonus = 0) {
  const die = Math.floor(Math.random() * 20) + 1;
  const finalTotal = die + total + bonus;
  let degree = finalTotal >= dc + 10 ? 'criticalSuccess'
    : finalTotal >= dc ? 'success'
    : finalTotal <= dc - 10 ? 'criticalFailure'
    : 'failure';
  if (die === 20) {
    degree = degree === 'criticalFailure' ? 'failure' : degree === 'failure' ? 'success' : 'criticalSuccess';
  } else if (die === 1) {
    degree = degree === 'criticalSuccess' ? 'success' : degree === 'success' ? 'failure' : 'criticalFailure';
  }
  return { die, total: finalTotal, degree };
}

function downtimeDegreeLabel(degree) {
  return {
    criticalSuccess: 'Critical Success',
    success: 'Success',
    failure: 'Failure',
    criticalFailure: 'Critical Failure',
  }[degree] ?? degree;
}

function downtimeDcFromOptions(interaction, defaultLevel = 0, defaultDifficulty = 'normal') {
  const dc = interaction.options.getInteger('dc');
  if (dc) return dc;
  const level = interaction.options.getInteger('level') ?? defaultLevel;
  const difficulty = interaction.options.getString('difficulty') ?? defaultDifficulty;
  return downtime.taskLevelDC(level, difficulty);
}

function spendDowntimeDaysOrReply(store, interaction, userId, charKey, charName, days, reason) {
  downtime.accrue(store, userId, charKey);
  const result = downtime.spend(store, userId, charKey, days, reason, userId);
  if (!result.ok) {
    return { ok: false, reply: { content: `Cannot spend downtime: ${result.reason}` } };
  }
  return { ok: true, balance: result.balance };
}

const SIMPLE_DOWNTIME_COMMANDS = new Set([
  'learnname', 'subsist', 'bribe', 'forgedocuments', 'gaincontact', 'gossip',
  'scout', 'disguise', 'research', 'study',
]);

// ── Bag helpers ───────────────────────────────────────────────────────────────
// Phase 2: state/bags owns the cache + Realtime — thin delegations here.

const DOWNTIME_ACTIVITY_COMMANDS = new Set([
  'income', 'forgery', 'craft', 'longrest', 'treatdisease', 'cram', 'retrain',
  ...SIMPLE_DOWNTIME_COMMANDS,
]);

function handles(commandName) {
  return DOWNTIME_ACTIVITY_COMMANDS.has(commandName);
}

async function execute(interaction) {
  const commandName = interaction.commandName;
if (commandName === 'income') {
    const userId = interaction.user.id;
    const characters = loadCharacters();
    const { error, charKey, char: charEntry } = resolveChar(userId, interaction.options.getString('character'), characters);
    if (error) return interaction.reply({ content: error });
    const c = charEntry.data ?? {};
    const skillName = interaction.options.getString('skill');
    const taskLevel = interaction.options.getInteger('task_level');
    const days = interaction.options.getInteger('days') ?? 1;
    const bonus = interaction.options.getInteger('bonus') ?? 0;
    const skill = getDowntimeSkillModifier(c, skillName);
    if (skill.error) return interaction.reply({ content: skill.error });
    if (skill.profNum === 0) return interaction.reply({ content: `${c.name ?? 'This character'} must be trained in ${skill.skill} to Earn Income.` });

    const store = loadDowntime();
    const spend = spendDowntimeDaysOrReply(store, interaction, userId, charKey, c.name ?? 'Character', days, `Earn Income (${skill.skill})`);
    if (!spend.ok) return interaction.reply(spend.reply);
    const dc = downtime.taskLevelDC(taskLevel);
    const roll = downtimeRoll(skill.total, dc, bonus);
    const outcome = roll.degree === 'criticalSuccess' ? 'crit-success' : roll.degree === 'criticalFailure' ? 'crit-failure' : roll.degree;
    const dailyCp = downtime.dailyIncomeCopper({ taskLevel, profRank: skill.profNum, outcome });
    saveDowntime(store);

    const embed = new EmbedBuilder()
      .setColor(roll.degree === 'criticalFailure' ? 0xC0392B : roll.degree === 'failure' ? 0xE67E22 : 0x27AE60)
      .setTitle(`${c.name ?? 'Character'} Earns Income`)
      .setDescription(
        `**Skill:** ${skill.skill} (${skill.profRank})\n` +
        `**Task Level/DC:** ${taskLevel} / ${dc}\n` +
        `**Roll:** d20 (${roll.die}) ${fmt(skill.total)}${bonus ? ` ${fmt(bonus)}` : ''} = **${roll.total}**\n` +
        `**Result:** ${downtimeDegreeLabel(roll.degree)}\n` +
        `**Pay:** ${downtime.formatCopper(dailyCp)} per day x ${days} = **${downtime.formatCopper(dailyCp * days)}**\n` +
        `**Downtime bank:** ${spend.balance}/${downtime.MAX_BANK}`
      );
    if (charEntry.art) embed.setThumbnail(charEntry.art);
    return interaction.reply({ embeds: [embed] });
  }

  else if (commandName === 'forgery') {
    const userId = interaction.user.id;
    const characters = loadCharacters();
    const { error, charKey, char: charEntry } = resolveChar(userId, interaction.options.getString('character'), characters);
    if (error) return interaction.reply({ content: error });
    const c = charEntry.data ?? {};
    const days = interaction.options.getInteger('days') ?? 1;
    const bonus = interaction.options.getInteger('bonus') ?? 0;
    const document = interaction.options.getString('document');
    const skill = getDowntimeSkillModifier(c, 'society');
    if (skill.profNum === 0) return interaction.reply({ content: `${c.name ?? 'This character'} must be trained in Society to Create a Forgery.` });

    const store = loadDowntime();
    const spend = spendDowntimeDaysOrReply(store, interaction, userId, charKey, c.name ?? 'Character', days, `Create Forgery (${document})`);
    if (!spend.ok) return interaction.reply(spend.reply);
    const roll = downtimeRoll(skill.total, 20, bonus);
    saveDowntime(store);

    const embed = new EmbedBuilder()
      .setColor(roll.total >= 20 ? 0x27AE60 : 0xE67E22)
      .setTitle(`${c.name ?? 'Character'} Creates a Forgery`)
      .setDescription(
        `**Document:** ${document}\n` +
        `**Secret Society Check:** d20 (${roll.die}) ${fmt(skill.total)}${bonus ? ` ${fmt(bonus)}` : ''} = **${roll.total}** vs DC **20**\n` +
        `**Quality:** ${roll.total >= 20 ? 'Good enough to fool passive observers unless closely examined.' : 'Obvious signs exist; compare this result to observer Perception DC or Society DC.'}\n` +
        `**Close scrutiny:** observers can still roll Perception or Society against your Society DC.\n` +
        `**Downtime bank:** ${spend.balance}/${downtime.MAX_BANK}`
      );
    if (charEntry.art) embed.setThumbnail(charEntry.art);
    return interaction.reply({ embeds: [embed] });
  }

  else if (commandName === 'craft') {
    const userId = interaction.user.id;
    const characters = loadCharacters();
    const { error, charKey, char: charEntry } = resolveChar(userId, interaction.options.getString('character'), characters);
    if (error) return interaction.reply({ content: error });
    const c = charEntry.data ?? {};
    const item = interaction.options.getString('item');
    const itemLevel = interaction.options.getInteger('item_level');
    const days = interaction.options.getInteger('days') ?? 4;
    const bonus = interaction.options.getInteger('bonus') ?? 0;
    const dc = interaction.options.getInteger('dc') ?? downtime.taskLevelDC(itemLevel);
    const skill = getDowntimeSkillModifier(c, 'crafting');
    if (skill.profNum === 0) return interaction.reply({ content: `${c.name ?? 'This character'} must be trained in Crafting to Craft items.` });

    const store = loadDowntime();
    const spend = spendDowntimeDaysOrReply(store, interaction, userId, charKey, c.name ?? 'Character', days, `Craft ${item}`);
    if (!spend.ok) return interaction.reply(spend.reply);
    const roll = downtimeRoll(skill.total, dc, bonus);
    saveDowntime(store);

    const reductionLevel = roll.degree === 'criticalSuccess' ? Math.min(20, (c.level ?? 1) + 1) : (c.level ?? 1);
    const dailyReduction = ['criticalSuccess', 'success'].includes(roll.degree)
      ? downtime.dailyIncomeCopper({ taskLevel: reductionLevel, profRank: skill.profNum, outcome: 'success' })
      : 0;
    const resultText = {
      criticalSuccess: `You can complete it, or reduce remaining material cost by ${downtime.formatCopper(dailyReduction)} per extra day.`,
      success: `You can complete it, or reduce remaining material cost by ${downtime.formatCopper(dailyReduction)} per extra day.`,
      failure: 'You fail, but can salvage the supplied raw materials and start again.',
      criticalFailure: 'You fail and ruin 10% of the supplied raw materials.',
    }[roll.degree];
    const embed = new EmbedBuilder()
      .setColor(['criticalSuccess', 'success'].includes(roll.degree) ? 0x27AE60 : 0xC0392B)
      .setTitle(`${c.name ?? 'Character'} Crafts ${item}`)
      .setDescription(
        `**Item Level/DC:** ${itemLevel} / ${dc}\n` +
        `**Roll:** d20 (${roll.die}) ${fmt(skill.total)}${bonus ? ` ${fmt(bonus)}` : ''} = **${roll.total}**\n` +
        `**Result:** ${downtimeDegreeLabel(roll.degree)}\n${resultText}\n` +
        `**Downtime bank:** ${spend.balance}/${downtime.MAX_BANK}`
      );
    if (charEntry.art) embed.setThumbnail(charEntry.art);
    return interaction.reply({ embeds: [embed] });
  }

  else if (commandName === 'longrest') {
    const userId = interaction.user.id;
    const characters = loadCharacters();
    const { error, charKey, char: charEntry } = resolveChar(userId, interaction.options.getString('character'), characters);
    if (error) return interaction.reply({ content: error });
    const c = charEntry.data ?? {};
    const days = interaction.options.getInteger('days') ?? 1;
    const conMod = Math.floor((((c.abilities ?? {}).con ?? 10) - 10) / 2);
    const healingPerDay = Math.max(1, conMod) * 2 * Math.max(1, c.level ?? 1);
    const store = loadDowntime();
    const spend = spendDowntimeDaysOrReply(store, interaction, userId, charKey, c.name ?? 'Character', days, 'Long-Term Rest');
    if (!spend.ok) return interaction.reply(spend.reply);
    saveDowntime(store);
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(0x27AE60)
        .setTitle(`${c.name ?? 'Character'} Takes Long-Term Rest`)
        .setDescription(`Recovered **${healingPerDay * days} HP** over ${days} day${days === 1 ? '' : 's'}.\nDowntime bank: **${spend.balance}**/${downtime.MAX_BANK}.`)],
    });
  }

  else if (commandName === 'treatdisease') {
    const userId = interaction.user.id;
    const characters = loadCharacters();
    const { error, charKey, char: charEntry } = resolveChar(userId, interaction.options.getString('character'), characters);
    if (error) return interaction.reply({ content: error });
    const c = charEntry.data ?? {};
    const target = interaction.options.getString('target');
    const dc = interaction.options.getInteger('dc');
    const days = interaction.options.getInteger('days') ?? 1;
    const bonus = interaction.options.getInteger('bonus') ?? 0;
    const skill = getDowntimeSkillModifier(c, 'medicine');
    if (skill.profNum === 0) return interaction.reply({ content: `${c.name ?? 'This character'} must be trained in Medicine to Treat Disease.` });
    const store = loadDowntime();
    const spend = spendDowntimeDaysOrReply(store, interaction, userId, charKey, c.name ?? 'Character', days, `Treat Disease (${target})`);
    if (!spend.ok) return interaction.reply(spend.reply);
    const roll = downtimeRoll(skill.total, dc, bonus);
    saveDowntime(store);
    const resultText = {
      criticalSuccess: `${target} gains a +4 circumstance bonus to the next save against the disease.`,
      success: `${target} gains a +2 circumstance bonus to the next save against the disease.`,
      failure: `No benefit for ${target}.`,
      criticalFailure: `${target} takes a -2 circumstance penalty to the next save against the disease.`,
    }[roll.degree];
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(['criticalSuccess', 'success'].includes(roll.degree) ? 0x27AE60 : 0xC0392B)
        .setTitle(`${c.name ?? 'Character'} Treats Disease`)
        .setDescription(`**Target:** ${target}\n**Roll:** d20 (${roll.die}) ${fmt(skill.total)}${bonus ? ` ${fmt(bonus)}` : ''} = **${roll.total}** vs DC **${dc}**\n**Result:** ${downtimeDegreeLabel(roll.degree)}\n${resultText}\n**Downtime bank:** ${spend.balance}/${downtime.MAX_BANK}`)],
    });
  }

  else if (SIMPLE_DOWNTIME_COMMANDS.has(commandName)) {
    const userId = interaction.user.id;
    const characters = loadCharacters();
    const { error, charKey, char: charEntry } = resolveChar(userId, interaction.options.getString('character'), characters);
    if (error) return interaction.reply({ content: error });
    const c = charEntry.data ?? {};
    const skillName = interaction.options.getString('skill');
    const days = interaction.options.getInteger('days') ?? (commandName === 'learnname' ? 7 : 1);
    const bonus = interaction.options.getInteger('bonus') ?? 0;
    const dc = downtimeDcFromOptions(interaction, c.level ?? 1, ['bribe', 'forgedocuments'].includes(commandName) ? 'hard' : 'normal');
    const skill = getDowntimeSkillModifier(c, skillName);
    if (skill.error) return interaction.reply({ content: skill.error });

    const titleMap = {
      learnname: 'Learns a Name',
      subsist: 'Subsists',
      bribe: 'Bribes a Contact',
      forgedocuments: 'Forges Infiltration Documents',
      gaincontact: 'Gains a Contact',
      gossip: 'Gossips',
      scout: 'Scouts a Location',
      disguise: 'Secures Disguises',
      research: 'Performs Practical Research',
      study: 'Studies',
    };
    const store = loadDowntime();
    const spend = spendDowntimeDaysOrReply(store, interaction, userId, charKey, c.name ?? 'Character', days, titleMap[commandName] ?? commandName);
    if (!spend.ok) return interaction.reply(spend.reply);
    const roll = downtimeRoll(skill.total, dc, bonus);
    saveDowntime(store);

    const guidance = {
      learnname: { criticalSuccess: 'You find private name information plus hidden fragments that may point toward a true name.', success: 'You find one private name or useful name clue.', failure: 'You find no useful name.', criticalFailure: 'You may alert the individual or uncover a dangerous/wrong name.' },
      subsist: { criticalSuccess: 'You provide for yourself and one extra creature, or improve your own living standard.', success: 'You find basic food and shelter.', failure: 'You are exposed and hungry, becoming fatigued until you get proper food and shelter.', criticalFailure: 'You attract trouble or worsen conditions; take a -2 penalty to Subsist for 1 week.' },
      bribe: { criticalSuccess: 'The contact accepts cleanly; GM may award 1 EP and extra leverage.', success: 'The contact accepts the bribe; gain 1 EP.', failure: 'You think it worked, but the contact informs the opposition; +1 AP.', criticalFailure: 'As failure, but the opposition gains +2 AP.' },
      forgedocuments: { criticalSuccess: 'Convincing paperwork; gain 1 paperwork-only EP, and GM may add extra confidence.', success: 'Convincing paperwork; gain 1 EP usable when presenting paperwork.', failure: 'Unconvincing documents; gain 1 false EP that secretly grants no benefit.', criticalFailure: 'A PC using this false EP treats the check as a critical failure.' },
      gaincontact: { criticalSuccess: 'You make an excellent contact; gain 1 EP and possible extra help.', success: 'You make contact and gain 1 EP.', failure: 'You fail to make contact.', criticalFailure: 'You insult or spook the contact; future attempts take a -2 penalty.' },
      gossip: { criticalSuccess: 'Inside information grants +2 to future prep checks for this infiltration.', success: 'You gain useful inside information.', failure: 'You learn nothing useful.', criticalFailure: 'Bad rumors give -2 to your next prep check and increase AP by 1.' },
      scout: { criticalSuccess: 'Strong observations; gain 1 EP and GM may provide extra detail.', success: 'Your observations provide 1 EP.', failure: 'You learn nothing noteworthy.', criticalFailure: 'You gain a false EP that causes a critical failure when used.' },
      disguise: { criticalSuccess: 'Excellent disguises; gain 1 cover-identity EP and GM may grant extra durability.', success: 'You get disguises; gain 1 EP usable to maintain a cover identity.', failure: 'The disguises are unusable.', criticalFailure: 'The disguises are flawed enough to create trouble when used.' },
      research: { criticalSuccess: 'You gain strong research results; GM may grant Study benefits and a unique opportunity.', success: 'You gain practical research results, usually including Study benefits.', failure: 'No meaningful research progress.', criticalFailure: 'You draw a bad conclusion or lose access to the opportunity.' },
      study: { criticalSuccess: 'Increase the chosen branch level by 2.', success: 'Increase the chosen branch level by 1.', failure: 'The branch level remains the same.', criticalFailure: 'You require remedial study and must skip the next opportunity.' },
    }[commandName]?.[roll.degree] ?? 'GM adjudicates the result.';

    const embed = new EmbedBuilder()
      .setColor(['criticalSuccess', 'success'].includes(roll.degree) ? 0x27AE60 : 0xC0392B)
      .setTitle(`${c.name ?? 'Character'} ${titleMap[commandName] ?? commandName}`)
      .setDescription(
        `**Skill:** ${skill.skill} (${skill.profRank})\n` +
        `**Roll:** d20 (${roll.die}) ${fmt(skill.total)}${bonus ? ` ${fmt(bonus)}` : ''} = **${roll.total}** vs DC **${dc}**\n` +
        `**Result:** ${downtimeDegreeLabel(roll.degree)}\n${guidance}\n` +
        `**Downtime bank:** ${spend.balance}/${downtime.MAX_BANK}`
      );
    if (charEntry.art) embed.setThumbnail(charEntry.art);
    return interaction.reply({ embeds: [embed] });
  }

  else if (commandName === 'cram' || commandName === 'retrain') {
    const userId = interaction.user.id;
    const characters = loadCharacters();
    const { error, charKey, char: charEntry } = resolveChar(userId, interaction.options.getString('character'), characters);
    if (error) return interaction.reply({ content: error });
    const c = charEntry.data ?? {};
    const days = interaction.options.getInteger('days') ?? (commandName === 'retrain' ? 7 : 1);
    const subject = commandName === 'cram' ? interaction.options.getString('branch') : interaction.options.getString('change');
    const store = loadDowntime();
    const spend = spendDowntimeDaysOrReply(store, interaction, userId, charKey, c.name ?? 'Character', days, commandName === 'cram' ? `Cram (${subject})` : `Retrain (${subject})`);
    if (!spend.ok) return interaction.reply(spend.reply);
    saveDowntime(store);
    const description = commandName === 'cram'
      ? `**Branch/topic:** ${subject}\nYou Study twice, but until your next Study downtime activity, each adventuring day starts with a DC 8 flat check or you are fatigued for that day.`
      : `**Change:** ${subject}\nMost feats, trained skills, and selected class features can be retrained with GM approval. You cannot normally retrain ancestry, heritage, background, class, or ability scores.`;
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(0x6f4e37)
        .setTitle(`${c.name ?? 'Character'} ${commandName === 'cram' ? 'Crams' : 'Retrains'}`)
        .setDescription(`${description}\n**Downtime bank:** ${spend.balance}/${downtime.MAX_BANK}`)],
    });
  }
}

module.exports = {
  name: 'downtimeActivities',
  handles,
  execute,
};
