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
const golarionCalendar = require('../systems/calendar');
const eberronCalendar = require('../systems/eberronCalendar');
const settings = require('../systems/settings');
const { syncGuildStateToSupabase } = require('../utils/storage');

const SEASON_EMOJI_MAP = { spring: '🌸', summer: '☀️', autumn: '🍂', winter: '❄️' };

function buildCalendarSnapshot(guildId, date, cal) {
  try {
    const season = cal.seasonOf(date.month);
    const holidays = cal.getHolidaysOn(date.year, date.month, date.day);
    const next = cal.getNextHoliday(date.year, date.month, date.day);
    return {
      year: date.year,
      month: date.month,
      day: date.day,
      setting: settings.getCampaignSetting(guildId),
      weekday: cal.weekdayName(date.year, date.month, date.day),
      monthName: cal.MONTH_NAMES[date.month - 1],
      season,
      seasonEmoji: SEASON_EMOJI_MAP[season] ?? '',
      description: cal.describeDate(date),
      holidays: holidays.map(h => h.name),
      nextHoliday: next
        ? { name: next.holiday.name, daysAway: next.daysAway, dateString: cal.describeDate(next.occursOn, { includeWeekday: false }) }
        : null,
      updatedAt: new Date().toISOString(),
    };
  } catch { return null; }
}

// Pick the right engine for a guild. Defaults to Golarion for backward
// compatibility — every existing server keeps its current experience until
// someone runs /calendar setting choice:eberron.
//
// Both engines export the same public API (getDate, advance, getMonthGrid,
// describeDate, etc.) so this is a true drop-in dispatch — handlers below
// just use `cal` as if it were the original calendar module.
function getEngine(guildId) {
  const setting = settings.getCampaignSetting(guildId);
  return setting === 'eberron' ? eberronCalendar : golarionCalendar;
}

// Year suffix differs between settings. Helpers below use this for embed
// titles. Pulled from the engine so we don't hardcode strings.
function yearSuffix(cal) {
  return cal === eberronCalendar ? 'YK' : 'AR';
}

function settingLabel(name) {
  return name === 'eberron' ? 'Eberron (Galifar Calendar)' : 'Golarion (Inner Sea Calendar)';
}

const GM_ONLY =
  process.env.CALENDAR_GM_ONLY === '1' || process.env.CALENDAR_GM_ONLY === 'true' ||
  process.env.WEATHER_GM_ONLY  === '1' || process.env.WEATHER_GM_ONLY  === 'true';
const AUTO_TICK_INTERVAL_MS = 5 * 60 * 1000;

let autoTickTimer = null;
let autoTickRunning = false;

function isGm(interaction) {
  if (!GM_ONLY) return true;
  if (process.env.BOT_OWNER_ID && String(interaction.user.id) === String(process.env.BOT_OWNER_ID)) return true;
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) || false;
}

function validateAutotickTime(value) {
  const text = String(value || '').trim();
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text);
  if (!match) throw new Error('Time must use 24-hour HH:MM format, like 06:00 or 18:30.');
  return text;
}

function validateTimezone(value) {
  const zone = String(value || '').trim();
  if (!zone) throw new Error('Timezone is required.');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date());
    return zone;
  } catch {
    throw new Error(`"${zone}" is not a valid IANA timezone. Try America/Chicago.`);
  }
}

function timeToMinutes(value) {
  const [hh, mm] = validateAutotickTime(value).split(':').map(Number);
  return hh * 60 + mm;
}

function getLocalClock(timeZone, now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
  const hour = Number(parts.hour === '24' ? '0' : parts.hour);
  const minute = Number(parts.minute);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + minute,
  };
}

function formatAutotickStatus(config) {
  const state = config.enabled ? 'enabled' : 'disabled';
  const last = config.lastRunLocalDate ? ` Last advanced on ${config.lastRunLocalDate}.` : '';
  return `Calendar auto-advance is **${state}**. Trigger time: **${config.time}** (${config.timezone}).${last}`;
}

const SEASON_EMOJI = { spring: '🌸', summer: '☀️', autumn: '🍂', winter: '❄️' };
const SEASON_LABEL = { spring: 'Spring', summer: 'Summer', autumn: 'Autumn', winter: 'Winter' };

// Ask the weather module (if available) to update its season for the given
// guild. Best-effort: if anything throws (e.g. weather state doesn't exist),
// we silently skip — calendar shouldn't fail because of weather.
//
// `cal` is the calendar engine to use (Golarion or Eberron). Both expose
// the same seasonOf API so this works for either setting.
async function syncWeatherSeason(weatherModule, guildId, date, cal) {
  if (!weatherModule || !date || !cal) return;
  try {
    const state = weatherModule.getWeather && weatherModule.getWeather(guildId);
    if (!state) return; // No weather set for this server; nothing to sync.
    const newSeason = cal.seasonOf(date.month);
    if (newSeason && newSeason !== state.season && weatherModule.setSeason) {
      await weatherModule.setSeason(guildId, newSeason);
    }
  } catch (err) {
    console.warn('[calendar] weather season sync failed (non-fatal):', err.message);
  }
}

// Build the embed shown by /calendar today. Engine-aware: works for both
// Golarion (deity-named months) and Eberron (moon-named months with dragonmarks).
function buildTodayEmbed(date, cal) {
  const monthDef = cal.RULES.months[date.month - 1];
  const wdName = cal.weekdayName(date.year, date.month, date.day);
  const wdDef = cal.RULES.weekdays.find(w => w.name === wdName);
  const moon = cal.getMoonPhase(date.year, date.month, date.day);
  const season = cal.seasonOf(date.month);
  const holidaysToday = cal.getHolidaysOn(date.year, date.month, date.day);
  const isLeap = cal.isLeapYear(date.year);

  // Golarion months have .deity; Eberron months have .moon + .dragonmark.
  // We pick whichever the engine provided so the heading reads correctly.
  const monthSubtitle = monthDef.deity
    ? monthDef.deity
    : (monthDef.dragonmark ? `Mark of ${monthDef.dragonmark}` : '');

  const embed = new EmbedBuilder()
    .setColor(0x9B59B6)
    .setTitle(`📅 ${cal.describeDate(date)}`)
    .setDescription(
      `*${wdDef?.blurb || ''}*\n\n` +
      `**${SEASON_EMOJI[season]} ${SEASON_LABEL[season]}** · ` +
      `**${moon.emoji} ${moon.name}${moon.moonName ? ` (${moon.moonName})` : ''}**${isLeap ? ' · 🌀 Leap Year' : ''}`
    )
    .addFields({
      name: monthSubtitle ? `${monthDef.name} — ${monthSubtitle}` : monthDef.name,
      value: monthDef.blurb,
    });

  if (holidaysToday.length > 0) {
    embed.addFields({
      name: '🎉 Today\'s Holidays',
      value: holidaysToday.map(h => `${h.emoji || ''} **${h.name}**${h.deity ? ` (${h.deity})` : ''} — ${h.blurb}`).join('\n\n'),
    });
  }

  // Always show the next upcoming holiday so the GM has something to look forward to.
  const next = cal.getNextHoliday(date.year, date.month, date.day);
  if (next) {
    embed.addFields({
      name: '⏭️ Next Holiday',
      value: `${next.holiday.emoji || ''} **${next.holiday.name}** in ${next.daysAway} day${next.daysAway === 1 ? '' : 's'} (${cal.describeDate(next.occursOn, { includeWeekday: false })})`,
    });
  }

  return embed;
}

// Build the embed shown by /calendar month — a grid view of the chosen month.
function buildMonthEmbed(year, month, today = null, cal) {
  const monthDef = cal.RULES.months[month - 1];
  const grid = cal.getMonthGrid(year, month, today);
  const isLeap = cal.isLeapYear(year);
  const len = cal.monthLength(month - 1, year);

  // Header row: short weekday names (2 letters)
  const header = cal.WEEKDAY_NAMES.map(n => `\`${n.slice(0, 2)}\``).join(' ');

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

  // Eberron's "every X day" recurring holidays (Tain Gala) need to be expanded
  // for the current month using resolveWeekdayHolidays. listHolidays gives
  // only fixed-date holidays.
  const monthHolidays = [
    ...cal.listHolidays(month),
    ...(cal.resolveWeekdayHolidays ? cal.resolveWeekdayHolidays(year, month) : []),
  ].sort((a, b) => a.day - b.day);

  const holidayLines = monthHolidays.map(h => {
    const dStr = cal.ordinal(h.day);
    return `${h.emoji || ''} **${dStr}** — ${h.name}${h.deity ? ` *(${h.deity})*` : ''}`;
  });

  // Year suffix and footer subtitle vary by setting.
  const suffix = yearSuffix(cal);
  const footer = monthDef.deity
    ? `${len} days · ${monthDef.deity}'s month`
    : (monthDef.moon ? `${len} days · the ${monthDef.moon} Moon (Mark of ${monthDef.dragonmark})` : `${len} days`);

  const embed = new EmbedBuilder()
    .setColor(0x9B59B6)
    .setTitle(`📅 ${monthDef.name} ${year} ${suffix}${isLeap ? ' (leap year)' : ''}`)
    .setDescription(
      `*${monthDef.blurb}*\n\n` +
      lines.join('\n') +
      (today && today.year === year && today.month === month ? `\n\n*Today: ${cal.ordinal(today.day)}*` : '') +
      `\n*\\* = holiday*`
    );
  if (monthHolidays.length > 0) {
    embed.addFields({ name: 'Holidays', value: holidayLines.join('\n') });
  }
  embed.setFooter({ text: footer });
  return embed;
}

// ── Main entry point ────────────────────────────────────────────────────────
async function handleCalendar(interaction, weatherModule = null) {
  if (!interaction.guildId) {
    return interaction.reply({ content: 'Calendar is per-server, so this command only works in a server.', ephemeral: true });
  }
  const guildId = interaction.guildId;
  const sub = interaction.options.getSubcommand();

  // The setting subcommand must run BEFORE we resolve `cal`, since it changes
  // which engine is active. Handle it first.
  if (sub === 'setting') {
    return cmdSetting(interaction, guildId);
  }
  if (sub === 'autotick') {
    return cmdAutotick(interaction, guildId);
  }

  // Resolve which engine to use for everything else.
  const cal = getEngine(guildId);

  // Defensive check: if the calendar rules failed to load at startup,
  // RULES will be null and every command will crash on a property access.
  if (!cal.RULES) {
    const setting = cal === eberronCalendar ? 'Eberron' : 'Golarion';
    return interaction.reply({
      content: `Calendar rules for ${setting} could not be loaded from Supabase. Check the deploy logs and confirm the calendar rules were imported.`,
      ephemeral: true,
    });
  }

  try {
    switch (sub) {
      case 'today':         return cmdToday(interaction, guildId, cal);
      case 'set':           return cmdSet(interaction, guildId, weatherModule, cal);
      case 'advance':       return cmdAdvance(interaction, guildId, weatherModule, cal);
      case 'month':         return cmdMonth(interaction, guildId, cal);
      case 'holidays':      return cmdHolidays(interaction, guildId, cal);
      case 'next-holiday':  return cmdNextHoliday(interaction, guildId, cal);
      case 'moon':          return cmdMoon(interaction, guildId, cal);
      case 'clear':         return cmdClear(interaction, guildId, cal);
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

// ── /calendar setting ───────────────────────────────────────────────────────
// Switches this server between Golarion and Eberron. With no argument, shows
// which is currently active. GM-gated like /calendar set.
async function cmdSetting(interaction, guildId) {
  const choice = interaction.options.getString('choice');
  if (!choice) {
    const current = settings.getCampaignSetting(guildId);
    return interaction.reply({
      content: `📜 This server is currently using **${settingLabel(current)}**.\n\nUse \`/calendar setting choice:eberron\` or \`/calendar setting choice:golarion\` to switch.`,
      ephemeral: true,
    });
  }
  if (!isGm(interaction)) return interaction.reply({ content: '❌ Only GMs can change the campaign setting.', ephemeral: true });
  await settings.setCampaignSetting(guildId, choice);
  const cal = getEngine(guildId);
  const seedDate = cal.RULES?.anchor || { year: 1, month: 1, day: 1 };
  return interaction.reply({
    content: `✅ Campaign setting switched to **${settingLabel(choice)}**.\n\n*Calendar/weather state is preserved across switches but may need re-seeding. Use \`/calendar today\` to see the new view, or \`/calendar set year:${seedDate.year} month:${seedDate.month} day:${seedDate.day}\` to start fresh from the canonical anchor (${cal === eberronCalendar ? '1 Zarantyr 998 YK' : '1 Abadius 4712 AR'}).*`,
  });
}

// ── /calendar autotick ──────────────────────────────────────────────────────
// Server-level real-time calendar advancement. Stored in bot settings, which
// are restored from and synced back to Supabase.
async function cmdAutotick(interaction, guildId) {
  if (!isGm(interaction)) {
    return interaction.reply({ content: 'Only GMs can change calendar auto-advance.', ephemeral: true });
  }

  const patch = {};
  const enabled = interaction.options.getBoolean('enabled');
  const time = interaction.options.getString('time');
  const timezone = interaction.options.getString('timezone');

  try {
    if (enabled !== null) patch.enabled = enabled;
    if (time) patch.time = validateAutotickTime(time);
    if (timezone) patch.timezone = validateTimezone(timezone);
  } catch (err) {
    return interaction.reply({ content: err.message, ephemeral: true });
  }

  if (Object.keys(patch).length > 0) {
    await settings.setCalendarAutotick(guildId, patch);
  }

  const config = settings.getCalendarAutotick(guildId);
  const prefix = Object.keys(patch).length > 0 ? 'Saved.' : 'Status.';
  return interaction.reply({
    content: `${prefix} ${formatAutotickStatus(config)}\n\nUse \`/calendar autotick enabled:true time:06:00 timezone:America/Chicago\` to change it.`,
    ephemeral: true,
  });
}

// ── /calendar today ─────────────────────────────────────────────────────────

async function cmdToday(interaction, guildId, cal) {
  let date = cal.getDate(guildId);
  if (!date) {
    await cal.ensureDate(guildId); // seed with anchor date on first use
    date = cal.getDate(guildId);
  }
  return interaction.reply({ embeds: [buildTodayEmbed(date, cal)] });
}

// ── /calendar set ───────────────────────────────────────────────────────────
async function cmdSet(interaction, guildId, weatherModule, cal) {
  if (!isGm(interaction)) return interaction.reply({ content: '❌ Only GMs can set the date.', ephemeral: true });
  const year = interaction.options.getInteger('year');
  const month = interaction.options.getInteger('month');
  const day = interaction.options.getInteger('day');
  await cal.setDate(guildId, year, month, day);
  await syncWeatherSeason(weatherModule, guildId, { year, month, day }, cal);
  const date = cal.getDate(guildId);
  syncGuildStateToSupabase(guildId, { calendar: buildCalendarSnapshot(guildId, date, cal) });
  const embed = buildTodayEmbed(date, cal)
    .setTitle(`📅 Date set — ${cal.describeDate({ year, month, day })}`);
  return interaction.reply({ embeds: [embed] });
}

// ── /calendar advance ───────────────────────────────────────────────────────
async function cmdAdvance(interaction, guildId, weatherModule, cal) {
  if (!isGm(interaction)) return interaction.reply({ content: '❌ Only GMs can advance time.', ephemeral: true });
  const days = interaction.options.getInteger('days');
  if (Math.abs(days) > 365 * 10) {
    return interaction.reply({ content: '❌ That\'s a lot. Limit is 10 years (3650 days) per call.', ephemeral: true });
  }
  await cal.ensureDate(guildId);
  await cal.advance(guildId, days);
  const date = cal.getDate(guildId);
  await syncWeatherSeason(weatherModule, guildId, date, cal);
  syncGuildStateToSupabase(guildId, { calendar: buildCalendarSnapshot(guildId, date, cal) });
  const verb = days >= 0 ? 'Advanced' : 'Rewound';
  const embed = buildTodayEmbed(date, cal)
    .setTitle(`⏭️ ${verb} ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`);
  return interaction.reply({ embeds: [embed] });
}

// ── /calendar month ─────────────────────────────────────────────────────────
async function cmdMonth(interaction, guildId, cal) {
  const today = cal.getDate(guildId);
  const year  = interaction.options.getInteger('year')  ?? today?.year  ?? cal.RULES.anchor.year;
  const month = interaction.options.getInteger('month') ?? today?.month ?? cal.RULES.anchor.month;
  if (month < 1 || month > 12) {
    return interaction.reply({ content: '❌ Month must be 1-12.', ephemeral: true });
  }
  return interaction.reply({ embeds: [buildMonthEmbed(year, month, today, cal)] });
}

// ── /calendar holidays ──────────────────────────────────────────────────────
async function cmdHolidays(interaction, guildId, cal) {
  const today = cal.getDate(guildId);
  const monthArg = interaction.options.getInteger('month');
  const month = monthArg ?? today?.month ?? null;
  const settingName = settings.getCampaignSetting(guildId);

  let holidays, title;
  if (month === null) {
    // For Eberron, recurring weekday holidays (Tain Gala) only make sense in
    // a specific month, so they're skipped from the global "all holidays" list.
    holidays = cal.listHolidays();
    title = settingName === 'eberron' ? '🎉 Holidays of Khorvaire' : '🎉 All Holidays of Golarion';
  } else {
    if (month < 1 || month > 12) {
      return interaction.reply({ content: '❌ Month must be 1-12.', ephemeral: true });
    }
    // For Eberron, also expand any recurring weekday-based holidays for this
    // month/year so Tain Gala etc. show up.
    const fixed = cal.listHolidays(month);
    const yearForExpand = today?.year ?? cal.RULES.anchor.year;
    const recur = cal.resolveWeekdayHolidays ? cal.resolveWeekdayHolidays(yearForExpand, month) : [];
    holidays = [...fixed, ...recur].sort((a, b) => (a.day ?? 0) - (b.day ?? 0));
    title = `🎉 Holidays in ${cal.MONTH_NAMES[month - 1]}`;
  }

  if (holidays.length === 0) {
    return interaction.reply({ content: `No holidays in ${cal.MONTH_NAMES[month - 1]}.`, ephemeral: true });
  }

  const lines = holidays.map(h => {
    const monthName = cal.MONTH_NAMES[(h.month ?? month) - 1];
    return `${h.emoji || ''} **${cal.ordinal(h.day)} ${monthName}** — ${h.name}${h.deity ? ` *(${h.deity})*` : ''}\n*${h.blurb}*`;
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
async function cmdNextHoliday(interaction, guildId, cal) {
  let date = cal.getDate(guildId);
  if (!date) { await cal.ensureDate(guildId); date = cal.getDate(guildId); }
  const next = cal.getNextHoliday(date.year, date.month, date.day);
  if (!next) return interaction.reply({ content: 'No upcoming holidays found within a year. (Something\'s odd.)', ephemeral: true });
  const todays = cal.getHolidaysOn(date.year, date.month, date.day);
  const embed = new EmbedBuilder()
    .setColor(0xE67E22)
    .setTitle(`${next.holiday.emoji || '🎉'} Next: ${next.holiday.name}`)
    .setDescription(`*${next.holiday.blurb}*\n\nIn **${next.daysAway} day${next.daysAway === 1 ? '' : 's'}** on **${cal.describeDate(next.occursOn)}**.${next.holiday.deity ? `\n\nPatron deity: **${next.holiday.deity}**.` : ''}`);
  if (todays.length > 0) {
    embed.addFields({
      name: '🎉 Today',
      value: todays.map(h => `${h.emoji || ''} **${h.name}**`).join('\n'),
    });
  }
  return interaction.reply({ embeds: [embed] });
}

// ── /calendar moon ──────────────────────────────────────────────────────────
// For Golarion, shows the single moon (Somal). For Eberron, shows the
// primary moon (Olarune) plus a compact line for each of the other 11.
async function cmdMoon(interaction, guildId, cal) {
  const today = cal.getDate(guildId);
  const year  = interaction.options.getInteger('year')  ?? today?.year  ?? cal.RULES.anchor.year;
  const month = interaction.options.getInteger('month') ?? today?.month ?? cal.RULES.anchor.month;
  const day   = interaction.options.getInteger('day')   ?? today?.day   ?? cal.RULES.anchor.day;
  try { cal.validateDate(year, month, day); }
  catch (err) { return interaction.reply({ content: `❌ ${err.message}`, ephemeral: true }); }

  const moon = cal.getMoonPhase(year, month, day);
  const date = { year, month, day };

  // Find when the primary moon is next full and next new — useful info for
  // spellcasters and lycanthropy tracking. Search up to one full cycle so
  // long-cycled moons (Olarune at 56d) still find their next full.
  let nextFull = null, nextNew = null;
  let cur = date;
  const searchDays = Math.max(60, moon.cycleDays + 1);
  for (let i = 1; i <= searchDays; i++) {
    cur = cal.addDays(cur.year, cur.month, cur.day, 1);
    const m = cal.getMoonPhase(cur.year, cur.month, cur.day);
    if (!nextFull && m.key === 'full') nextFull = { date: cur, daysAway: i };
    if (!nextNew  && m.key === 'new')  nextNew  = { date: cur, daysAway: i };
    if (nextFull && nextNew) break;
  }

  const titleSuffix = moon.moonName ? ` (${moon.moonName})` : '';
  const embed = new EmbedBuilder()
    .setColor(0x34495E)
    .setTitle(`${moon.emoji} ${moon.name}${titleSuffix}`)
    .setDescription(`On ${cal.describeDate(date)}.\n\nDay ${moon.dayOfCycle} of the ${moon.cycleDays}-day lunar cycle.${moon.blurb ? `\n\n*${moon.blurb}*` : ''}`);

  if (nextFull) embed.addFields({ name: '🌕 Next Full Moon', value: `${nextFull.daysAway} day${nextFull.daysAway === 1 ? '' : 's'} (${cal.describeDate(nextFull.date, { includeWeekday: false })})`, inline: true });
  if (nextNew)  embed.addFields({ name: '🌑 Next New Moon',  value: `${nextNew.daysAway} day${nextNew.daysAway === 1 ? '' : 's'} (${cal.describeDate(nextNew.date, { includeWeekday: false })})`, inline: true });

  // Eberron-specific: show all 12 moons in the night sky tonight. This is one
  // of the most distinctive bits of Eberron flavor — many lycanthropes change
  // when ANY moon is full, so seeing them all at a glance is important.
  if (cal.getAllMoonPhases) {
    const allMoons = cal.getAllMoonPhases(year, month, day);
    const lines = allMoons.map(m => `${m.emoji} **${m.moonName}** — ${m.name}`);
    // Split into two columns so the field stays readable
    const half = Math.ceil(lines.length / 2);
    embed.addFields(
      { name: 'Tonight\'s Sky (1 of 2)', value: lines.slice(0, half).join('\n'), inline: true },
      { name: 'Tonight\'s Sky (2 of 2)', value: lines.slice(half).join('\n'),    inline: true },
    );
    // Count moons currently full — important for lycanthropy
    const fullCount = allMoons.filter(m => m.key === 'full').length;
    if (fullCount > 0) {
      embed.setFooter({ text: `🐺 ${fullCount} moon${fullCount === 1 ? '' : 's'} currently full — afflicted lycanthropes change tonight.` });
    } else {
      embed.setFooter({ text: '🐺 No moons currently full. Afflicted lycanthropes hold their human form.' });
    }
  }

  return interaction.reply({ embeds: [embed] });
}

// ── /calendar clear ─────────────────────────────────────────────────────────
async function cmdClear(interaction, guildId, cal) {
  if (!isGm(interaction)) return interaction.reply({ content: '❌ Only GMs can clear the calendar.', ephemeral: true });
  await cal.clear(guildId);
  syncGuildStateToSupabase(guildId, { calendar: null });
  return interaction.reply({ content: '🗑️ Calendar state cleared for this server. Use `/calendar today` or `/calendar set` to start again.', ephemeral: true });
}

// ── Autocomplete handler ────────────────────────────────────────────────────
async function runCalendarAutotick(client, weatherModule = null) {
  if (autoTickRunning) return;
  autoTickRunning = true;
  try {
    const rows = settings.listCalendarAutotickGuilds();
    const now = new Date();
    for (const { guildId, config } of rows) {
      try {
        if (client?.guilds?.cache && !client.guilds.cache.has(guildId)) continue;
        const timeZone = validateTimezone(config.timezone);
        const triggerMinutes = timeToMinutes(config.time);
        const local = getLocalClock(timeZone, now);
        if (local.minutes < triggerMinutes) continue;
        if (config.lastRunLocalDate === local.date) continue;

        const cal = getEngine(guildId);
        if (!cal.RULES) {
          console.warn(`[calendar-autotick] skipped ${guildId}: calendar rules are not loaded`);
          continue;
        }

        await cal.ensureDate(guildId);
        await cal.advance(guildId, 1);
        const date = cal.getDate(guildId);
        await syncWeatherSeason(weatherModule, guildId, date, cal);
        await syncGuildStateToSupabase(guildId, { calendar: buildCalendarSnapshot(guildId, date, cal) });
        await settings.setCalendarAutotick(guildId, {
          lastRunLocalDate: local.date,
          lastRunAt: now.toISOString(),
        });
        console.log(`[calendar-autotick] advanced ${guildId} to ${cal.describeDate(date)} (${local.date} ${timeZone})`);
      } catch (err) {
        console.error(`[calendar-autotick] failed for guild ${guildId}:`, err.message);
      }
    }
  } finally {
    autoTickRunning = false;
  }
}

function startCalendarAutotick(client, weatherModule = null) {
  if (autoTickTimer) return;
  const run = () => runCalendarAutotick(client, weatherModule).catch(err => {
    console.error('[calendar-autotick] scheduler error:', err.message);
  });
  setTimeout(run, 15 * 1000);
  autoTickTimer = setInterval(run, AUTO_TICK_INTERVAL_MS);
  console.log('[calendar-autotick] scheduler started');
}

async function handleCalendarAutocomplete(interaction) {
  const guildId = interaction.guildId;
  const cal = guildId ? getEngine(guildId) : golarionCalendar;
  const focused = interaction.options.getFocused(true);
  const term = String(focused.value || '').toLowerCase();
  if (focused.name === 'month') {
    const choices = cal.MONTH_NAMES.map((n, i) => ({
      name: `${i + 1} — ${n}`,
      value: i + 1,
    }));
    const filtered = choices.filter(c => c.name.toLowerCase().includes(term)).slice(0, 25);
    return interaction.respond(filtered);
  }
  if (focused.name === 'choice') {
    // /calendar setting choice autocomplete
    const choices = [
      { name: 'Golarion (Inner Sea Calendar)', value: 'golarion' },
      { name: 'Eberron (Galifar Calendar)',    value: 'eberron'  },
    ];
    return interaction.respond(choices.filter(c => c.name.toLowerCase().includes(term)));
  }
  return interaction.respond([]);
}

module.exports = {
  handleCalendar,
  handleCalendarAutocomplete,
  startCalendarAutotick,
};
