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
const weather = require('../systems/weather');

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
function buildWeatherEmbed(state, weatherData, opts = {}) {
  const { title, footer, color = 0x5DADE2 } = opts;
  const climateLabel = weather.RULES.climates[state.climate]?.label || state.climate;
  const climateEmoji = CLIMATE_EMOJI[state.climate] || '';
  const seasonLabel = state.season.charAt(0).toUpperCase() + state.season.slice(1);

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title || `${climateEmoji} Weather — Day ${state.day}`)
    .setDescription(weather.describeWeather(weatherData))
    .addFields(
      { name: 'Climate', value: `${climateLabel} · ${seasonLabel}`, inline: true },
    );

  // Add a "mechanical effects" field only if there's something noteworthy.
  const mech = mechanicalSummary(weatherData);
  if (mech.length > 0) {
    embed.addFields({ name: 'Mechanical Effects', value: mech.join('\n') });
  }

  if (footer) embed.setFooter({ text: footer });
  return embed;
}

// Short bullet-list summary of mechanical impact, used inside the embed.
function mechanicalSummary(w) {
  if (!w) return [];
  const out = [];
  const tdef = weather.RULES.temperature[w.effectiveTemperatureCategory || w.temperatureCategory];
  if (tdef?.damage) {
    const dice = weather.RULES.damageTiers[tdef.damage.tier]?.dice;
    out.push(`• ${tdef.label}: ${dice} ${tdef.damage.type} damage every ${tdef.damage.interval} unprotected (fatigue at ${tdef.fatigueHours}h travel)`);
  }
  const pdef = weather.RULES.precipitation[w.precipitation];
  if (pdef?.perceptionPenalty) out.push(`• ${pdef.label}: ${pdef.perceptionPenalty} visual Perception`);
  if (pdef?.lightning) {
    const dice = weather.RULES.damageTiers[pdef.lightning.tier]?.dice;
    out.push(`• Lightning risk: ~${(pdef.lightning.chancePerHour * 100).toFixed(1)}%/hour, ${dice} ${pdef.lightning.type} damage on strike`);
  }
  const wdef = weather.RULES.wind[w.wind];
  if (wdef?.rangedImpossible) out.push(`• ${wdef.label}: ranged attacks impossible`);
  else if (wdef?.rangedPenalty) out.push(`• ${wdef.label}: ${wdef.rangedPenalty} ranged attacks, ${wdef.auditoryPenalty} auditory Perception`);
  const fdef = weather.RULES.fog[w.fog];
  if (fdef?.concealment) out.push(`• ${fdef.label}: creatures have concealment in fog (DC 5 flat to target)`);
  else if (fdef?.perceptionPenalty) out.push(`• ${fdef.label}: ${fdef.perceptionPenalty} visual Perception`);
  return out;
}

// Main entry point. The interaction's subcommand decides what we do.
async function handleWeather(interaction, encountersModule = null) {
  if (!interaction.guildId) {
    return interaction.reply({ content: 'Weather is per-server, so this command only works in a server.', ephemeral: true });
  }

  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  try {
    switch (sub) {
      case 'current':   return cmdCurrent(interaction, guildId);
      case 'climate':   return cmdClimate(interaction, guildId);
      case 'set':       return cmdSet(interaction, guildId);
      case 'roll':      return cmdRoll(interaction, guildId);
      case 'advance':   return cmdAdvance(interaction, guildId);
      case 'forecast':  return cmdForecast(interaction, guildId);
      case 'apply':     return cmdApply(interaction, guildId, encountersModule);
      case 'clear':     return cmdClear(interaction, guildId);
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

// ── /weather current ──────────────────────────────────────────────────────
async function cmdCurrent(interaction, guildId) {
  const state = weather.getWeather(guildId);
  if (!state) {
    return interaction.reply({
      content: 'No weather has been set for this server yet. Use `/weather climate` to pick a starting climate, or `/weather roll` to generate one.',
      ephemeral: true,
    });
  }
  const embed = buildWeatherEmbed(state, state.current);
  return interaction.reply({ embeds: [embed] });
}

// ── /weather climate ──────────────────────────────────────────────────────
async function cmdClimate(interaction, guildId) {
  if (!isGm(interaction)) return interaction.reply({ content: '❌ Only GMs can change the climate.', ephemeral: true });
  const climate = interaction.options.getString('climate');
  const season = interaction.options.getString('season') || null;
  if (!weather.isValidClimate(climate)) {
    return interaction.reply({ content: `❌ Unknown climate: \`${climate}\`. Try one of: ${weather.listClimates().map(c => c.key).join(', ')}`, ephemeral: true });
  }
  // First-time creation if needed
  await weather.ensureWeather(guildId, { climate, season: season || 'spring' });
  await weather.setClimate(guildId, climate, season);
  const state = weather.getWeather(guildId);
  const embed = buildWeatherEmbed(state, state.current, {
    title: `${CLIMATE_EMOJI[climate] || ''} Climate set: ${weather.RULES.climates[climate].label}`,
    footer: 'Today\'s weather has been re-rolled for the new climate.',
  });
  return interaction.reply({ embeds: [embed] });
}

// ── /weather set ──────────────────────────────────────────────────────────
async function cmdSet(interaction, guildId) {
  if (!isGm(interaction)) return interaction.reply({ content: '❌ Only GMs can set weather components.', ephemeral: true });
  const component = interaction.options.getString('component');
  const value = interaction.options.getString('value');
  await weather.setComponent(guildId, component, isNaN(Number(value)) ? value : Number(value));
  const state = weather.getWeather(guildId);
  const embed = buildWeatherEmbed(state, state.current, {
    title: `Weather updated — ${component} → ${value}`,
  });
  return interaction.reply({ embeds: [embed] });
}

// ── /weather roll ─────────────────────────────────────────────────────────
async function cmdRoll(interaction, guildId) {
  if (!isGm(interaction)) return interaction.reply({ content: '❌ Only GMs can roll new weather.', ephemeral: true });
  const state = weather.getWeather(guildId);
  if (!state) {
    return interaction.reply({ content: 'No climate set yet. Use `/weather climate` first.', ephemeral: true });
  }
  await weather.rollWeather(guildId);
  const fresh = weather.getWeather(guildId);
  const embed = buildWeatherEmbed(fresh, fresh.current, { title: '🎲 Rolled new weather for today' });
  return interaction.reply({ embeds: [embed] });
}

// ── /weather advance ──────────────────────────────────────────────────────
async function cmdAdvance(interaction, guildId) {
  if (!isGm(interaction)) return interaction.reply({ content: '❌ Only GMs can advance time.', ephemeral: true });
  const days = interaction.options.getInteger('days');
  const state = weather.getWeather(guildId);
  if (!state) {
    return interaction.reply({ content: 'No climate set yet. Use `/weather climate` first.', ephemeral: true });
  }
  await weather.advanceDays(guildId, days);
  const fresh = weather.getWeather(guildId);
  const embed = buildWeatherEmbed(fresh, fresh.current, {
    title: `⏭️ Advanced ${days} day${days === 1 ? '' : 's'} — now Day ${fresh.day}`,
  });
  return interaction.reply({ embeds: [embed] });
}

// ── /weather forecast ─────────────────────────────────────────────────────
async function cmdForecast(interaction, guildId) {
  const days = interaction.options.getInteger('days') || 3;
  if (days < 1 || days > 7) {
    return interaction.reply({ content: '❌ Forecast must be between 1 and 7 days.', ephemeral: true });
  }
  const state = weather.getWeather(guildId);
  if (!state) {
    return interaction.reply({ content: 'No climate set yet. Use `/weather climate` first.', ephemeral: true });
  }
  const forecast = weather.getForecast(guildId, days);
  const lines = forecast.map(d => {
    const t = weather.RULES.temperature[d.temperatureCategory] || {};
    const p = weather.RULES.precipitation[d.precipitation] || {};
    const w = weather.RULES.wind[d.wind] || {};
    const f = weather.RULES.fog[d.fog] || {};
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
async function cmdApply(interaction, guildId, encountersModule) {
  if (!isGm(interaction)) return interaction.reply({ content: '❌ Only GMs can apply weather to combatants.', ephemeral: true });
  if (!encountersModule) {
    return interaction.reply({ content: '❌ Encounter integration not available in this build.', ephemeral: true });
  }
  const state = weather.getWeather(guildId);
  if (!state) {
    return interaction.reply({ content: 'No weather set for this server. Use `/weather climate` first.', ephemeral: true });
  }
  const enc = encountersModule.getEncounter(interaction.channelId);
  if (!enc) {
    return interaction.reply({ content: '❌ No active encounter in this channel. Start one first, or apply weather effects manually with `/init effect`.', ephemeral: true });
  }
  const effects = weather.buildEffectsForCombatant(state.current, { appliedBy: 'weather' });
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
async function cmdClear(interaction, guildId) {
  if (!isGm(interaction)) return interaction.reply({ content: '❌ Only GMs can clear weather state.', ephemeral: true });
  await weather.clear(guildId);
  return interaction.reply({ content: '🗑️ Weather state cleared for this server.', ephemeral: true });
}

// ── Autocomplete handler ──────────────────────────────────────────────────
// Wire this up in index.js's interactionCreate handler the same way as your
// other autocompletes:
//   if (interaction.isAutocomplete() && interaction.commandName === 'weather') {
//     return weatherCmd.handleWeatherAutocomplete(interaction);
//   }
async function handleWeatherAutocomplete(interaction) {
  const sub = interaction.options.getSubcommand(false);
  const focused = interaction.options.getFocused(true);
  const term = String(focused.value || '').toLowerCase();
  let choices = [];

  if (sub === 'climate' && focused.name === 'climate') {
    choices = weather.listClimates().map(c => ({ name: `${c.emoji} ${c.label}`, value: c.key }));
  } else if (sub === 'climate' && focused.name === 'season') {
    choices = weather.SEASONS.map(s => ({ name: s.charAt(0).toUpperCase() + s.slice(1), value: s }));
  } else if (sub === 'set' && focused.name === 'value') {
    const component = interaction.options.getString('component');
    if (component && component !== 'temperature') {
      choices = weather.listChoices(component);
    }
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