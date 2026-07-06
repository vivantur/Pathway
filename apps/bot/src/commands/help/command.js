const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

const HELP_CATEGORIES = {
  character: {
    emoji: '🧙',
    label: 'Character',
    blurb: 'Import, display, and manage your saved characters. For editing fields, see the Edit category.',
    commands: [
      { name: '/char add', summary: 'Add a character by uploading a Pathbuilder `.json` or `.txt` file.', options: 'file', example: '/char add file:[attach file]' },
      { name: '/char update', summary: 'Refresh an existing character from an uploaded JSON file, Pathbuilder ID, or Pathway web JSON ID. Keeps your overlay additions.', options: 'file or id', example: '/char update id:122550' },
      { name: '/char import', summary: 'Import directly from a Pathbuilder ID/URL or Pathway web JSON ID.', options: 'id', example: '/char import id:1a501305-de50-4391-a0cf-44f4c5869d3d' },
      { name: '/char create', summary: 'Create a blank character sheet through a popup, then fill in the rest with edit commands.', options: '', example: '/char create' },
      { name: '/char template', summary: 'Get a blank fill-in-the-blanks character template (.txt). Build NPCs or homebrew characters from scratch.', options: '', example: '/char template' },
      { name: '/char dump', summary: 'Export a character as an editable .txt file. For heavy modifications or sharing.', options: 'character', example: '/char dump character:Khyber' },
      { name: '/char howto', summary: 'Platform-specific step-by-step guidance for getting your character sheet into the bot.', options: '', example: '/char howto' },
      { name: '/char list', summary: 'List all your saved characters.', example: '/char list' },
      { name: '/char remove', summary: 'Delete a saved character.', options: 'name', example: '/char remove name:Hylia' },
      { name: '/char active', summary: 'Set a default character so you don\'t have to type character: every time.', options: 'character (or action:clear)', example: '/char active character:Hylia' },
      { name: '/char serveractive', summary: 'Set a default character only for the current Discord server.', options: 'character (or action:clear)', example: '/char serveractive character:Hylia' },
      { name: '/char art', summary: 'Set a portrait URL shown on your character\'s rolls and sheets.', options: 'url, character', example: '/char art url:https://... character:Hylia' },
      { name: '/sheet', summary: 'Display a full character sheet with skills, attacks, and defenses.', options: 'name', example: '/sheet' },
      { name: '/feats', summary: 'Show your character\'s feats in a compact block.', options: 'character', example: '/feats' },
      { name: '/description', summary: 'View or edit your character description, appearance, and personality notes.', options: 'action, character', example: '/description action:edit' },
      { name: '/portrait', summary: 'Show your character\'s current portrait art, large. Hint: set one with `/char art`.', options: 'character', example: '/portrait' },
      { name: '/hp', summary: 'Out-of-combat HP tracking. Set/heal/damage your character\'s HP between fights.', options: '(subcommands: view, set, add, reset, max)', example: '/hp max value:52' },
      { name: '/recovery', summary: 'Roll a PF2e recovery check for your dying character outside initiative.', options: 'character, set_dying', example: '/recovery set_dying:1' },
      { name: '/xp', summary: 'Track experience per character. Award XP, view history, or clear old log entries.', options: '(subcommands: award, view, history, clearlog, set, reset)', example: '/xp award character:Hylia amount:80' },
      { name: '/hero', summary: 'Track and use Hero Points (PF2e: max 3, start with 1 per session).', options: '(subcommands)', example: '/hero use' },
      { name: '/notes', summary: 'Per-character session notebook: NPCs, Locations, Plot Threads, Influence, Items.', options: '(subcommands: add, list, view, search, edit, remove, pin)', example: '/notes add category:NPCs text:Met Lord Aldori' },
      { name: '/resource show', summary: 'View current focus points, hero points, and spell slots.', options: 'character', example: '/resource show' },
      { name: '/resource set', summary: 'Manually override a daily resource value.', options: 'resource, value, rank, caster, character', example: '/resource set resource:focus value:0' },
      { name: '/rest', summary: 'Long rest: refill slots, focus points, hero points. Clears prepared list (with confirm).', options: 'character', example: '/rest' },
      { name: '/refocus', summary: '10-minute refocus. Regain 1 focus point.', options: 'character', example: '/refocus' },
      { name: '/bag', summary: 'Manage your inventory beyond what\'s in the Pathbuilder export.', options: '(subcommands)', example: '/bag add category:Consumables item:Elixir of Life' },
      { name: '/gold', summary: 'Manage currency (pp/gp/sp/cp).', options: '(subcommands)', example: '/gold add gp:10' },
    ],
  },

  charedit: {
    emoji: '✏️',
    label: 'Edit',
    blurb: 'Edit individual character fields: skills, abilities, stats, weapons, items. Edits are preserved across re-imports.',
    commands: [
      { name: '/char edit', summary: 'Edit background, deity, languages, senses on your active character (opens a popup).', options: '', example: '/char edit' },
      { name: '/char identity', summary: 'Popup to edit class, subclass, level, ancestry, heritage.', options: '', example: '/char identity' },
      { name: '/char misc', summary: 'Popup to edit gender, age, size, alignment, key ability.', options: '', example: '/char misc' },
      { name: '/char ability', summary: 'Override an ability score (STR/DEX/CON/INT/WIS/CHA). Use actual score (18 = +4 mod).', options: 'field, value, action', example: '/char ability field:str value:18' },
      { name: '/char stat', summary: 'Override a combat stat: AC, HP max, saves, Perception, Speed. Use `action:clear` to revert.', options: 'field, value, action', example: '/char stat field:ac value:19' },
      { name: '/char skill', summary: 'Set a skill\'s proficiency rank (trained/expert/...) or flat total.', options: 'name, rank, total', example: '/char skill name:Athletics rank:expert' },
      { name: '/char lore', summary: 'Add, edit, or remove a Lore skill (e.g. Lore: Dragon). Set `remove:True` to delete.', options: 'topic, rank, total, remove', example: '/char lore topic:Dragon rank:expert' },
      { name: '/char weapon', summary: 'Add, edit, or remove weapons/attacks. Fill gaps from PDF imports or track new gear.', options: 'action, name, attack, damage, type, traits', example: '/char weapon action:add name:"Greatsword" attack:10 damage:1d12+4 type:S' },
      { name: '/char spellcasting', summary: 'Override spell DC, attack, tradition, or key ability on the primary spellcaster.', options: 'field, value, text_value, action', example: '/char spellcasting field:dc value:18' },
      { name: '/char item', summary: 'Add, edit, or remove non-weapon inventory items.', options: 'action, name, quantity', example: '/char item action:add name:"Rope" quantity:1' },
      { name: '/char money', summary: 'Set coin counts (gp, sp, cp, pp). Use action:clear to revert.', options: 'gp, sp, cp, pp, action', example: '/char money gp:55 sp:10' },
      { name: '/char feat', summary: 'Add or remove feats that didn\'t come through the import.', options: 'action, name, level, character', example: '/char feat action:add name:"Power Attack"' },
    ],
  },

  roll: {
    emoji: '🎲',
    label: 'Rolls',
    blurb: 'Dice rolling, skill checks, saves, and reusable snippets.',
    commands: [
      { name: '/roll', summary: 'Roll dice with full expression support, plus modifiers like `adv`, `dis`, `crit`, `rr1`, and iterations (`4#`).', options: 'dice', example: '/roll dice:1d20+7 adv' },
      { name: '/skill', summary: 'Roll a skill check using your character\'s bonuses.', options: 'skill, character, bonus', example: '/skill skill:Athletics' },
      { name: '/perception', summary: 'Roll a Perception check (Wis + proficiency).', options: 'character, bonus', example: '/perception' },
      { name: '/save', summary: 'Roll a saving throw (Fortitude, Reflex, or Will).', options: 'type, character, bonus', example: '/save type:Reflex' },
      { name: '/snippet create', summary: 'Create a personal roll snippet. Use `%1`, `%2` etc. for args (e.g. `+%1:2d6[sneak]`).', options: 'name, expand', example: '/snippet create name:sneaky expand:+%1:2d6[sneak]' },
      { name: '/snippet list', summary: 'List all your personal roll snippets.', options: '', example: '/snippet list' },
      { name: '/snippet view', summary: 'Show what a personal snippet expands to, and its arguments.', options: 'name', example: '/snippet view name:sneaky' },
      { name: '/snippet delete', summary: 'Delete one of your personal snippets.', options: 'name', example: '/snippet delete name:sneaky' },
      { name: '/serversnippet create', summary: 'GM only: create a server-wide snippet everyone on this server can use. Requires Manage Server.', options: 'name, expand', example: '/serversnippet create name:bless expand:+1d4' },
      { name: '/serversnippet list', summary: 'Show all server-wide snippets for this server.', options: '', example: '/serversnippet list' },
      { name: '/serversnippet view', summary: 'Show what a server snippet expands to.', options: 'name', example: '/serversnippet view name:bless' },
      { name: '/serversnippet delete', summary: 'GM only: remove a server-wide snippet. Requires Manage Server.', options: 'name', example: '/serversnippet delete name:bless' },
    ],
  },

  spells: {
    emoji: '🔮',
    label: 'Spells',
    blurb: 'Cast, learn, prepare, and look up spells. Overlay-added spells survive Pathbuilder re-imports.',
    commands: [
      { name: '/spell', summary: 'Look up any spell in the database.', options: 'name', example: '/spell name:Fireball' },
      { name: '/spellbook', summary: 'Show your character\'s full spell list grouped by rank with slot pips.', options: 'name', example: '/spellbook' },
      { name: '/prepared', summary: "Show ONLY today's prepared spells (prepared casters) plus cantrips. Quick combat view.", options: 'name', example: '/prepared' },
      { name: '/cast', summary: 'Cast a spell. Auto-spends a slot and warns if out of slots or unprepared.', options: 'spell, target, character, level', example: '/cast spell:Heal target:Fighter' },
      { name: '/spells learn', summary: 'Add a spell to a caster\'s spellbook permanently (wizards, witches, etc.).', options: 'spell, caster, character', example: '/spells learn spell:Fireball caster:Wizard' },
      { name: '/spells forget', summary: 'Remove a spell you previously learned via overlay.', options: 'spell, caster, character', example: '/spells forget spell:Fireball' },
      { name: '/spells prepare', summary: 'Prepare a spell into today\'s slot (prepared casters).', options: 'spell, rank, caster, character', example: '/spells prepare spell:Heal rank:1' },
      { name: '/spells unprepare', summary: 'Unfill a prepared slot.', options: 'spell, rank, caster, character', example: '/spells unprepare spell:Heal rank:1' },
      { name: '/spells swap', summary: 'Swap a known spell (spontaneous caster repertoire change).', options: 'remove, add, rank, caster, character', example: '/spells swap remove:Bane add:Bless rank:1' },
      { name: '/spells list', summary: 'Show merged spellbook with ✨ on overlay-added spells.', options: 'caster, character', example: '/spells list' },
    ],
  },

  combat: {
    emoji: '⚔️',
    label: 'Combat',
    blurb: 'Encounter tracker, initiative, attacks, and effects. Now with auto-MAP, dying/wounded, persistent damage, and reaction prompts.',
    commands: [
      { name: '/init start', summary: 'Start a new encounter in this channel (GM).', example: '/init start' },
      { name: '/init end', summary: 'End the current encounter.', example: '/init end' },
      { name: '/init add', summary: 'Add a combatant to the current encounter.', options: 'name, initiative, hp, (gm flags)', example: '/init add name:Goblin 1 initiative:18 hp:6' },
      { name: '/init addmonster', summary: 'GM: add a bestiary monster with auto-filled HP/AC/perception. Supports multi-spawn.', options: 'monster, count, init_mode, hp_mode, bonus', example: '/init addmonster monster:Goblin Warrior count:4' },
      { name: '/init addnpc', summary: 'GM: add a custom NPC with manual stats (for homebrew).', options: 'name, bonus, hp, ac', example: '/init addnpc name:Bandit Captain bonus:6 hp:45 ac:20' },
      { name: '/init attack', summary: 'GM: roll an NPC monster\'s bestiary attack against a target. Auto-fills bonus, damage, traits.', options: 'monster, attack, target, bonus, map', example: '/init attack monster:Goblin Warrior attack:dogslicer target:Fighter' },
      { name: '/init remove', summary: 'Remove a combatant.', options: 'name', example: '/init remove name:Goblin 1' },
      { name: '/init next', summary: 'Advance turn. Auto-rolls persistent damage and recovery checks.', example: '/init next' },
      { name: '/init hp', summary: 'Modify a combatant\'s HP. Auto-applies dying when reduced to 0.', options: 'name, change', example: '/init hp name:Fighter change:-12' },
      { name: '/init dying', summary: 'GM: manually set a combatant\'s dying value (0–4).', options: 'name, value', example: '/init dying name:Fighter value:0' },
      { name: '/init recovery', summary: 'Manually roll a recovery check for a dying combatant. Use if auto-roll didn\'t fire.', options: 'name', example: '/init recovery name:Fighter' },
      { name: '/init move', summary: 'Declare a combatant moves. Prompts all combatants with reactions for AoO.', options: 'name', example: '/init move name:Fighter' },
      { name: '/init reaction', summary: 'Manually prompt a specific combatant for a reaction (Shield Block, etc.).', options: 'name, reason', example: '/init reaction name:Fighter reason:Shield Block' },
      { name: '/init damage', summary: 'Manually roll persistent damage on a combatant outside the normal turn tick.', options: 'name', example: '/init damage name:Fighter' },
      { name: '/init effect', summary: 'Apply a status effect. Includes persistent-fire/bleed/etc. and dying/wounded.', options: '(subcommands)', example: '/init effect add name:Fighter effect:persistent-fire value:1' },
    ],
  },

  lookup: {
    emoji: '📚',
    label: 'Lookup',
    blurb: 'Look up anything from the PF2e rulebooks.',
    commands: [
      { name: '/ancestry', summary: 'Look up a PF2e ancestry (Core, Heritages, Feats across 3 pages).', options: 'name', example: '/ancestry name:Elf' },
      { name: '/archetype', summary: 'Look up a PF2e archetype.', options: 'name', example: '/archetype name:Assassin' },
      { name: '/background', summary: 'Look up a PF2e background.', options: 'name', example: '/background name:Acolyte' },
      { name: '/feat', summary: 'Look up a feat. Filter by level to disambiguate same-named feats.', options: 'name, level', example: '/feat name:Power Attack' },
      { name: '/item', summary: 'Look up an item, weapon, armor, or gear. Filter by level for tiered versions.', options: 'name, level', example: '/item name:Healing Potion level:3' },
      { name: '/rule', summary: 'Look up a condition, action, or trait.', options: 'name', example: '/rule name:frightened' },
      { name: '/monster', summary: 'Look up a creature from the bestiary.', options: 'name', example: '/monster name:Ancient Red Dragon' },
      { name: '/deity', summary: 'Look up a deity.', options: 'name', example: '/deity name:Pharasma' },
      { name: '/skillinfo', summary: 'Learn how a skill works: uses, actions by proficiency, DC examples. Shows your modifier if you have a character loaded.', options: 'skill, character', example: '/skillinfo skill:Athletics' },
      { name: '/class', summary: 'Look up a PF2e class with 5-page navigation: overview, proficiencies, features, class feats, subclass.', options: 'class, character', example: '/class class:Fighter' },
      { name: '/companion', summary: 'Look up animal/plant/undead companions. Shows stats, support benefit, and advanced maneuver.', options: '(subcommands: info, list)', example: '/companion info name:Wolf' },
      { name: '/companion import', summary: 'Import a Pathbuilder companion statblock PDF into your character companions.', options: 'file, name, form, character', example: '/companion import file:Abysspdf.pdf name:Abyss' },
      { name: '/companion art', summary: 'Set a portrait image URL for one of your companions. Shows on the sheet.', options: 'url, companion, character', example: '/companion art url:https://... companion:Fluffy' },
      { name: '/companion set', summary: 'Override any companion stat (ability scores, AC, HP, saves, attack, damage, speed, size).', options: 'stat, value, companion, character', example: '/companion set stat:ac value:22 companion:Fluffy' },
      { name: '/companion reset', summary: 'Clear one override so the stat auto-scales again.', options: 'stat, companion, character', example: '/companion reset stat:ac companion:Fluffy' },
      { name: '/companion resetall', summary: 'Clear ALL stat overrides on a companion (keeps art and notes).', options: 'companion, character', example: '/companion resetall companion:Fluffy' },
      { name: '/companion attack', summary: 'Add, remove, or list custom attacks for a companion.', options: 'action, name, bonus, damage, type, traits, companion, character', example: '/companion attack action:add name:breath bonus:12 damage:3d6 type:fire' },
      { name: '/companion ability', summary: 'Add, remove, or list abilities (free-form text or structured actions).', options: 'action, name, description, action_cost, companion, character', example: '/companion ability action:add name:Pack Attack description:+1 circumstance bonus when adjacent ally threatens' },
      { name: '/companion skill', summary: 'Set, clear, or list skill bonuses on a companion. Free-form (any skill name).', options: 'action, name, bonus, companion, character', example: '/companion skill action:set name:Athletics bonus:8' },
      { name: '/companion notes', summary: 'Set or clear free-form notes on a companion.', options: 'text, companion, character', example: '/companion notes text:Bonded in the dragon\'s lair' },
    ],
  },

  gm: {
    emoji: '🎲',
    label: 'GM Tools',
    blurb: 'Stat-block editing, monster attacks, and GM-only utilities.',
    commands: [
      { name: '/monsteradd paste', summary: 'Bot-owner only: add a missing creature to the global bestiary from pasted text.', options: 'statblock', example: '/monsteradd paste statblock:[paste AoN text]' },
      { name: '/monsteradd file', summary: 'Bot-owner only: add a creature from a .txt file.', options: 'file', example: '/monsteradd file file:[.txt attachment]' },
      { name: '/monsteradd remove', summary: 'Bot-owner only: remove a creature from the bestiary.', options: 'monster', example: '/monsteradd remove monster:Adult Bog Dragon' },
      { name: '/spelladd paste', summary: 'Bot-owner only: add a homebrew spell to the global database from pasted text.', options: 'statblock', example: '/spelladd paste statblock:[paste AoN text]' },
      { name: '/spelladd file', summary: 'Bot-owner only: add a homebrew spell from a .txt file.', options: 'file', example: '/spelladd file file:[.txt attachment]' },
      { name: '/spelladd remove', summary: 'Bot-owner only: remove a homebrew spell from the database.', options: 'spell', example: '/spelladd remove spell:Mind Lash' },
      { name: '/itemadd paste', summary: 'Bot-owner only: add a homebrew item to the global database from pasted text.', options: 'statblock', example: '/itemadd paste statblock:[paste AoN text]' },
      { name: '/itemadd file', summary: 'Bot-owner only: add a homebrew item from a .txt file.', options: 'file', example: '/itemadd file file:[.txt attachment]' },
      { name: '/itemadd remove', summary: 'Bot-owner only: remove a homebrew item from the database.', options: 'item', example: '/itemadd remove item:Flaming Rapier' },
      { name: '/monsterart set', summary: 'Attach a custom image to a monster\'s stat block for this server.', options: 'monster, url', example: '/monsterart set monster:Goblin Warrior url:https://...' },
      { name: '/monsterart remove', summary: 'Remove the custom image for a monster on this server.', options: 'monster', example: '/monsterart remove monster:Goblin Warrior' },
      { name: '/monsterart view', summary: 'View saved art for one monster, or list all saved art on this server.', options: 'monster', example: '/monsterart view' },
      { name: '/monsteredit', summary: 'Override or add stat-block fields for a monster on this server.', options: '(many subcommands)', example: '/monsteredit ability monster:Goblin name:Sneak Attack' },
      { name: '/mattack', summary: 'Manual monster attack — type bonus + damage yourself. For monsters from /init addmonster, prefer /init attack (it auto-fills both).', options: 'attacker, target, name, bonus, damage', example: '/mattack attacker:Captain target:Fighter name:Crossbow bonus:8 damage:1d8+3' },
      { name: '/m attack', summary: 'Save and manage a per-server library of reusable monster attacks (strikes, spell attacks, save-based). Used by /init attack, /mattack, and /m attack use.', options: 'add, addspell, addsave, remove, clear, list, use', example: '/m attack add monster:Goblin attack:Shortsword bonus:8 damage:1d6+2' },
    ],
  },
};

// Build one or more help embeds for a given category. Returns an array because
// Discord caps a single embed's total character count at 6000, so popular
// categories (character now has 49 commands) need to be split across embeds.
// A single Discord message supports up to 10 embeds so this is plenty of room.
function buildHelpEmbeds(categoryKey) {
  const cat = HELP_CATEGORIES[categoryKey] ?? HELP_CATEGORIES.character;
  // Discord limits (tight safety margins; the previous 5500 target hit edge cases):
  //   - single embed total: 6000 (we target 5000, hard cap enforced)
  //   - single field value: 1024 (we target 950)
  const maxEmbedTotalLen = 5000;
  const maxFieldLen = 950;

  const embeds = [];
  let embed = null;
  let embedPartIdx = 1;
  let embedTotalLen = 0;
  let fieldBuf = '';
  let fieldPartIdx = 1;

  const title = `${cat.emoji} Pathway Help — ${cat.label}`;
  const blurb = cat.blurb ?? '';

  const startNewEmbed = () => {
    embed = new EmbedBuilder().setColor(0x4a90d9);
    if (embedPartIdx === 1) {
      embed.setTitle(title).setDescription(blurb);
      embedTotalLen = title.length + blurb.length;
    } else {
      embed.setTitle(`${title} (part ${embedPartIdx})`);
      embedTotalLen = title.length + 10;
    }
    embeds.push(embed);
    embedPartIdx++;
    fieldPartIdx = 1;
  };

  const flushField = () => {
    if (!fieldBuf) return;
    const fieldName = fieldPartIdx === 1 ? 'Commands' : `Commands (cont. ${fieldPartIdx})`;
    const addedLen = fieldName.length + fieldBuf.length;
    if (embed === null || embedTotalLen + addedLen > maxEmbedTotalLen) {
      startNewEmbed();
    }
    embed.addFields({ name: fieldName, value: fieldBuf.trim(), inline: false });
    embedTotalLen += addedLen;
    fieldPartIdx++;
    fieldBuf = '';
  };

  startNewEmbed();
  for (const cmd of cat.commands) {
    const block = `**${cmd.name}**\n${cmd.summary}` +
      (cmd.options ? `\n  *Options:* ${cmd.options}` : '') +
      (cmd.example ? `\n  *Example:* \`${cmd.example}\`` : '') + '\n\n';
    if (fieldBuf.length + block.length > maxFieldLen) flushField();
    fieldBuf += block;
  }
  flushField();

  embeds[embeds.length - 1].setFooter({ text: 'Pick a category below' });
  return embeds;
}

// Backwards-compat shim for any remaining call sites that want a single embed.
function buildHelpEmbed(categoryKey) {
  return buildHelpEmbeds(categoryKey)[0];
}

function buildHelpButtons(currentCategory) {
  // Discord limits a single ActionRow to 5 buttons. We now have 7 categories,
  // so split across two rows. Return an array of rows; callers need to spread
  // this into the `components` array.
  const entries = Object.entries(HELP_CATEGORIES);
  const rows = [];
  for (let i = 0; i < entries.length; i += 5) {
    const row = new ActionRowBuilder();
    for (const [key, cat] of entries.slice(i, i + 5)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`help_${key}`)
          .setLabel(cat.label)
          .setEmoji(cat.emoji)
          .setStyle(key === currentCategory ? ButtonStyle.Primary : ButtonStyle.Secondary)
          .setDisabled(key === currentCategory),
      );
    }
    rows.push(row);
  }
  return rows;
}

// ── Bot ready ─────────────────────────────────────────────────────────────────

async function execute(interaction) {
  const topic = interaction.options.getString('topic');
  const startCategory = topic && HELP_CATEGORIES[topic] ? topic : 'character';
  const embeds = buildHelpEmbeds(startCategory);
  const rows = buildHelpButtons(startCategory);
  const isDM = !interaction.guildId;
  return interaction.reply({ embeds, components: rows, ephemeral: isDM });
}

async function handle(interaction) {
  const category = interaction.customId.slice('help_'.length);
  if (!HELP_CATEGORIES[category]) {
    return interaction.update({ content: '? Unknown help category.', embeds: [], components: [] });
  }
  return interaction.update({
    embeds: buildHelpEmbeds(category),
    components: buildHelpButtons(category),
  });
}

module.exports = {
  name: 'help',
  prefixes: ['help_'],
  execute,
  handle,
  HELP_CATEGORIES,
  buildHelpEmbeds,
  buildHelpButtons,
};
