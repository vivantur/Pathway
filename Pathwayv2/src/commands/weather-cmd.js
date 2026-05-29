// commands/weather-cmd.js
// /weather slash command handlers. Per-server scope, GM-controlled.
//
// Subcommands:
//   /weather current             — show today's weather and active effects
//   /weather climate climate season — set the channel's climate + season
//   /weather set component value — override one component
//   /weather roll                — re-roll today's weather
//   /weather advance days:N      — step forward N days
//   /weather forecast days:N     — peek at the next N days (no commit)
//   /weather apply               — apply weather effects to all combatants in this channel's encounter
//   /weather clear               — wipe weather state for this server
//
// Permission model:
//   By default, anyone can use /weather. If you want to gate it to GMs only,
//   set WEATHER_GM_ONLY=1 in your .env, and the GM check will use the same
//   "Manage Channels" permission your other commands use.
//
// Returned by handleWeather(interaction, encounters) — the encounters module
// is passed in so /weather apply can find the active encounter. Pass null if
// you don't want apply support (it'll just say "no encounter in this channel").

'use strict';

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const golarionWeather = require('../rules/weather');
const eberronWeather = require('../rules/eberronWeather');
const settings = require('../rules/settings');
const { syncGuildStateToSupabase } = require('../lib/storage');

function buildWeatherSnapshot(guildId, wx) {
  try {
    const state = wx.getWeather(guildId);
    if (!state || !state.current) return null;
    const c = state.current;
    return {
      climate: state.climate,
      season: state.season,
      day: state.day,
      temperatureF: c.temperatureF,
      temperatureCategory: c.temperatureCategory,
      effectiveTemperatureCategory: c.effectiveTemperatureCategory,
      precipitation: c.precipitation,
      wind: c.wind,
      fog: c.fog,
      soaked: c.soaked,
      description: wx.describeWeather(c),
      updatedAt: new Date().toISOString(),
    };
  } catch { return null; }
}

// Pick the right weather engine for a guild. Both engines export the same
// public API so handlers below can use `wx` interchangeably. Default is
// Golarion for backward compatibility.
function getEngine(guildId) {
  const setting = settings.getCampaignSetting(guildId);
  return setting === 'eberron' ? eberronWeather : golarionWeather;
}

function settingLabel(name) {
  return name === 'eberron' ? 'Eberron (14 climates incl. Mournland)' : 'Golarion (Inner Sea climates)';
}

const WEATHER_GM_ONLY = process.env.WEATHER_GM_ONLY === '1' || process.env.WEATHER_GM_ONLY === 'true';

function isGm(interaction) {
  if (!WEATHER_GM_ONLY) return true;
  // Same heuristic the rest of the bot can use: anyone with Manage Channels
  // counts as a GM. Bot owners always pass.
  if (process.env.BOT_OWNER_ID && String(interaction.user.id) === String(process.env.BOT_OWNER_ID)) return true;
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) || false;
}

const CLIMATE_EMOJI = { temperate: '🌳', tropical: '🌴', arctic: '🧊', desert: '🏜️', swamp: '🐊', coastal: '🌊', mountain: '🏔️', underground: '🕳️' };

// Build the embed shown by /weather current and /weather forecast (per day).
function buildWeatherEmbed(state, weatherData, opts = {}, wx = null) {
  if (!wx) throw new Error('buildWeatherEmbed: wx engine parameter required.');
  const { title, footer, color = 0x5DADE2 } = opts;
  const climateLabel = wx.RULES.climates[state.climate]?.label || state.climate;
  // Climate emoji: prefer the engine's own emoji (Eberron has continent-specific
  // ones), fall back to the CLIMATE_EMOJI map (Golarion's flat list).
  const climateEmoji = wx.RULES.climates[state.climate]?.emoji || CLIMATE_EMOJI[state.climate] || '';
  const seasonLabel = state.season.charAt(0).toUpperCase() + state.season.slice(1);

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title || `${climateEmoji} Weather — Day ${state.day}`)
    .setDescription(wx.describeWeather(weatherData))
    .addFields(
      { name: 'Climate', value: `${climateLabel} · ${seasonLabel}`, inline: true },
    );

  // Add a "mechanical effects" field only if there's something noteworthy.
  const mech = mechanicalSummary(weatherData, wx);
  if (mech.length > 0) {
    embed.addFields({ name: 'Mechanical Effects', value: mech.join('\n') });
  }

  if (footer) embed.setFooter({ text: footer });
  return embed;
}

// Short bullet-list summary of mechanical impact, used inside the embed.
function mechanicalSummary(w, wx) {
  if (!w || !wx) return [];
  const out = [];
  const tdef = wx.RULES.temperature[w.effectiveTemperatureCategory || w.temperatureCategory];
  if (tdef?.damage) {
    const dice = wx.RULES.damageTiers[tdef.damage.tier]?.dice;
    out.push(`• ${tdef.label}: ${dice} ${tdef.damage.type} damage every ${tdef.damage.interval} unprotected (fatigue at ${tdef.fatigueHours}h travel)`);
  }
  const pdef = wx.RULES.precipitation[w.precipitation];
  if (pdef?.perceptionPenalty) out.push(`• ${pdef.label}: ${pdef.perceptionPenalty} visual Perception`);
  if (pdef?.lightning) {
    const dice = wx.RULES.damageTiers[pdef.lightning.tier]?.dice;
    out.push(`• Lightning risk: ~${(pdef.lightning.chancePerHour * 100).toFixed(1)}%/hour, ${dice} ${pdef.lightning.type} damage on strike`);
  }
  if (pdef?.note) out.push(`• ${pdef.label}: ${pdef.note}`);
  const wdef = wx.RULES.wind[w.wind];
  if (wdef?.rangedImpossible) out.push(`• ${wdef.label}: ranged attacks impossible`);
  else if (wdef?.rangedPenalty) out.push(`• ${wdef.label}: ${wdef.rangedPenalty} ranged attacks, ${wdef.auditoryPenalty} auditory Perception`);
  const fdef = wx.RULES.fog[w.fog];
  if (fdef?.concealment) out.push(`• ${fdef.label}: creatures have concealment in fog (DC 5 flat to target)`);
  else if (fdef?.perceptionPenalty) out.push(`• ${fdef.label}: ${fdef.perceptionPenalty} visual Perception`);
  if (fdef?.note) out.push(`• ${fdef.label}: ${fdef.note}`);
  return out;
}

// Main entry point. The interaction's subcommand decides what we do.
async function handleWeather(interaction, encountersModule = null) {
  if (!interaction.guildId) {
    return interaction.reply({ content: 'Weather is per-server, so this command only works in a server.', ephemeral: true });
  }
  const guildId = interaction.guildId;
  const sub = interaction.options.getSubcommand();

  // The setting subcommand must run BEFORE we resolve `wx`, since it changes
  // which engine is active. Handle it first.
  if (sub === 'setting') {
    return cmdSetting(interaction, guildId);
  }

  // Resolve which engine to use for everything else.
  const wx = getEngine(guildId);

  // Defensive check: if the weather rules failed to load at startup,
  // RULES will be null and every command will crash on a property access.
  if (!wx.RULES) {
    const setting = wx === eberronWeather ? 'Eberron' : 'Golarion';
    return interaction.reply({
      content: `Weather rules for ${setting} could not be loaded from Supabase. Check the deploy logs and confirm the weather rules were imported.`,
      ephemeral: true,
    });
  }

  try {
    switch (sub) {
      case 'current':   return cmdCurrent(interaction, guildId, wx);
      case 'climate':   return cmdClimate(interaction, guildId, wx);
      case 'set':       return cmdSet(interaction, guildId, wx);
      case 'roll':      return cmdRoll(interaction, guildId, wx);
      case 'advance':   return cmdAdvance(interaction, guildId, wx);
      case 'forecast':  return cmdForecast(interaction, guildId, wx);
      case 'apply':     return cmdApply(interaction, guildId, encountersModule, wx);
      case 'clear':     return cmdClear(interaction, guildId, wx);
      default:          return interaction.reply({ content: `Unknown subcommand: ${sub}`, ephemeral: true });
    }
  } catch (err) {
    console.error(`/weather ${sub} error:`, err);
    if (interaction.replied || interaction.deferred) {
      return interaction.followUp({ content: `❌ ${err.message}`, ephemeral: true }).catch(() => {});
    }
    return interaction.reply({ content: `❌ ${err.message}`, ephemeral: true }).catch(() => {});
  }
}

// ── /weather setting ──────────────────────────────────────────────────────
// Switches this server between Golarion and Eberron weather. With no argument,
// shows current. GM-gated.
async function cmdSetting(interaction, guildId) {
  const choice = interaction.options.getString('choice');
  if (!choice) {
    const current = settings.getCampaignSetting(guildId);
    return interaction.reply({
      content: `🌦️ This server is currently using **${settingLabel(current)}**.\n\nUse \`/weather setting choice:eberron\` or \`/weather setting choice:golarion\` to switch.\n\n*Note: \`/calendar setting\` and \`/weather setting\` share the same value — switching one switches both.*`,
      ephemeral: true,
    });
  }
  if (!isGm(interaction)) return interaction.reply({ content: '❌ Only GMs can change the campaign setting.', ephemeral: true });
  await settings.setCampaignSetting(guildId, choice);
  const wx = getEngine(guildId);
  return interaction.reply({
    content: `✅ Campaign setting switched to **${settingLabel(choice)}**.\n\n*Weather state is preserved across switches but climate names differ. Use \`/weather climate\` to pick from the new climate list (${wx.listClimates().length} available).*`,
  });
}

// ── /weather current ──────────────────────────────────────────────────────
async function cmdCurrent(interaction, guildId, wx) {
  const state = wx.getWeather(guildId);
  if (!state) {
    return interaction.reply({
      content: 'No weather has been set for this server yet. Use `/weather climate` to pick a starting climate, or `/weather roll` to generate one.',
      ephemeral: true,
    });
  }
  const embed = buildWeatherEmbed(state, state.current, {}, wx);
  return interaction.reply({ embeds: [embed] });
}

// ── /weather climate ──────────────────────────────────────────────────────
async function cmdClimate(interaction, guildId, wx) {
  if (!isGm(interaction)) return interaction.reply({ content: '❌ Only GMs can change the climate.', ephemeral: true });
  const climate = interaction.options.getString('climate');
  const season = interaction.options.getString('season') || null;
  if (!wx.isValidClimate(climate)) {
    return interaction.reply({ content: `❌ Unknown climate: \`${climate}\`. Try one of: ${wx.listClimates().map(c => c.key).join(', ')}`, ephemeral: true });
  }
  // First-time creation if needed
  await wx.ensureWeather(guildId, { climate, season: season || 'spring' });
  await wx.setClimate(guildId, climate, season);
  syncGuildStateToSupabase(guildId, { weather: buildWeatherSnapshot(guildId, wx) });
  const state = wx.getWeather(guildId);
  // Climate emoji prefers engine-specific (Eberron) over the legacy CLIMATE_EMOJI map.
  const climEmoji = wx.RULES.climates[climate]?.emoji || CLIMATE_EMOJI[climate] || '';
  const embed = buildWeatherEmbed(state, state.current, {
    title: `${climEmoji} Climate set: ${wx.RULES.climates[climate].label}`,
    footer: 'Today\'s weather has been re-rolled for the new climate.',
  }, wx);
  return interaction.reply({ embeds: [embed] });
}

// ── /weather set ──────────────────────────────────────────────────────────
async function cmdSet(interaction, guildId, wx) {
  if (!isGm(interaction)) return interaction.reply({ content: '❌ Only GMs can set weather components.', ephemeral: true });
  const component = interaction.options.getString('component');
  const value = interaction.options.getString('value');
  await wx.setComponent(guildId, component, isNaN(Number(value)) ? value : Number(value));
  syncGuildStateToSupabase(guildId, { weather: buildWeatherSnapshot(guildId, wx) });
  const state = wx.getWeather(guildId);
  const embed = buildWeatherEmbed(state, state.current, {
    title: `Weather updated — ${component} → ${value}`,
  }, wx);
  return interaction.reply({ embeds: [embed] });
}

// ── /weather roll ─────────────────────────────────────────────────────────
async function cmdRoll(interaction, guildId, wx) {
  if (!isGm(interaction)) return interaction.reply({ content: '❌ Only GMs can roll new weather.', ephemeral: true });
  const state = wx.getWeather(guildId);
  if (!state) {
    return interaction.reply({ content: 'No climate set yet. Use `/weather climate` first.', ephemeral: true });
  }
  await wx.rollWeather(guildId);
  syncGuildStateToSupabase(guildId, { weather: buildWeatherSnapshot(guildId, wx) });
  const fresh = wx.getWeather(guildId);
  const embed = buildWeatherEmbed(fresh, fresh.current, { title: '🎲 Rolled new weather for today' }, wx);
  return interaction.reply({ embeds: [embed] });
}

// ── /weather advance ──────────────────────────────────────────────────────
async function cmdAdvance(interaction, guildId, wx) {
  if (!isGm(interaction)) return interaction.reply({ content: '❌ Only GMs can advance time.', ephemeral: true });
  const days = interaction.options.getInteger('days');
  const state = wx.getWeather(guildId);
  if (!state) {
    return interaction.reply({ content: 'No climate set yet. Use `/weather climate` first.', ephemeral: true });
  }
  await wx.advanceDays(guildId, days);
  syncGuildStateToSupabase(guildId, { weather: buildWeatherSnapshot(guildId, wx) });
  const fresh = wx.getWeather(guildId);
  const embed = buildWeatherEmbed(fresh, fresh.current, {
    title: `⏭️ Advanced ${days} day${days === 1 ? '' : 's'} — now Day ${fresh.day}`,
  }, wx);
  return interaction.reply({ embeds: [embed] });
}

// ── /weather forecast ─────────────────────────────────────────────────────
async function cmdForecast(interaction, guildId, wx) {
  const days = interaction.options.getInteger('days') || 3;
  if (days < 1 || days > 7) {
    return interaction.reply({ content: '❌ Forecast must be between 1 and 7 days.', ephemeral: true });
  }
  const state = wx.getWeather(guildId);
  if (!state) {
    return interaction.reply({ content: 'No climate set yet. Use `/weather climate` first.', ephemeral: true });
  }
  const forecast = wx.getForecast(guildId, days);
  const lines = forecast.map(d => {
    const t = wx.RULES.temperature[d.temperatureCategory] || {};
    const p = wx.RULES.precipitation[d.precipitation] || {};
    const w = wx.RULES.wind[d.wind] || {};
    const f = wx.RULES.fog[d.fog] || {};
    const parts = [`${t.emoji || ''} ${d.temperatureF}°F (${t.label})`, `${p.emoji || ''} ${p.label}`];
    if (d.wind !== 'calm' && d.wind !== 'light') parts.push(`${w.emoji || ''} ${w.label}`);
    if (d.fog !== 'none') parts.push(`${f.emoji || ''} ${f.label}`);
    return `**Day ${d.day}** — ${parts.join(' · ')}`;
  });
  const embed = new EmbedBuilder()
    .setColor(0x5DADE2)
    .setTitle(`📅 ${days}-Day Forecast`)
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'Forecasts are not committed to history. Use /weather advance to actually move forward.' });
  return interaction.reply({ embeds: [embed] });
}

// ── /weather apply ────────────────────────────────────────────────────────
async function cmdApply(interaction, guildId, encountersModule, wx) {
  if (!isGm(interaction)) return interaction.reply({ content: '❌ Only GMs can apply weather to combatants.', ephemeral: true });
  if (!encountersModule) {
    return interaction.reply({ content: '❌ Encounter integration not available in this build.', ephemeral: true });
  }
  const state = wx.getWeather(guildId);
  if (!state) {
    return interaction.reply({ content: 'No weather set for this server. Use `/weather climate` first.', ephemeral: true });
  }
  const enc = encountersModule.getEncounter(interaction.channelId);
  if (!enc) {
    return interaction.reply({ content: '❌ No active encounter in this channel. Start one first, or apply weather effects manually with `/init effect`.', ephemeral: true });
  }
  const effects = wx.buildEffectsForCombatant(state.current, { appliedBy: 'weather' });
  if (effects.length === 0) {
    return interaction.reply({ content: 'Current weather has no mechanical effects to apply.', ephemeral: true });
  }
  // Add each weather effect to every combatant. addEffect replaces same-named
  // effects, so re-running /weather apply just refreshes.
  let applied = 0;
  for (const c of enc.combatants) {
    for (const e of effects) {
      const r = encountersModule.addEffect(interaction.channelId, c.name, { ...e });
      if (r) applied++;
    }
  }
  const list = effects.map(e => `• ${e.name}`).join('\n');
  return interaction.reply({
    content: `⛅ Applied ${effects.length} weather effect${effects.length === 1 ? '' : 's'} to ${enc.combatants.length} combatant${enc.combatants.length === 1 ? '' : 's'} (${applied} total assignments).\n\n${list}\n\n*Effects last until removed with \`/init effect remove\` or until you re-run \`/weather apply\` after changing weather.*`,
  });
}

// ── /weather clear ────────────────────────────────────────────────────────
async function cmdClear(interaction, guildId, wx) {
  if (!isGm(interaction)) return interaction.reply({ content: '❌ Only GMs can clear weather state.', ephemeral: true });
  await wx.clear(guildId);
  syncGuildStateToSupabase(guildId, { weather: null });
  return interaction.reply({ content: '🗑️ Weather state cleared for this server.', ephemeral: true });
}

// ── Autocomplete handler ──────────────────────────────────────────────────
// Wire this up in index.js's interactionCreate handler the same way as your
// other autocompletes:
//   if (interaction.isAutocomplete() && interaction.commandName === 'weather') {
//     return weatherCmd.handleWeatherAutocomplete(interaction);
//   }
async function handleWeatherAutocomplete(interaction) {
  const guildId = interaction.guildId;
  const wx = guildId ? getEngine(guildId) : golarionWeather;
  const sub = interaction.options.getSubcommand(false);
  const focused = interaction.options.getFocused(true);
  const term = String(focused.value || '').toLowerCase();
  let choices = [];

  if (sub === 'climate' && focused.name === 'climate') {
    choices = wx.listClimates().map(c => ({ name: `${c.emoji} ${c.label}`, value: c.key }));
  } else if (sub === 'climate' && focused.name === 'season') {
    choices = wx.SEASONS.map(s => ({ name: s.charAt(0).toUpperCase() + s.slice(1), value: s }));
  } else if (sub === 'set' && focused.name === 'value') {
    const component = interaction.options.getString('component');
    if (component && component !== 'temperature') {
      choices = wx.listChoices(component);
    }
  } else if (sub === 'setting' && focused.name === 'choice') {
    choices = [
      { name: 'Golarion (Inner Sea Calendar)', value: 'golarion' },
      { name: 'Eberron (Galifar Calendar)',    value: 'eberron'  },
    ];
  }

  const filtered = choices
    .filter(c => c.name.toLowerCase().includes(term) || c.value.toLowerCase().includes(term))
    .slice(0, 25);
  return interaction.respond(filtered);
}

module.exports = {
  handleWeather,
  handleWeatherAutocomplete,
};
