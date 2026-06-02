const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

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

async function execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    const characters = loadCharacters();
    let store = loadDowntime();

    // Current downtime engine: a per-character bank of downtime days. The old
    // activity tracker code below is kept only as historical scaffolding, but
    // every registered downtime command is handled here and returns before it.
    if (['check', 'spend', 'grant', 'log', 'reset', 'on', 'off'].includes(sub)) {
      const charNameArg = interaction.options.getString('character');
      const { error, charKey, char: charEntry } = resolveChar(userId, charNameArg, characters);
      if (error) return interaction.reply({ content: error });

      const c = charEntry.data ?? {};
      const charName = c.name ?? charEntry.name ?? 'Character';

      if (sub === 'check') {
        const accrual = downtime.accrue(store, userId, charKey);
        const status = downtime.getStatus(store, userId, charKey);
        const recent = downtime.getLog(store, userId, charKey, 5);
        await saveDowntime(store);

        const accrualLine = accrual.added > 0
          ? `Added **${accrual.added}** day${accrual.added === 1 ? '' : 's'} since your last downtime check.`
          : 'No new downtime days accrued today.';
        const capLine = accrual.capped > 0
          ? `\n**${accrual.capped}** day${accrual.capped === 1 ? '' : 's'} hit the ${downtime.MAX_BANK}-day cap.`
          : '';
        const logLines = recent.length
          ? recent.map(e => {
              const sign = e.delta > 0 ? '+' : '';
              return `• ${sign}${e.delta} day${Math.abs(e.delta) === 1 ? '' : 's'} · ${e.kind} · balance ${e.balance} · ${e.reason ?? 'no reason'}`;
            }).join('\n')
          : '*No downtime history yet.*';

        const embed = new EmbedBuilder()
          .setColor(0x6f4e37)
          .setTitle(`🛠️ ${charName}'s Downtime`)
          .setDescription(
            `**Banked days:** ${status.bank}/${status.capacity}\n` +
            `**Automatic accrual:** ${status.autoAccrue ? 'On' : 'Off'}\n` +
            `${accrualLine}${capLine}\n\n` +
            `**Recent activity:**\n${logLines}`
          )
          .setFooter({ text: `Last accrual date: ${status.lastAccrualDate}` });
        if (charEntry.art) embed.setThumbnail(charEntry.art);
        return interaction.reply({ embeds: [embed] });
      }

      if (sub === 'on' || sub === 'off') {
        const enabled = sub === 'on';
        const result = downtime.setAutoAccrue(store, userId, charKey, enabled, userId);
        await saveDowntime(store);
        const accrualLine = result.accrual?.added > 0
          ? `\nCredited **${result.accrual.added}** pending day${result.accrual.added === 1 ? '' : 's'} while updating.`
          : '';
        const statusLine = result.changed
          ? `Automatic downtime accrual is now **${enabled ? 'ON' : 'OFF'}** for **${charName}**.`
          : `Automatic downtime accrual was already **${enabled ? 'ON' : 'OFF'}** for **${charName}**.`;
        return interaction.reply({
          content: `${statusLine}\nBank balance: **${result.balance}**/${downtime.MAX_BANK}.${accrualLine}`,
        });
      }

      if (sub === 'spend') {
        const days = interaction.options.getInteger('days');
        const reason = interaction.options.getString('reason');
        const result = downtime.spend(store, userId, charKey, days, reason, userId);
        if (!result.ok) return interaction.reply({ content: `❌ ${result.reason}`, ephemeral: true });
        await saveDowntime(store);
        return interaction.reply({
          content: `🪙 **${charName}** spent **${days}** downtime day${days === 1 ? '' : 's'} on **${reason}**.\nBank balance: **${result.balance}**/${downtime.MAX_BANK}.`,
        });
      }

      if (sub === 'grant') {
        const days = interaction.options.getInteger('days');
        const reason = interaction.options.getString('reason');
        const result = downtime.grant(store, userId, charKey, days, reason, userId);
        if (!result.ok) return interaction.reply({ content: `❌ ${result.reason}`, ephemeral: true });
        await saveDowntime(store);
        const capLine = result.capped > 0
          ? `\n${result.capped} day${result.capped === 1 ? '' : 's'} could not be added because the bank is capped at ${downtime.MAX_BANK}.`
          : '';
        return interaction.reply({
          content: `🪙 Added **${result.added}** downtime day${result.added === 1 ? '' : 's'} to **${charName}**: **${reason}**.\nBank balance: **${result.balance}**/${downtime.MAX_BANK}.${capLine}`,
        });
      }

      if (sub === 'log') {
        downtime.accrue(store, userId, charKey);
        const recent = downtime.getLog(store, userId, charKey, 10);
        await saveDowntime(store);
        const lines = recent.length
          ? recent.map(e => {
              const sign = e.delta > 0 ? '+' : '';
              const date = String(e.ts ?? '').slice(0, 10) || 'unknown date';
              return `• ${date} — ${sign}${e.delta} day${Math.abs(e.delta) === 1 ? '' : 's'} · ${e.kind} · balance ${e.balance} · ${e.reason ?? 'no reason'}`;
            }).join('\n')
          : '*No history yet.*';
        const embed = new EmbedBuilder()
          .setColor(0xF39C12)
          .setTitle(`🪙 ${charName}'s Downtime Log`)
          .setDescription(lines);
        return interaction.reply({ embeds: [embed] });
      }

      if (sub === 'reset') {
        const result = downtime.reset(store, userId, charKey, userId, 'manual reset');
        await saveDowntime(store);
        return interaction.reply({
          content: `🧹 Reset **${charName}**'s downtime bank from **${result.before}** to **0**.`,
        });
      }
    }

    return interaction.reply({
      content: `❌ This downtime subcommand is from an older command version. Try restarting Discord, then use \`/downtime check\`, \`/downtime spend\`, \`/downtime grant\`, \`/downtime log\`, or \`/downtime reset\`.`,
    });

    // ─── /downtime list — show available activities ───
    if (sub === 'list') {
      const lines = Object.entries(downtime.ACTIVITIES).map(([key, def]) =>
        `• **${def.name}** \`(${key})\` — ${def.summary} *(${def.source})*`
      );
      const embed = new EmbedBuilder()
        .setColor(0x6f4e37)
        .setTitle('🛠️ Available Downtime Activities')
        .setDescription(lines.join('\n') || 'No activities defined yet.')
        .setFooter({ text: 'Start with /downtime start' });
      return interaction.reply({ embeds: [embed] });
    }

    // For all other subcommands, we need the player's character.
    const charNameArg = interaction.options.getString('character');
    const { error, charKey, char: charEntry } = resolveChar(userId, charNameArg, characters);
    if (error) {
      return interaction.reply({ content: error });
    }
    const c = charEntry.data;

    // ─── /downtime start ──────────────────────────────
    if (sub === 'start') {
      const activityKey = interaction.options.getString('activity');
      const def = downtime.ACTIVITIES[activityKey];
      if (!def) {
        return interaction.reply({ content: `❌ Unknown activity "${activityKey}". Use \`/downtime list\` to see options.`, ephemeral: true });
      }

      // Currently only Earn Income — branch here when more activities exist.
      if (activityKey === 'earn-income') {
        const skillName = interaction.options.getString('skill');
        const taskLevel = interaction.options.getInteger('tasklevel');
        const plannedDays = interaction.options.getInteger('days');
        const extraBonus = interaction.options.getInteger('bonus') ?? 0;

        // Validate skill (use same map as /skill, plus Crafting/Lore-as-text)
        const skillMap = {
          acrobatics: 'dex', arcana: 'int', athletics: 'str', crafting: 'int',
          deception: 'cha', diplomacy: 'cha', intimidation: 'cha', medicine: 'wis',
          nature: 'wis', occultism: 'int', performance: 'cha', religion: 'wis',
          society: 'int', stealth: 'dex', survival: 'wis', thievery: 'dex',
        };
        const lowerSkill = skillName.toLowerCase();
        if (!(lowerSkill in skillMap)) {
          return interaction.reply({ content: `❌ Unknown skill "${skillName}". Earn Income uses skills like Crafting, Performance, or any Lore.`, ephemeral: true });
        }

        // Compute character's modifier for the chosen skill
        const ab = c.abilities ?? {};
        const prof = c.proficiencies ?? {};
        const lvl = c.level ?? 1;
        const abilKey = skillMap[lowerSkill];
        const abilMod = Math.floor(((ab[abilKey] ?? 10) - 10) / 2);
        const profNum = prof[lowerSkill] ?? 0;
        const modifier = abilMod + calcProfNum(profNum, lvl);

        if (profNum === 0) {
          return interaction.reply({ content: `❌ **${c.name}** is not trained in ${skillName}. Earn Income generally requires being at least Trained.`, ephemeral: true });
        }

        // Roll the initial check
        const dieRoll = Math.floor(Math.random() * 20) + 1;
        const total = dieRoll + modifier + extraBonus;
        const dc = downtime.taskLevelDC(taskLevel);

        // Determine outcome
        let outcome;
        if (total >= dc + 10) outcome = 'crit-success';
        else if (total >= dc) outcome = 'success';
        else if (total <= dc - 10) outcome = 'crit-failure';
        else outcome = 'failure';
        // Nat 20 / Nat 1 shift the outcome by one step
        if (dieRoll === 20) {
          outcome = outcome === 'crit-failure' ? 'failure' : outcome === 'failure' ? 'success' : 'crit-success';
        } else if (dieRoll === 1) {
          outcome = outcome === 'crit-success' ? 'success' : outcome === 'success' ? 'failure' : 'crit-failure';
        }

        const dailyCp = downtime.dailyIncomeCopper({ taskLevel, profRank: profNum, outcome });

        // On a critical failure, the activity ends immediately (fired & reputation hit).
        if (outcome === 'crit-failure') {
          const embed = new EmbedBuilder()
            .setColor(0xC0392B)
            .setTitle(`💼 ${c.name} attempts Earn Income (${skillName})`)
            .setDescription(
              `🎲 **Rolled:** d20 (${dieRoll}) ${fmt(modifier)}${extraBonus ? ` ${fmt(extraBonus)}` : ''} = **${total}** vs DC **${dc}**\n` +
              `💥 **Critical Failure!**\n\n` +
              `*${c.name} is fired immediately and earns nothing. Their reputation in this community suffers — the GM may make future Earn Income harder here.*`
            )
            .setFooter({ text: `Task Level ${taskLevel} · ${downtime.profRankKey(profNum)}` });
          return interaction.reply({ embeds: [embed] });
        }

        // Start the entry
        const result = downtime.startEntry(store, userId, charKey, 'earn-income', {
          skill: skillName,
          taskLevel,
          profRank: profNum,
          modifier,
          dieRoll,
          rolledTotal: total,
          dc,
          outcome,
          dailyIncomeCp: dailyCp,
        }, plannedDays);

        if (!result.ok) {
          return interaction.reply({ content: `❌ Could not start activity: ${result.reason}`, ephemeral: true });
        }
        await saveDowntime(store);

        const outcomeEmoji = { 'crit-success': '🌟', success: '✅', failure: '⚠️' }[outcome];
        const outcomeLabel = { 'crit-success': 'Critical Success!', success: 'Success', failure: 'Failure (shoddy work)' }[outcome];
        const embed = new EmbedBuilder()
          .setColor(outcome === 'crit-success' ? 0xF1C40F : outcome === 'success' ? 0x27AE60 : 0xE67E22)
          .setTitle(`💼 ${c.name} starts Earn Income (${skillName})`)
          .setDescription(
            `🎲 **Initial Check:** d20 (${dieRoll}) ${fmt(modifier)}${extraBonus ? ` ${fmt(extraBonus)}` : ''} = **${total}** vs DC **${dc}**\n` +
            `${outcomeEmoji} **${outcomeLabel}**\n\n` +
            `**Daily payout:** ${downtime.formatCopper(dailyCp)}\n` +
            `**Planned duration:** ${plannedDays} day${plannedDays === 1 ? '' : 's'}\n` +
            `**Activity ID:** \`${result.entry.id}\`\n\n` +
            `Each real-life day will automatically credit a downtime day.\n` +
            `Use \`/downtime check\` to see progress, or \`/downtime complete activity:${result.entry.id}\` when done.`
          )
          .setFooter({ text: `Task Level ${taskLevel} · ${downtime.profRankKey(profNum)}` });
        if (charEntry.art) embed.setThumbnail(charEntry.art);
        return interaction.reply({ embeds: [embed] });
      }

      return interaction.reply({ content: `❌ Activity "${activityKey}" not yet implemented.`, ephemeral: true });
    }

    // ─── /downtime check — auto-advance and show status ───
    if (sub === 'check') {
      // Auto-advance everything for this character first
      const advances = downtime.autoAdvanceAll(store, userId, charKey);
      const active = downtime.listActiveEntries(store, userId, charKey);

      if (active.length === 0) {
        const bank = downtime.getBank(store, userId, charKey).bank;
        return interaction.reply({
          content: `**${c.name}** has no active downtime activities. Banked days: **${bank}**.\nStart one with \`/downtime start\`.`,
          ephemeral: true,
        });
      }

      await saveDowntime(store);

      const lines = active.map(entry => {
        const def = downtime.ACTIVITIES[entry.activity];
        const adv = advances.find(a => a.entry.id === entry.id);
        const advText = adv && adv.addedDays > 0
          ? ` *(+${adv.addedDays} day${adv.addedDays === 1 ? '' : 's'} since last check, +${downtime.formatCopper(adv.addedCp)})*`
          : '';
        const statusBadge = entry.status === 'ready-to-complete' ? ' ✅ **READY TO COMPLETE**' : '';
        const earnedText = entry.result?.totalEarnedCp != null
          ? `Earned: **${downtime.formatCopper(entry.result.totalEarnedCp)}**`
          : '';
        return `• **${def.name}** (${entry.params.skill ?? '?'}) — ID \`${entry.id}\`${statusBadge}\n` +
               `  Day ${entry.elapsedDays}/${entry.plannedDays} · ${earnedText}${advText}`;
      });

      const bank = downtime.getBank(store, userId, charKey).bank;
      const embed = new EmbedBuilder()
        .setColor(0x6f4e37)
        .setTitle(`🛠️ ${c.name}'s Downtime`)
        .setDescription(lines.join('\n\n'))
        .setFooter({ text: `Banked downtime days: ${bank}` });
      if (charEntry.art) embed.setThumbnail(charEntry.art);
      return interaction.reply({ embeds: [embed] });
    }

    // ─── /downtime complete ───────────────────────────
    if (sub === 'complete') {
      const entryId = interaction.options.getString('activity');
      // Auto-advance first so we know if it's actually done
      downtime.autoAdvanceAll(store, userId, charKey);
      const entry = downtime.getEntry(store, userId, charKey, entryId);
      if (!entry) {
        return interaction.reply({ content: `❌ No downtime activity with ID \`${entryId}\` for ${c.name}.`, ephemeral: true });
      }
      if (entry.status === 'completed') {
        return interaction.reply({ content: `❌ Activity \`${entryId}\` is already completed.`, ephemeral: true });
      }
      if (entry.status === 'cancelled') {
        return interaction.reply({ content: `❌ Activity \`${entryId}\` was cancelled.`, ephemeral: true });
      }

      // Allow completing early — partial credit for partial days.
      const result = downtime.completeEntry(store, userId, charKey, entryId);
      if (!result.ok) return interaction.reply({ content: `❌ ${result.reason}`, ephemeral: true });
      await saveDowntime(store);

      const def = downtime.ACTIVITIES[entry.activity];
      const earned = entry.result?.totalEarnedCp ?? 0;
      const earlyNote = entry.elapsedDays < entry.plannedDays
        ? `\n*(Completed early at day ${entry.elapsedDays}/${entry.plannedDays}.)*`
        : '';
      const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle(`✅ ${c.name} completes ${def.name}`)
        .setDescription(
          `**Total earned:** ${downtime.formatCopper(earned)}\n` +
          `**Days worked:** ${entry.elapsedDays}\n` +
          `**Skill used:** ${entry.params.skill}${earlyNote}\n\n` +
          `*Add this to your character's coin pouch with \`/coin add\` (or however you track money).*`
        )
        .setFooter({ text: `Activity ID: ${entry.id}` });
      if (charEntry.art) embed.setThumbnail(charEntry.art);
      return interaction.reply({ embeds: [embed] });
    }

    // ─── /downtime cancel ─────────────────────────────
    if (sub === 'cancel') {
      const entryId = interaction.options.getString('activity');
      const entry = downtime.getEntry(store, userId, charKey, entryId);
      if (!entry) {
        return interaction.reply({ content: `❌ No downtime activity with ID \`${entryId}\` for ${c.name}.`, ephemeral: true });
      }
      const result = downtime.cancelEntry(store, userId, charKey, entryId);
      if (!result.ok) return interaction.reply({ content: `❌ ${result.reason}`, ephemeral: true });
      await saveDowntime(store);

      const def = downtime.ACTIVITIES[entry.activity];
      return interaction.reply({
        content: `🚫 Cancelled **${def.name}** (\`${entry.id}\`). ${entry.result?.totalEarnedCp ? `Forfeited ${downtime.formatCopper(entry.result.totalEarnedCp)}.` : 'No earnings forfeited.'}`,
      });
    }

    // ─── /downtime spend — apply banked days to an activity ───
    if (sub === 'spend') {
      const entryId = interaction.options.getString('activity');
      const days = interaction.options.getInteger('days');
      const result = downtime.spendBankedDays(store, userId, charKey, entryId, days);
      if (!result.ok) return interaction.reply({ content: `❌ ${result.reason}`, ephemeral: true });
      await saveDowntime(store);

      const def = downtime.ACTIVITIES[result.entry.activity];
      const completedNote = result.entry.status === 'ready-to-complete'
        ? `\n✅ **Activity is now ready to complete!** Use \`/downtime complete activity:${result.entry.id}\`.`
        : '';
      return interaction.reply({
        content: `🪙 Applied **${result.daysApplied}** banked day${result.daysApplied === 1 ? '' : 's'} to ${def.name} (\`${result.entry.id}\`).\n` +
                 `Earned **+${downtime.formatCopper(result.addedCp)}** (total: ${downtime.formatCopper(result.entry.result?.totalEarnedCp ?? 0)}).\n` +
                 `Days now ${result.entry.elapsedDays}/${result.entry.plannedDays}. Bank balance: **${store[userId][charKey].bank}**.${completedNote}`,
      });
    }

    // ─── /downtime bank — show banked days + recent history ───
    if (sub === 'bank') {
      const { bank, history } = downtime.getBank(store, userId, charKey);
      const recent = history.slice(-10).reverse();
      const histLines = recent.length === 0
        ? '*No history yet.*'
        : recent.map(h => {
            const sign = h.delta > 0 ? '+' : '';
            const date = h.ts.slice(0, 10);
            return `${date} · **${sign}${h.delta}** — ${h.reason}`;
          }).join('\n');
      const embed = new EmbedBuilder()
        .setColor(0xF39C12)
        .setTitle(`🪙 ${c.name}'s Downtime Bank`)
        .setDescription(`**Banked days:** ${bank}\n\n**Recent activity:**\n${histLines}`)
        .setFooter({ text: 'GMs award days with /downtime award' });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // ─── /downtime award — GM grants days to a player's character ───
    if (sub === 'award') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: '🔒 Only GMs (Manage Server permission) can award downtime days.', ephemeral: true });
      }
      // The character we resolved above is the AWARDER's character.
      // The award target is a different player's character — read from options.
      const targetPlayer = interaction.options.getUser('player');
      const targetCharName = interaction.options.getString('targetcharacter');
      const days = interaction.options.getInteger('days');
      const reason = interaction.options.getString('reason') ?? 'GM award';

      if (!targetPlayer) {
        return interaction.reply({ content: '❌ Specify a `player:` (and `targetcharacter:` if they have multiple).', ephemeral: true });
      }
      if (days === 0) {
        return interaction.reply({ content: '❌ Award amount must be non-zero. Use a negative number to remove days.', ephemeral: true });
      }

      const targetCharacters = loadCharacters(); // re-read so we have fresh data
      const { error: terr, charKey: tCharKey, char: tCharEntry } = resolveChar(targetPlayer.id, targetCharName, targetCharacters);
      if (terr) return interaction.reply({ content: `❌ Couldn't find that character: ${terr}`, ephemeral: true });

      const newBalance = downtime.awardDays(store, targetPlayer.id, tCharKey, days, reason);
      await saveDowntime(store);

      const sign = days > 0 ? '+' : '';
      const verb = days > 0 ? 'awarded' : 'removed';
      return interaction.reply({
        content: `🪙 ${verb === 'awarded' ? 'Awarded' : 'Removed'} **${sign}${days}** downtime day${Math.abs(days) === 1 ? '' : 's'} ${days > 0 ? 'to' : 'from'} <@${targetPlayer.id}>'s **${tCharEntry.data.name}**${reason ? `: *${reason}*` : ''}.\nNew balance: **${newBalance}**.`,
      });
    }
}

module.exports = {
  name: 'downtime',
  execute,
};
