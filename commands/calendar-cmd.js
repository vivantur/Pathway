// commands/calendar-cmd.js
// /calendar slash command handlers. Per-server scope, GM-controlled.
//
// Subcommands:
//   /calendar today                    — show today with weekday, season, moon, holidays
//   /calendar set year month day       — GM sets exact date
//   /calendar advance days:N           — step forward N days (positive or negative)
//   /calendar month [year] [month]     — render the month grid view
//   /calendar holidays [month]         — list holidays in month (defaults to current)
//   /calendar next-holiday             — show what's next and how far away
//   /calendar moon [year] [month] [day]— moon phase for a date (default: today)
//   /calendar clear                    — reset to default
//
// Permission model mirrors weather: WEATHER_GM_ONLY env var also controls
// /calendar (or use CALENDAR_GM_ONLY if you want them independent).
//
// Optional weather integration: if a `weather` module is passed in, then
// /calendar set and /calendar advance will update the weather system's
// season to match the new month. One-way only — changing weather doesn't
// touch the calendar.

'use strict';

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const calendar = require('../systems/calendar');

const GM_ONLY =
  process.env.CALENDAR_GM_ONLY === '1' || process.env.CALENDAR_GM_ONLY === 'true' ||
  process.env.WEATHER_GM_ONLY  === '1' || process.env.WEATHER_GM_ONLY  === 'true';

function isGm(interaction) {
  if (!GM_ONLY) return true;
  if (process.env.BOT_OWNER_ID && String(interaction.user.id) === String(process.env.BOT_OWNER_ID)) return true;
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) || false;
}

const SEASON_EMOJI = { spring: '🌸', summer: '☀️', autumn: '🍂', winter: '❄️' };
const SEASON_LABEL = { spring: 'Spring', summer: 'Summer', autumn: 'Autumn', winter: 'Winter' };

// Ask the weather module (if available) to update its season for the given
// guild. Best-effort: if anything throws (e.g. weather state doesn't exist),
// we silently skip — calendar shouldn't fail because of weather.
async function syncWeatherSeason(weatherModule, guildId, date) {
  if (!weatherModule || !date) return;
  try {
    const state = weatherModule.getWeather && weatherModule.getWeather(guildId);
    if (!state) return; // No weather set for this server; nothing to sync.
    const newSeason = calendar.seasonOf(date.month);
    if (newSeason && newSeason !== state.season && weatherModule.setSeason) {
      await weatherModule.setSeason(guildId, newSeason);
    }
  } catch (err) {
    console.warn('[calendar] weather season sync failed (non-fatal):', err.message);
  }
}

// Build the embed shown by /calendar today.
function buildTodayEmbed(date) {
  const monthDef = calendar.RULES.months[date.month - 1];
  const wdName = calendar.weekdayName(date.year, date.month, date.day);
  const wdDef = calendar.RULES.weekdays.find(w => w.name === wdName);
  const moon = calendar.getMoonPhase(date.year, date.month, date.day);
  const season = calendar.seasonOf(date.month);
  const holidaysToday = calendar.getHolidaysOn(date.year, date.month, date.day);
  const isLeap = calendar.isLeapYear(date.year);

  const embed = new EmbedBuilder()
    .setColor(0x9B59B6)
    .setTitle(`📅 ${calendar.describeDate(date)}`)
    .setDescription(
      `*${wdDef?.blurb || ''}*\n\n` +
      `**${SEASON_EMOJI[season]} ${SEASON_LABEL[season]}** · ` +
      `**${moon.emoji} ${moon.name}**${isLeap ? ' · 🌀 Leap Year' : ''}`
    )
    .addFields({
      name: `${monthDef.name} (${monthDef.deity})`,
      value: monthDef.blurb,
    });

  if (holidaysToday.length > 0) {
    embed.addFields({
      name: '🎉 Today\'s Holidays',
      value: holidaysToday.map(h => `${h.emoji || ''} **${h.name}**${h.deity ? ` (${h.deity})` : ''} — ${h.blurb}`).join('\n\n'),
    });
  }

  // Always show the next upcoming holiday so the GM has something to look forward to.
  const next = calendar.getNextHoliday(date.year, date.month, date.day);
  if (next) {
    embed.addFields({
      name: '⏭️ Next Holiday',
      value: `${next.holiday.emoji || ''} **${next.holiday.name}** in ${next.daysAway} day${next.daysAway === 1 ? '' : 's'} (${calendar.describeDate(next.occursOn, { includeWeekday: false })})`,
    });
  }

  return embed;
}

// Build the embed shown by /calendar month — a grid view of the chosen month.
function buildMonthEmbed(year, month, today = null) {
  const monthDef = calendar.RULES.months[month - 1];
  const grid = calendar.getMonthGrid(year, month, today);
  const isLeap = calendar.isLeapYear(year);
  const len = calendar.monthLength(month - 1, year);

  // Header row: short weekday names (2 letters)
  const header = calendar.WEEKDAY_NAMES.map(n => `\`${n.slice(0, 2)}\``).join(' ');

  // Cell formatting: 2-wide day number with marker. Uses backticks for
  // monospace alignment; markdown bold for today.
  const lines = [header];
  for (const week of grid) {
    const cells = week.map(cell => {
      if (!cell) return '`  `';
      const dayStr = String(cell.day).padStart(2, ' ');
      if (cell.isToday) return `**\`${dayStr}\`**`;
      if (cell.holidays.length > 0) return `\`${dayStr}\`*`;
      return `\`${dayStr}\``;
    });
    lines.push(cells.join(' '));
  }

  const monthHolidays = calendar.listHolidays(month);
  const holidayLines = monthHolidays.map(h => {
    const dStr = calendar.ordinal(h.day);
    return `${h.emoji || ''} **${dStr}** — ${h.name}${h.deity ? ` *(${h.deity})*` : ''}`;
  });

  const embed = new EmbedBuilder()
    .setColor(0x9B59B6)
    .setTitle(`📅 ${monthDef.name} ${year} AR${isLeap ? ' (leap year)' : ''}`)
    .setDescription(
      `*${monthDef.blurb}*\n\n` +
      lines.join('\n') +
      (today && today.year === year && today.month === month ? `\n\n*Today: ${calendar.ordinal(today.day)}*` : '') +
      `\n*\\* = holiday*`
    );
  if (monthHolidays.length > 0) {
    embed.addFields({ name: 'Holidays', value: holidayLines.join('\n') });
  }
  embed.setFooter({ text: `${len} days · ${monthDef.deity}'s month` });
  return embed;
}

// ── Main entry point ────────────────────────────────────────────────────────
async function handleCalendar(interaction, weatherModule = null) {
  if (!interaction.guildId) {
    return interaction.reply({ content: 'Calendar is per-server, so this command only works in a server.', ephemeral: true });
  }
  // Defensive check: if gamedata/calendar.json failed to load at startup,
  // RULES will be null and every command will crash on a property access.
  // Report a clear error instead so the GM knows where to look.
  if (!calendar.RULES) {
    return interaction.reply({
      content: '❌ Calendar data file is missing. The bot couldn\'t load `gamedata/calendar.json`. Check the deploy logs for the exact error and confirm the file exists in your repo.',
      ephemeral: true,
    });
  }
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  try {
    switch (sub) {
      case 'today':         return cmdToday(interaction, guildId);
      case 'set':           return cmdSet(interaction, guildId, weatherModule);
      case 'advance':       return cmdAdvance(interaction, guildId, weatherModule);
      case 'month':         return cmdMonth(interaction, guildId);
      case 'holidays':      return cmdHolidays(interaction, guildId);
      case 'next-holiday':  return cmdNextHoliday(interaction, guildId);
      case 'moon':          return cmdMoon(interaction, guildId);
      case 'clear':         return cmdClear(interaction, guildId);
      default:              return interaction.reply({ content: `Unknown subcommand: ${sub}`, ephemeral: true });
    }
  } catch (err) {
    console.error(`/calendar ${sub} error:`, err);
    if (interaction.replied || interaction.deferred) {
      return interaction.followUp({ content: `❌ ${err.message}`, ephemeral: true }).catch(() => {});
    }
    return interaction.reply({ content: `❌ ${err.message}`, ephemeral: true }).catch(() => {});
  }
}

// ── /calendar today ─────────────────────────────────────────────────────────
async function cmdToday(interaction, guildId) {
  let date = calendar.getDate(guildId);
  if (!date) {
    await calendar.ensureDate(guildId); // seed with anchor date on first use
    date = calendar.getDate(guildId);
  }
  return interaction.reply({ embeds: [buildTodayEmbed(date)] });
}

// ── /calendar set ───────────────────────────────────────────────────────────
async function cmdSet(interaction, guildId, weatherModule) {
  if (!isGm(interaction)) return interaction.reply({ content: '❌ Only GMs can set the date.', ephemeral: true });
  const year = interaction.options.getInteger('year');
  const month = interaction.options.getInteger('month');
  const day = interaction.options.getInteger('day');
  await calendar.setDate(guildId, year, month, day);
  await syncWeatherSeason(weatherModule, guildId, { year, month, day });
  const embed = buildTodayEmbed(calendar.getDate(guildId))
    .setTitle(`📅 Date set — ${calendar.describeDate({ year, month, day })}`);
  return interaction.reply({ embeds: [embed] });
}

// ── /calendar advance ───────────────────────────────────────────────────────
async function cmdAdvance(interaction, guildId, weatherModule) {
  if (!isGm(interaction)) return interaction.reply({ content: '❌ Only GMs can advance time.', ephemeral: true });
  const days = interaction.options.getInteger('days');
  if (Math.abs(days) > 365 * 10) {
    return interaction.reply({ content: '❌ That\'s a lot. Limit is 10 years (3650 days) per call.', ephemeral: true });
  }
  await calendar.ensureDate(guildId);
  await calendar.advance(guildId, days);
  const date = calendar.getDate(guildId);
  await syncWeatherSeason(weatherModule, guildId, date);
  const verb = days >= 0 ? 'Advanced' : 'Rewound';
  const embed = buildTodayEmbed(date)
    .setTitle(`⏭️ ${verb} ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`);
  return interaction.reply({ embeds: [embed] });
}

// ── /calendar month ─────────────────────────────────────────────────────────
async function cmdMonth(interaction, guildId) {
  const today = calendar.getDate(guildId);
  const year  = interaction.options.getInteger('year')  ?? today?.year  ?? calendar.RULES.anchor.year;
  const month = interaction.options.getInteger('month') ?? today?.month ?? calendar.RULES.anchor.month;
  if (month < 1 || month > 12) {
    return interaction.reply({ content: '❌ Month must be 1-12.', ephemeral: true });
  }
  return interaction.reply({ embeds: [buildMonthEmbed(year, month, today)] });
}

// ── /calendar holidays ──────────────────────────────────────────────────────
async function cmdHolidays(interaction, guildId) {
  const today = calendar.getDate(guildId);
  const monthArg = interaction.options.getInteger('month');
  const month = monthArg ?? today?.month ?? null;

  let holidays, title;
  if (month === null) {
    holidays = calendar.listHolidays();
    title = '🎉 All Holidays of Golarion';
  } else {
    if (month < 1 || month > 12) {
      return interaction.reply({ content: '❌ Month must be 1-12.', ephemeral: true });
    }
    holidays = calendar.listHolidays(month);
    title = `🎉 Holidays in ${calendar.MONTH_NAMES[month - 1]}`;
  }

  if (holidays.length === 0) {
    return interaction.reply({ content: `No holidays in ${calendar.MONTH_NAMES[month - 1]}.`, ephemeral: true });
  }

  const lines = holidays.map(h => {
    const monthName = calendar.MONTH_NAMES[h.month - 1];
    return `${h.emoji || ''} **${calendar.ordinal(h.day)} ${monthName}** — ${h.name}${h.deity ? ` *(${h.deity})*` : ''}\n*${h.blurb}*`;
  });

  // Discord limits embed description to 4096 chars; chunk if needed.
  const embed = new EmbedBuilder().setColor(0xE67E22).setTitle(title);
  let buf = '';
  for (const ln of lines) {
    if ((buf + '\n\n' + ln).length > 4000) break;
    buf += (buf ? '\n\n' : '') + ln;
  }
  embed.setDescription(buf);
  return interaction.reply({ embeds: [embed] });
}

// ── /calendar next-holiday ──────────────────────────────────────────────────
async function cmdNextHoliday(interaction, guildId) {
  let date = calendar.getDate(guildId);
  if (!date) { await calendar.ensureDate(guildId); date = calendar.getDate(guildId); }
  const next = calendar.getNextHoliday(date.year, date.month, date.day);
  if (!next) return interaction.reply({ content: 'No upcoming holidays found within a year. (Something\'s odd.)', ephemeral: true });
  const todays = calendar.getHolidaysOn(date.year, date.month, date.day);
  const embed = new EmbedBuilder()
    .setColor(0xE67E22)
    .setTitle(`${next.holiday.emoji || '🎉'} Next: ${next.holiday.name}`)
    .setDescription(`*${next.holiday.blurb}*\n\nIn **${next.daysAway} day${next.daysAway === 1 ? '' : 's'}** on **${calendar.describeDate(next.occursOn)}**.${next.holiday.deity ? `\n\nPatron deity: **${next.holiday.deity}**.` : ''}`);
  if (todays.length > 0) {
    embed.addFields({
      name: '🎉 Today',
      value: todays.map(h => `${h.emoji || ''} **${h.name}**`).join('\n'),
    });
  }
  return interaction.reply({ embeds: [embed] });
}

// ── /calendar moon ──────────────────────────────────────────────────────────
async function cmdMoon(interaction, guildId) {
  const today = calendar.getDate(guildId);
  const year  = interaction.options.getInteger('year')  ?? today?.year  ?? calendar.RULES.anchor.year;
  const month = interaction.options.getInteger('month') ?? today?.month ?? calendar.RULES.anchor.month;
  const day   = interaction.options.getInteger('day')   ?? today?.day   ?? calendar.RULES.anchor.day;
  try { calendar.validateDate(year, month, day); }
  catch (err) { return interaction.reply({ content: `❌ ${err.message}`, ephemeral: true }); }

  const moon = calendar.getMoonPhase(year, month, day);
  const date = { year, month, day };

  // Find when the moon is next full and next new — useful info for spellcasters.
  let nextFull = null, nextNew = null;
  let cur = date;
  for (let i = 1; i <= 30; i++) {
    cur = calendar.addDays(cur.year, cur.month, cur.day, 1);
    const m = calendar.getMoonPhase(cur.year, cur.month, cur.day);
    if (!nextFull && m.key === 'full') nextFull = { date: cur, daysAway: i };
    if (!nextNew  && m.key === 'new')  nextNew  = { date: cur, daysAway: i };
    if (nextFull && nextNew) break;
  }

  const embed = new EmbedBuilder()
    .setColor(0x34495E)
    .setTitle(`${moon.emoji} ${moon.name}`)
    .setDescription(`On ${calendar.describeDate(date)}.\n\nDay ${moon.dayOfCycle} of the ${moon.cycleDays}-day lunar cycle.`);
  if (nextFull) embed.addFields({ name: '🌕 Next Full Moon', value: `${nextFull.daysAway} day${nextFull.daysAway === 1 ? '' : 's'} (${calendar.describeDate(nextFull.date, { includeWeekday: false })})`, inline: true });
  if (nextNew)  embed.addFields({ name: '🌑 Next New Moon',  value: `${nextNew.daysAway} day${nextNew.daysAway === 1 ? '' : 's'} (${calendar.describeDate(nextNew.date, { includeWeekday: false })})`, inline: true });
  return interaction.reply({ embeds: [embed] });
}

// ── /calendar clear ─────────────────────────────────────────────────────────
async function cmdClear(interaction, guildId) {
  if (!isGm(interaction)) return interaction.reply({ content: '❌ Only GMs can clear the calendar.', ephemeral: true });
  await calendar.clear(guildId);
  return interaction.reply({ content: '🗑️ Calendar state cleared for this server. Use `/calendar today` or `/calendar set` to start again.', ephemeral: true });
}

// ── Autocomplete handler ────────────────────────────────────────────────────
async function handleCalendarAutocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  const term = String(focused.value || '').toLowerCase();
  if (focused.name === 'month') {
    const choices = calendar.MONTH_NAMES.map((n, i) => ({
      name: `${i + 1} — ${n}`,
      value: i + 1,
    }));
    const filtered = choices.filter(c => c.name.toLowerCase().includes(term)).slice(0, 25);
    return interaction.respond(filtered);
  }
  return interaction.respond([]);
}

module.exports = {
  handleCalendar,
  handleCalendarAutocomplete,
};