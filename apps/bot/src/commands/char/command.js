const fetch = require('node-fetch');
const {
  EmbedBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const characterState = require('../../state/characters');
const {
  fetchPathwayCharacter,
  saveImportedCharacter,
} = require('../../lib/pathwayWebClient');
const { syncActiveCharacterToSupabase } = require('../../lib/storage');
const { calcProfNum } = require('../../lib/format');
const {
  computeCharSkillModifier,
  calcCharacterProfNum,
  characterProfValue,
} = require('../../rules/pf2eMath');
const { loreKey, loreTopicLabel, isLoreProficiencyKey } = require('../../rules/lore');

const {
  computeCharMaxHp,
  getCharacterHp,
  setCharacterHp,
  resolveChar,
  getCharacterWeapons,
  normalizePathwayCustomAttacks,
} = characterState;

const PATHWAY_CHARACTER_ID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

function loadCharacters() {
  return characterState.getAll();
}

async function saveCharacters(data) {
  await characterState.saveAll(data);
}

function parsePastedPathbuilderJSON(rawText) {
  if (!rawText || typeof rawText !== 'string') return { error: 'Paste is empty.' };

  let text = rawText.trim();

  // Strip common code-block wrappers: ```json ... ``` or ``` ... ```
  const codeBlockMatch = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/);
  if (codeBlockMatch) text = codeBlockMatch[1].trim();

  // Strip any line-level // comments. Our /char template uses these for
  // instructions, and users might add their own while editing. We only strip
  // lines that BEGIN with optional whitespace + // (we don't touch // that
  // appears mid-line, which might be legitimate data like a URL).
  text = text.split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n').trim();

  // If the user pasted multiple lines with non-JSON preamble, find the first { and last }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return { error: 'That paste doesn\'t contain valid JSON. Make sure you copied the entire export from Pathbuilder.' };
  }
  text = text.slice(firstBrace, lastBrace + 1);

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    // Truncation/incomplete paste usually surfaces as "Unexpected end" or
    // "Unterminated string" — point the user toward the multi-field fix.
    const isTruncation = /Unexpected end|Unterminated string|Expected/.test(err.message);
    if (isTruncation) {
      return { error: 'Your paste looks cut off. If you\'re using a template, make sure the file wasn\'t truncated. Otherwise check for missing commas or brackets near the end.' };
    }
    return { error: `Couldn't parse that JSON: ${err.message}. Double-check you copied the entire export from Pathbuilder's Menu → Export JSON.` };
  }

  // Unwrap { success, build } if present
  const char = parsed.build ?? parsed;
  if (!char || !char.name) {
    return { error: 'Got valid JSON but no character data. Make sure you exported from Pathbuilder\'s Menu → Export JSON.' };
  }
  return { char };
}

function parsePathbuilderRef(raw) {
  if (!raw || typeof raw !== 'string') return { error: 'Please provide a Pathbuilder ID or export URL.' };
  const trimmed = raw.trim();
  // Pure number
  if (/^\d{4,8}$/.test(trimmed)) return { id: trimmed };
  // URL with id=NNNN query param (handles http/https, with or without www, with any path)
  const urlMatch = trimmed.match(/[?&]id=(\d{4,8})(?:&|$)/);
  if (urlMatch) return { id: urlMatch[1] };
  // Just a number inside some other text (last resort — extract the only digit run if unambiguous)
  const numbers = trimmed.match(/\d{4,8}/g);
  if (numbers && numbers.length === 1) return { id: numbers[0] };
  return {
    error: 'Could not find a Pathbuilder ID in that input. Paste either the 6-digit code (e.g. `122550`) or the full URL from Pathbuilder\'s Export JSON (e.g. `https://pathbuilder2e.com/json.php?id=122550`).',
  };
}

function parseCharacterUpdateRef(raw) {
  if (!raw || typeof raw !== 'string') {
    return { error: 'Please provide a Pathbuilder ID/export URL or Pathway JSON ID.' };
  }
  const trimmed = raw.trim();
  const pathwayMatch = trimmed.match(PATHWAY_CHARACTER_ID_RE);
  if (pathwayMatch) return { type: 'pathway', id: pathwayMatch[0].toLowerCase() };

  const pathbuilderRef = parsePathbuilderRef(trimmed);
  if (pathbuilderRef.error) {
    return {
      error:
        'Could not find a valid character ID in that input. Paste a Pathway JSON ID ' +
        '(e.g. `e33b3c85-03d5-44f0-9cc1-40a139a0a7db`), a Pathbuilder code ' +
        '(e.g. `122550`), or a Pathbuilder Export JSON URL.',
    };
  }
  return { type: 'pathbuilder', id: pathbuilderRef.id };
}

function getBlankCharacterTemplate() {
  const template = {
    name: '',
    class: '',
    dualClass: null,
    level: 1,
    ancestry: '',
    heritage: '',
    background: '',
    deity: '',
    abilities: {
      str: 10,
      dex: 10,
      con: 10,
      int: 10,
      wis: 10,
      cha: 10,
    },
    attributes: {
      ancestryhp: 0,
      classhp: 0,
      bonushp: 0,
      bonushpPerLevel: 0,
      speed: 25,
      perception: 0,
    },
    stats: {
      acTotal: 10,
      classDC: 0,
    },
    proficiencies: {
      classDC: 0,
      perception: 0,
      fortitude: 0,
      reflex: 0,
      will: 0,
      unarmored: 0,
      light: 0,
      medium: 0,
      heavy: 0,
      unarmed: 0,
      simple: 0,
      martial: 0,
      advanced: 0,
      arcana: 0,
      crafting: 0,
      deception: 0,
      diplomacy: 0,
      intimidation: 0,
      medicine: 0,
      nature: 0,
      occultism: 0,
      performance: 0,
      religion: 0,
      society: 0,
      stealth: 0,
      survival: 0,
      thievery: 0,
    },
    lores: [],
    languages: [],
    senses: [],
    weapons: [],
    armor: [],
    feats: [],
    spells: [],
    focus: {
      pool: 0,
      current: 0,
    },
  };

  return [
    '// Pathway blank character template',
    '// Fill in the fields you know, then upload this file with /char add file.',
    '// Proficiency values use PF2e bonuses: 0 untrained, 2 trained, 4 expert, 6 master, 8 legendary.',
    JSON.stringify(template, null, 2),
    '',
  ].join('\n');
}

async function fetchPathbuilderCharacter(id) {
  const url = `https://pathbuilder2e.com/json.php?id=${encodeURIComponent(id)}`;
  let response;
  try {
    response = await fetch(url, {
      headers: {
        'User-Agent': 'Pathway-Bot/1.0 (+https://github.com/vivantur/Pathway; PF2e Discord bot)',
      },
    });
  } catch (err) {
    return { error: `❌ Couldn't reach Pathbuilder: ${err.message}. Try again in a minute.` };
  }
  const rawText = await response.text();
  if (response.status === 403 || /host not in allowlist/i.test(rawText)) {
    return {
      error:
        `âŒ **Pathbuilder blocked the request â€” its allowlist doesn't include this bot's server.**\n\n` +
        `Use \`/char update file:<updated-json>\` instead:\n` +
        `1. In Pathbuilder, open **Menu** â†’ **Export JSON**\n` +
        `2. Save or copy the JSON into a \`.json\` or \`.txt\` file\n` +
        `3. Upload that file with \`/char update\`.`,
    };
  }
  if (!response.ok) {
    return { error: `❌ Pathbuilder responded with HTTP ${response.status}. Try again in a minute.` };
  }
  let payload;
  try {
    payload = JSON.parse(rawText);
  } catch {
    return { error: '❌ Pathbuilder gave back an invalid response. Try re-exporting from the app.' };
  }
  if (!payload.success) {
    return {
      error:
        `❌ Pathbuilder says ID **${id}** isn't valid. IDs expire after about 24 hours.\n` +
        `Get a fresh one:\n1. Open Pathbuilder\n2. Menu → **Export JSON**\n3. Paste the new ID or URL here.`,
    };
  }
  const char = payload.build;
  if (!char || !char.name) {
    return { error: '❌ Got a response, but no character data in it. Try again with a fresh ID.' };
  }
  return { char, id };
}

async function execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'create') {
      const modal = new ModalBuilder()
        .setCustomId('char_create_modal')
        .setTitle('Create Blank Character');

      const mk = (id, label, placeholder, required = false) => new TextInputBuilder()
        .setCustomId(id)
        .setLabel(label)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(placeholder)
        .setRequired(required)
        .setMaxLength(100);

      modal.addComponents(
        new ActionRowBuilder().addComponents(mk('name', 'Character Name', 'Viv', true)),
        new ActionRowBuilder().addComponents(mk('class', 'Class', 'Fighter')),
        new ActionRowBuilder().addComponents(mk('ancestry', 'Ancestry', 'Human')),
        new ActionRowBuilder().addComponents(mk('heritage', 'Heritage', 'Versatile Human')),
        new ActionRowBuilder().addComponents(mk('level', 'Level', '1', true).setMaxLength(2)),
      );
      return interaction.showModal(modal);
    }

    if (sub === 'add') {
      await interaction.deferReply();
      const attachment = interaction.options.getAttachment('file');
      const nameLower = attachment.name.toLowerCase();
      if (!nameLower.endsWith('.json') && !nameLower.endsWith('.txt')) {
        return interaction.editReply('Please attach a `.json` **or** `.txt` file. To make one on mobile:\n1. In Pathbuilder → Menu → **Export JSON** → **Copy JSON**\n2. Paste into Notes app / Google Keep / any text editor\n3. Save/share as a `.txt` file\n4. Attach it here and run `/char add` again.');
      }
      if (attachment.size > 2 * 1024 * 1024) {
        return interaction.editReply('❌ File too large (max 2 MB). Pathbuilder JSON exports are typically under 100 KB.');
      }
      try {
        const response = await fetch(attachment.url);
        const rawText = await response.text();
        // Try JSON parse; fall back with a clean error if the file content
        // isn't actually JSON (user uploaded the wrong file, etc.)
        const parsed = parsePastedPathbuilderJSON(rawText);
        if (parsed.error) return interaction.editReply(`❌ ${parsed.error}`);
        const saved = await saveImportedCharacter(interaction.user.id, parsed.char, { preserveOverlay: false });
        if (saved.error) return interaction.editReply(`❌ ${saved.error}`);
        await interaction.editReply(`✅ **${saved.name}** saved! Use \`/sheet\` to view them.`);
      } catch (err) { console.error(err); await interaction.editReply('Something went wrong reading that file. Try again!'); }
    }

    else if (sub === 'update') {
      await interaction.deferReply();
      const attachment = interaction.options.getAttachment('file');
      const idInput = interaction.options.getString('id');
      if (!attachment && !idInput) {
        return interaction.editReply('Please attach a `.json`/`.txt` file, provide a Pathbuilder JSON ID, or provide a Pathway web JSON ID.');
      }
      if (!attachment) {
        try {
          const parsedRef = parseCharacterUpdateRef(idInput);
          if (parsedRef.error) return interaction.editReply(`âŒ ${parsedRef.error}`);
          const fetched = parsedRef.type === 'pathway'
            ? await fetchPathwayCharacter(parsedRef.id, interaction.user.id)
            : await fetchPathbuilderCharacter(parsedRef.id);
          if (fetched.error) return interaction.editReply(fetched.error);
          const saved = await saveImportedCharacter(interaction.user.id, fetched.char, { preserveOverlay: true, pathwayRow: fetched.row });
          if (saved.error) return interaction.editReply(`âŒ ${saved.error}`);
          if (!saved.replaced) return interaction.editReply(`Couldn't find **${saved.name}**. Use \`/char add\` first.`);
          if (parsedRef.type === 'pathway') {
            return interaction.editReply(`✅ **${saved.name}** updated to level ${saved.level} from Pathway web JSON ID \`${fetched.id}\`! *(hero points, XP, current HP, and bag preserved.)*`);
          }
          return interaction.editReply(`âœ… **${saved.name}** updated to level ${saved.level} from Pathbuilder ID \`${fetched.id}\`! *(hero points, XP, current HP, and bag preserved.)*`);
        } catch (err) { console.error(err); return interaction.editReply('Something went wrong. Try again!'); }
      }
      const nameLower = attachment.name.toLowerCase();
      if (!nameLower.endsWith('.json') && !nameLower.endsWith('.txt')) {
        return interaction.editReply('Please attach a `.json` or `.txt` file exported from Pathbuilder.');
      }
      if (attachment.size > 2 * 1024 * 1024) {
        return interaction.editReply('❌ File too large (max 2 MB). Pathbuilder JSON exports are typically under 100 KB.');
      }
      try {
        const response = await fetch(attachment.url);
        const rawText = await response.text();
        const parsed = parsePastedPathbuilderJSON(rawText);
        if (parsed.error) return interaction.editReply(`❌ ${parsed.error}`);
        const saved = await saveImportedCharacter(interaction.user.id, parsed.char, { preserveOverlay: true });
        if (saved.error) return interaction.editReply(`❌ ${saved.error}`);
        if (!saved.replaced) return interaction.editReply(`Couldn't find **${saved.name}**. Use \`/char add\` first.`);
        await interaction.editReply(`✅ **${saved.name}** updated to level ${saved.level}! *(hero points, XP, current HP, and bag preserved.)*`);
      } catch (err) { console.error(err); await interaction.editReply('Something went wrong. Try again!'); }
    }
    else if (sub === 'edit') {
      try {
        const charNameArg = interaction.options.getString('character');
        const characters = loadCharacters();
        const resolved = resolveChar(interaction.user.id, charNameArg, characters);
        if (resolved.error) return interaction.reply({ content: `❌ ${resolved.error}`, ephemeral: true });
        const { charKey, char: charEntry } = resolved;
        const c = charEntry.data ?? {};
        const edits = charEntry.edits ?? {};

        // Pre-fill values: overlay first, then original data
        const prefillBackground = edits.background ?? c.background ?? '';
        const prefillDeity      = edits.deity ?? c.deity ?? '';
        const prefillLanguages  = (edits.languages && edits.languages.length)
          ? edits.languages.join(', ')
          : (charEntry.languages ?? c.languages ?? []).join(', ');
        const prefillSenses     = (edits.senses && edits.senses.length)
          ? edits.senses.join(', ')
          : (charEntry.senses ?? []).join(', ');

        const modal = new ModalBuilder()
          .setCustomId(`char_edit_modal:${charKey}`)
          .setTitle(`Edit ${c.name ?? charEntry.name ?? 'Character'}`.slice(0, 45));

        // All Discord modal labels must be ≤ 45 chars. These are fine.
        const bgInput = new TextInputBuilder()
          .setCustomId('background')
          .setLabel('Background')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(100)
          .setValue(prefillBackground.slice(0, 100));
        const deityInput = new TextInputBuilder()
          .setCustomId('deity')
          .setLabel('Deity')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(100)
          .setValue(prefillDeity.slice(0, 100));
        const langInput = new TextInputBuilder()
          .setCustomId('languages')
          .setLabel('Languages (comma-separated)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(500)
          .setValue(prefillLanguages.slice(0, 500));
        const sensesInput = new TextInputBuilder()
          .setCustomId('senses')
          .setLabel('Senses (comma-separated)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(500)
          .setValue(prefillSenses.slice(0, 500));

        modal.addComponents(
          new ActionRowBuilder().addComponents(bgInput),
          new ActionRowBuilder().addComponents(deityInput),
          new ActionRowBuilder().addComponents(langInput),
          new ActionRowBuilder().addComponents(sensesInput),
        );
        return await interaction.showModal(modal);
      } catch (err) {
        console.error('/char edit showModal failed:', err);
        return interaction.reply({ content: `❌ Couldn't open the edit popup: ${err.message}`, ephemeral: true });
      }
    }

    // /char skill — set proficiency rank or flat total for a specific skill.
    // Kept separate from /char edit because:
    //   - There are too many skills (16+ in PF2e) to fit in a modal
    //   - Skills need structured input (rank dropdown or integer), not free text
    //   - Autocomplete on skill name makes discovery easy
    // If `rank` is provided, we compute total = ability_mod + (rank + level).
    // If `total` is provided, we store it as a flat override that wins over rank.
    // Use 'untrained' rank to clear an existing override.
    else if (sub === 'skill') {
      const charNameArg = interaction.options.getString('character');
      const action = interaction.options.getString('action') ?? 'set';
      const skillName = interaction.options.getString('name')?.trim();
      const rankStr = interaction.options.getString('rank'); // optional
      const total = interaction.options.getInteger('total'); // optional

      const rankMap = { untrained: 0, trained: 2, expert: 4, master: 6, legendary: 8 };
      {
        const skillLabels = {
          perception: 'Perception',
          acrobatics: 'Acrobatics', arcana: 'Arcana', athletics: 'Athletics', crafting: 'Crafting',
          deception: 'Deception', diplomacy: 'Diplomacy', intimidation: 'Intimidation', medicine: 'Medicine',
          nature: 'Nature', occultism: 'Occultism', performance: 'Performance', religion: 'Religion',
          society: 'Society', stealth: 'Stealth', survival: 'Survival', thievery: 'Thievery',
        };
        const normalizeSkill = (value) => {
          const q = String(value ?? '').toLowerCase().trim();
          const slug = q.replace(/[^a-z0-9]+/g, '');
          return Object.keys(skillLabels).find(key => key === q || key.replace(/[^a-z0-9]+/g, '') === slug)
            ?? Object.keys(skillLabels).find(key => key.startsWith(q) || skillLabels[key].toLowerCase().startsWith(q))
            ?? null;
        };
        const normalizeLoreTopic = (value) => {
          const raw = String(value ?? '').trim();
          const topic = raw
            .replace(/^lore\s*[:\-]?\s*/i, '')
            .replace(/\s+lore$/i, '')
            .trim();
          return topic && topic.toLowerCase() !== raw.toLowerCase() ? topic : null;
        };
        if (!['set', 'list', 'remove'].includes(action)) {
          return interaction.reply({ content: 'Action must be `set`, `list`, or `remove`.', ephemeral: true });
        }
        if (rankStr !== null && !(rankStr.toLowerCase() in rankMap)) {
          return interaction.reply({ content: `Invalid rank "${rankStr}". Use: untrained, trained, expert, master, or legendary.`, ephemeral: true });
        }

        const characters = loadCharacters();
        const resolved = resolveChar(interaction.user.id, charNameArg, characters);
        if (resolved.error) return interaction.reply({ content: resolved.error, ephemeral: true });
        const { char: charEntry } = resolved;
        if (!charEntry.edits) charEntry.edits = {};
        if (!charEntry.edits.skillOverrides) charEntry.edits.skillOverrides = {};

        if (action === 'list') {
          const lines = Object.keys(skillLabels).map(key => {
            const mod = computeCharSkillModifier(charEntry, key);
            const mark = charEntry.edits.skillOverrides[key] ? ' *manual*' : '';
            return `• **${skillLabels[key]}** ${mod.modifier >= 0 ? '+' : ''}${mod.modifier} (${mod.profLabel})${mark}`;
          });
          const hiddenLores = new Set((charEntry.edits?.hiddenLores ?? []).map(s => loreKey(s)));
          const loreMap = new Map();
          for (const lore of (charEntry.data?.lores ?? [])) {
            const name = Array.isArray(lore) ? lore[0] : (lore?.name ?? lore?.skill ?? lore?.topic);
            const profNum = Array.isArray(lore)
              ? (typeof lore[1] === 'number' ? lore[1] : 0)
              : (typeof lore?.rank === 'number' ? lore.rank : typeof lore?.proficiency === 'number' ? lore.proficiency : 0);
            const totalOverride = Array.isArray(lore)
              ? (typeof lore[2] === 'number' ? lore[2] : null)
              : (typeof lore?.total === 'number' ? lore.total : null);
            if (!name || hiddenLores.has(loreKey(name))) continue;
            loreMap.set(loreKey(name), { name: loreTopicLabel(name), rank: profNum, total: totalOverride, source: 'json', manual: false });
          }
          for (const [key, rank] of Object.entries(charEntry.data?.proficiencies ?? {})) {
            if (rank <= 0 || !isLoreProficiencyKey(key) || hiddenLores.has(loreKey(key))) continue;
            loreMap.set(loreKey(key), { name: loreTopicLabel(key), rank, total: null, source: 'proficiency', manual: true });
          }
          for (const lore of (charEntry.edits?.lores ?? [])) {
            if (!lore?.name || hiddenLores.has(loreKey(lore.name))) continue;
            loreMap.set(loreKey(lore.name), {
              name: loreTopicLabel(lore.name),
              rank: lore.rank ?? 0,
              total: (typeof lore.total === 'number') ? lore.total : null,
              source: 'edit',
              manual: true,
            });
          }
          for (const lore of loreMap.values()) {
            const intMod = Math.floor((((charEntry.data?.abilities ?? {}).int ?? 10) - 10) / 2);
            const lvlForLore = charEntry.data?.level ?? 1;
            // Both 'proficiency' (raw c.proficiencies) and JSON lores go through
            // the source-aware helper so Pathbuilder ranks (2/4/6/8) aren't
            // inflated. Only manual 'edit' overrides bypass it.
            const profBonus = lore.source === 'edit'
              ? calcProfNum(lore.rank, lvlForLore)
              : calcCharacterProfNum(charEntry.data, lore.rank, lvlForLore);
            const displayProfValue = lore.source === 'edit'
              ? lore.rank
              : characterProfValue(charEntry.data, lore.rank);
            const computedTotal = intMod + profBonus;
            const totalValue = lore.total !== null ? lore.total : computedTotal;
            const rankLabel = { 0: 'Untrained', 2: 'Trained', 4: 'Expert', 6: 'Master', 8: 'Legendary' }[displayProfValue] ?? 'Untrained';
            lines.push(`• **Lore: ${lore.name}** ${totalValue >= 0 ? '+' : ''}${totalValue} (${rankLabel})${lore.manual ? ' *manual*' : ''}`);
          }
          const embed = new EmbedBuilder()
            .setColor(0x2a8fbd)
            .setTitle(`${charEntry.name}'s Skills`)
            .setDescription(lines.join('\n').slice(0, 4000))
            .setFooter({ text: 'Use /char skill name:<skill> rank:trained to add a trained skill.' });
          return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        if (!skillName) {
          return interaction.reply({ content: 'Please provide a skill name, or use `action:list` to show all skills.', ephemeral: true });
        }

        const skillKeyLower = normalizeSkill(skillName);
        if (!skillKeyLower) {
          const loreTopic = normalizeLoreTopic(skillName);
          if (!loreTopic) {
            return interaction.reply({ content: `Unknown skill "${skillName}". For Lore, type it like \`Lore: Dragons\` or \`Dragons Lore\`.`, ephemeral: true });
          }
          if (!charEntry.edits.lores) charEntry.edits.lores = [];
          const topicLower = loreTopic.toLowerCase();
          const existingIdx = charEntry.edits.lores.findIndex(l => String(l.name ?? '').toLowerCase() === topicLower);
          const inJson = (charEntry.data?.lores ?? []).some(([name]) => String(name ?? '').toLowerCase() === topicLower);

          if (action === 'remove') {
            const wasInEdits = existingIdx !== -1;
            if (!wasInEdits && !inJson) {
              return interaction.reply({ content: `No **Lore: ${loreTopic}** found on **${charEntry.name}**.`, ephemeral: true });
            }
            if (wasInEdits) charEntry.edits.lores.splice(existingIdx, 1);
            if (inJson) {
              if (!charEntry.edits.hiddenLores) charEntry.edits.hiddenLores = [];
              if (!charEntry.edits.hiddenLores.some(h => String(h).toLowerCase() === topicLower)) charEntry.edits.hiddenLores.push(loreTopic);
            }
            await saveCharacters(characters);
            return interaction.reply({ content: `Removed **Lore: ${loreTopic}** from **${charEntry.name}**.`, ephemeral: true });
          }

          if (charEntry.edits.hiddenLores) {
            charEntry.edits.hiddenLores = charEntry.edits.hiddenLores.filter(h => String(h).toLowerCase() !== topicLower);
          }
          const loreEntry = { name: loreTopic };
          if (rankStr !== null) loreEntry.rank = rankMap[rankStr.toLowerCase()];
          else if (total === null) loreEntry.rank = 2;
          if (total !== null) loreEntry.total = total;
          if (existingIdx >= 0) {
            charEntry.edits.lores[existingIdx] = {
              ...charEntry.edits.lores[existingIdx],
              ...loreEntry,
              name: loreTopic,
            };
          } else {
            charEntry.edits.lores.push(loreEntry);
          }
          await saveCharacters(characters);
          const rankText = rankStr !== null ? rankStr.toLowerCase() : (total === null ? 'trained' : null);
          const detail = [rankText ? `rank **${rankText}**` : null, total !== null ? `flat total **${total >= 0 ? '+' : ''}${total}**` : null].filter(Boolean).join(' and ');
          return interaction.reply({ content: `Set **Lore: ${loreTopic}** on **${charEntry.name}** to ${detail}. Use \`/sheet\` to see it.`, ephemeral: true });
        }

        if (action === 'remove') {
          const hadOverride = Object.prototype.hasOwnProperty.call(charEntry.edits.skillOverrides, skillKeyLower);
          if (!hadOverride) {
            return interaction.reply({ content: `**${skillLabels[skillKeyLower]}** does not have a manual override on **${charEntry.name}**.`, ephemeral: true });
          }
          delete charEntry.edits.skillOverrides[skillKeyLower];
          await saveCharacters(characters);
          return interaction.reply({ content: `Removed manual override for **${skillLabels[skillKeyLower]}** on **${charEntry.name}**.`, ephemeral: true });
        }

        const override = {};
        if (rankStr !== null) override.rank = rankMap[rankStr.toLowerCase()];
        else if (total === null) override.rank = 2;
        if (total !== null) override.total = total;

        if (rankStr?.toLowerCase() === 'untrained' && total === null) {
          delete charEntry.edits.skillOverrides[skillKeyLower];
        } else {
          if (skillKeyLower === 'perception' && charEntry.edits.stats) {
            delete charEntry.edits.stats.perception;
          }
          charEntry.edits.skillOverrides[skillKeyLower] = override;
        }
        await saveCharacters(characters);

        const parts = [];
        if (rankStr !== null) parts.push(`rank **${rankStr.toLowerCase()}**`);
        else if (total === null) parts.push('rank **trained**');
        if (total !== null) parts.push(`flat total **${total >= 0 ? '+' : ''}${total}**`);
        const msg = (rankStr?.toLowerCase() === 'untrained' && total === null)
          ? `Cleared override for **${skillLabels[skillKeyLower]}** on **${charEntry.name}**.`
          : `Set **${skillLabels[skillKeyLower]}** on **${charEntry.name}** to ${parts.join(' and ')}. Use \`/sheet\` to see it.`;
        return interaction.reply({ content: msg, ephemeral: true });
      }
      const skillKeyLower = skillName.toLowerCase();
      const validSkills = new Set([
        'perception',
        'acrobatics','arcana','athletics','crafting','deception','diplomacy',
        'intimidation','medicine','nature','occultism','performance','religion',
        'society','stealth','survival','thievery',
      ]);
      if (!validSkills.has(skillKeyLower)) {
        return interaction.reply({ content: `❌ Unknown skill "${skillName}". Valid: ${[...validSkills].join(', ')}.`, ephemeral: true });
      }
      if (rankStr === null && total === null) {
        return interaction.reply({ content: '❌ Provide either `rank` (trained/expert/master/legendary/untrained) or `total` (flat bonus), or both. If both, total wins.', ephemeral: true });
      }
      if (rankStr !== null && !(rankStr.toLowerCase() in rankMap)) {
        return interaction.reply({ content: `❌ Invalid rank "${rankStr}". Use: untrained, trained, expert, master, or legendary.`, ephemeral: true });
      }

      const characters = loadCharacters();
      const resolved = resolveChar(interaction.user.id, charNameArg, characters);
      if (resolved.error) return interaction.reply({ content: `❌ ${resolved.error}`, ephemeral: true });
      const { charKey, char: charEntry } = resolved;

      if (!charEntry.edits) charEntry.edits = {};
      if (!charEntry.edits.skillOverrides) charEntry.edits.skillOverrides = {};

      const override = {};
      if (rankStr !== null) override.rank = rankMap[rankStr.toLowerCase()];
      if (total !== null)   override.total = total;

      // If user sets untrained AND no total, they probably want to clear the override
      if (rankStr?.toLowerCase() === 'untrained' && total === null) {
        delete charEntry.edits.skillOverrides[skillKeyLower];
      } else {
        if (skillKeyLower === 'perception' && charEntry.edits.stats) {
          delete charEntry.edits.stats.perception;
        }
        charEntry.edits.skillOverrides[skillKeyLower] = override;
      }

      await saveCharacters(characters);

      // Build confirmation message
      const parts = [];
      if (rankStr !== null) parts.push(`rank **${rankStr.toLowerCase()}**`);
      if (total !== null)   parts.push(`flat total **${total >= 0 ? '+' : ''}${total}**`);
      const msg = (rankStr?.toLowerCase() === 'untrained' && total === null)
        ? `✅ Cleared override for **${skillName}** on **${charEntry.name}**.`
        : `✅ Set **${skillName}** on **${charEntry.name}** to ${parts.join(' and ')}. Use \`/sheet\` to see it.`;
      return interaction.reply({ content: msg, ephemeral: true });
    }

    // /char lore — add, edit, or remove a Lore skill (e.g. Lore: Farming, Lore: Dragons).
    // Unlike /char skill, lore topics are arbitrary strings — no autocomplete, no
    // fixed list. Stored in charEntry.edits.lores so they're preserved across JSON
    // re-imports. To remove one: pass `remove:True`.
    else if (sub === 'lore') {
      const charNameArg = interaction.options.getString('character');
      const topic = interaction.options.getString('topic').trim();
      const rankStr = interaction.options.getString('rank'); // optional
      const total = interaction.options.getInteger('total'); // optional
      const shouldRemove = interaction.options.getBoolean('remove') ?? false;

      if (!topic) {
        return interaction.reply({ content: '❌ Please provide a lore topic (e.g. "Dragon", "Farming", "Absalom").', ephemeral: true });
      }

      const rankMap = { untrained: 0, trained: 2, expert: 4, master: 6, legendary: 8 };
      if (!shouldRemove && rankStr === null && total === null) {
        return interaction.reply({ content: '❌ When adding/editing, provide `rank` (trained/expert/master/legendary) or `total`, or both. To delete an existing lore, pass `remove:True`.', ephemeral: true });
      }
      if (rankStr !== null && !(rankStr.toLowerCase() in rankMap)) {
        return interaction.reply({ content: `❌ Invalid rank "${rankStr}". Use: untrained, trained, expert, master, or legendary.`, ephemeral: true });
      }

      const characters = loadCharacters();
      const resolved = resolveChar(interaction.user.id, charNameArg, characters);
      if (resolved.error) return interaction.reply({ content: `❌ ${resolved.error}`, ephemeral: true });
      const { char: charEntry } = resolved;

      if (!charEntry.edits) charEntry.edits = {};
      if (!charEntry.edits.lores) charEntry.edits.lores = [];

      const topicLower = topic.toLowerCase();
      const existingIdx = charEntry.edits.lores.findIndex(l => l.name.toLowerCase() === topicLower);

      if (shouldRemove) {
        // Three cases:
        //   (a) Lore exists only in edits.lores → splice it out
        //   (b) Lore exists only in c.lores (JSON/PDF-sourced) → add to hiddenLores
        //   (c) Both → remove from edits AND hide the JSON one
        const c = charEntry.data ?? {};
        const inJson = (c.lores ?? []).some(([n]) => n.toLowerCase() === topicLower);
        const wasInEdits = existingIdx !== -1;
        if (!inJson && !wasInEdits) {
          return interaction.reply({ content: `❌ No lore "${topic}" to remove on **${charEntry.name}**. Use \`/sheet\` to see their current lores.`, ephemeral: true });
        }
        if (wasInEdits) {
          charEntry.edits.lores.splice(existingIdx, 1);
        }
        if (inJson) {
          if (!charEntry.edits.hiddenLores) charEntry.edits.hiddenLores = [];
          // Keep the hidden list case-insensitive-unique
          const alreadyHidden = charEntry.edits.hiddenLores.some(h => h.toLowerCase() === topicLower);
          if (!alreadyHidden) charEntry.edits.hiddenLores.push(topic);
        }
        await saveCharacters(characters);
        return interaction.reply({ content: `✅ Removed **Lore: ${topic}** from **${charEntry.name}**.`, ephemeral: true });
      }

      // If the user is editing a lore that was previously hidden, un-hide it
      if (charEntry.edits.hiddenLores) {
        charEntry.edits.hiddenLores = charEntry.edits.hiddenLores.filter(h => h.toLowerCase() !== topicLower);
      }

      // Build the lore entry
      const loreEntry = { name: topic };
      if (rankStr !== null) loreEntry.rank = rankMap[rankStr.toLowerCase()];
      if (total !== null)   loreEntry.total = total;

      if (existingIdx >= 0) {
        // Merge with existing — keep fields that aren't being overwritten
        const existing = charEntry.edits.lores[existingIdx];
        charEntry.edits.lores[existingIdx] = {
          name: topic, // use new casing if user retyped
          rank: (rankStr !== null) ? loreEntry.rank : existing.rank,
          total: (total !== null) ? loreEntry.total : existing.total,
        };
      } else {
        charEntry.edits.lores.push(loreEntry);
      }
      await saveCharacters(characters);

      const parts = [];
      if (rankStr !== null) parts.push(`rank **${rankStr.toLowerCase()}**`);
      if (total !== null)   parts.push(`flat total **${total >= 0 ? '+' : ''}${total}**`);
      const verb = existingIdx >= 0 ? 'Updated' : 'Added';
      return interaction.reply({ content: `✅ ${verb} **Lore: ${topic}** on **${charEntry.name}** (${parts.join(' and ')}). Use \`/sheet\` to see it.`, ephemeral: true });
    }

    // /char template — send the user a blank fill-in-the-blanks character
    // template as a .txt attachment. They edit it in any text editor and
    // re-upload via /char add.
    // /char stat — set or clear a combat stat override (AC, HP max, Fort/Ref/Will,
    // Perception, Speed). These are stored in edits.stats and shown on /sheet with
    // a warning that the JSON value is being ignored.
    else if (sub === 'stat') {
      const charNameArg = interaction.options.getString('character');
      const field = interaction.options.getString('field');
      const action = interaction.options.getString('action') ?? 'set';
      const value = interaction.options.getInteger('value');

      const validFields = ['ac', 'hpMax', 'fortitude', 'reflex', 'will', 'perception', 'speed'];
      if (!validFields.includes(field)) {
        return interaction.reply({ content: `❌ Invalid field "${field}". Valid: ${validFields.join(', ')}.`, ephemeral: true });
      }
      if (action === 'set' && value === null) {
        return interaction.reply({ content: `❌ Provide a \`value\` when setting a stat (or use \`action:clear\` to revert).`, ephemeral: true });
      }

      const characters = loadCharacters();
      const resolved = resolveChar(interaction.user.id, charNameArg, characters);
      if (resolved.error) return interaction.reply({ content: `❌ ${resolved.error}`, ephemeral: true });
      const { char: charEntry } = resolved;

      if (!charEntry.edits) charEntry.edits = {};
      if (!charEntry.edits.stats) charEntry.edits.stats = {};

      if (action === 'clear') {
        delete charEntry.edits.stats[field];
        await saveCharacters(characters);
        const fieldLabel = { ac: 'AC', hpMax: 'HP max', fortitude: 'Fort save', reflex: 'Reflex save', will: 'Will save', perception: 'Perception', speed: 'Speed' }[field];
        return interaction.reply({ content: `✅ Cleared **${fieldLabel}** override on **${charEntry.name}**. JSON value will show on \`/sheet\`.`, ephemeral: true });
      }

      charEntry.edits.stats[field] = value;
      await saveCharacters(characters);
      const fieldLabel = { ac: 'AC', hpMax: 'HP max', fortitude: 'Fort save', reflex: 'Reflex save', will: 'Will save', perception: 'Perception', speed: 'Speed' }[field];
      return interaction.reply({ content: `✅ Set **${fieldLabel}** to **${value}** on **${charEntry.name}**. Use \`/sheet\` to see it.`, ephemeral: true });
    }

    // /char weapon and /char attack — add, edit, list, or remove weapons/attacks.
    // Follows the same
    // layered pattern as /char lore: edits.weapons for user-added, edits.hiddenWeapons
    // for JSON-sourced ones to hide.
    else if (sub === 'weapon' || sub === 'attack') {
      const charNameArg = interaction.options.getString('character');
      const action = interaction.options.getString('action');
      const name = interaction.options.getString('name')?.trim();

      if (!['add', 'remove', 'edit', 'list'].includes(action)) {
        return interaction.reply({ content: '❌ action must be `add`, `edit`, `list`, or `remove`.', ephemeral: true });
      }
      if (action !== 'list' && !name) {
        return interaction.reply({ content: '❌ Please provide a weapon name.', ephemeral: true });
      }

      const characters = loadCharacters();
      const resolved = resolveChar(interaction.user.id, charNameArg, characters);
      if (resolved.error) return interaction.reply({ content: `❌ ${resolved.error}`, ephemeral: true });
      const { char: charEntry } = resolved;
      const c = charEntry.data ?? {};

      if (!charEntry.edits) charEntry.edits = {};
      if (!charEntry.edits.weapons) charEntry.edits.weapons = [];

      if (action === 'list') {
        const weapons = getCharacterWeapons(charEntry);
        const lines = weapons.map(w => {
          const attackBonus = w.attack ?? 0;
          const damageBonus = w.damageBonus ? (w.damageBonus > 0 ? `+${w.damageBonus}` : `${w.damageBonus}`) : '';
          const damageType = w.damageType === 'P' ? 'piercing'
            : w.damageType === 'S' ? 'slashing'
            : w.damageType === 'B' ? 'bludgeoning'
            : (w.damageType ?? '').toLowerCase();
          const traits = (w.traits ?? []).length ? ` (${w.traits.join(', ')})` : '';
          return `• **${w.display ?? w.name}** ${attackBonus >= 0 ? '+' : ''}${attackBonus} to hit · ${w.die ?? '1d4'}${damageBonus} ${damageType}${traits}`;
        });
        const embed = new EmbedBuilder()
          .setColor(0x9B59B6)
          .setTitle(`${charEntry.name}'s Attacks`)
          .setDescription(lines.length ? lines.join('\n').slice(0, 4000) : '*No attacks are recorded on this character yet.*')
          .setFooter({ text: 'Use /char attack action:add to add a new attack.' });
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      const nameLower = name.toLowerCase();
      const existingIdx = charEntry.edits.weapons.findIndex(w =>
        ((w.display ?? w.name) || '').toLowerCase() === nameLower
      );
      const inJson = (c.weapons ?? []).some(w =>
        ((w.display ?? w.name) || '').toLowerCase() === nameLower
      ) || normalizePathwayCustomAttacks(c.custom_attacks).some(w =>
        ((w.display ?? w.name) || '').toLowerCase() === nameLower
      );

      if (action === 'remove') {
        // Same three-case logic as /char lore remove
        if (!inJson && existingIdx === -1) {
          return interaction.reply({ content: `❌ No weapon "${name}" to remove on **${charEntry.name}**. Use \`/sheet\` to see current weapons.`, ephemeral: true });
        }
        if (existingIdx !== -1) {
          charEntry.edits.weapons.splice(existingIdx, 1);
        }
        if (inJson) {
          if (!charEntry.edits.hiddenWeapons) charEntry.edits.hiddenWeapons = [];
          if (!charEntry.edits.hiddenWeapons.some(h => h.toLowerCase() === nameLower)) {
            charEntry.edits.hiddenWeapons.push(name);
          }
        }
        await saveCharacters(characters);
        return interaction.reply({ content: `✅ Removed **${name}** from **${charEntry.name}**.`, ephemeral: true });
      }

      // add/edit: collect the weapon fields
      let attack = null;
      try { attack = interaction.options.getInteger('attack'); } catch {}
      if (attack === null) {
        try { attack = interaction.options.getInteger('bonus'); } catch {}
      }
      const damage = interaction.options.getString('damage');
      const damageType = interaction.options.getString('type'); // B/P/S or word
      const traitsRaw = interaction.options.getString('traits');

      if (action === 'add' && (attack === null || !damage || !damageType)) {
        return interaction.reply({ content: '❌ When adding a weapon, `attack`, `damage`, and `type` are all required.', ephemeral: true });
      }

      // If the user is un-hiding a weapon by re-adding it, remove from hiddenWeapons
      if (charEntry.edits.hiddenWeapons) {
        charEntry.edits.hiddenWeapons = charEntry.edits.hiddenWeapons.filter(h => h.toLowerCase() !== nameLower);
      }

      const newWeapon = existingIdx !== -1
        ? { ...charEntry.edits.weapons[existingIdx] }
        : { name, display: name, attack: 0, damageBonus: 0, die: '1d4', damageType: 'B', traits: [], strikingRune: '', potencyRune: 0, runes: [] };

      newWeapon.name = name;
      newWeapon.display = name;
      if (attack !== null) newWeapon.attack = attack;
      if (damage) newWeapon.die = damage;
      if (damageType) newWeapon.damageType = damageType;
      if (traitsRaw !== null) newWeapon.traits = traitsRaw.split(',').map(t => t.trim()).filter(Boolean);

      if (existingIdx !== -1) {
        charEntry.edits.weapons[existingIdx] = newWeapon;
      } else {
        charEntry.edits.weapons.push(newWeapon);
      }
      await saveCharacters(characters);

      const verb = action === 'add' ? (existingIdx !== -1 ? 'Updated' : 'Added') : 'Updated';
      return interaction.reply({ content: `✅ ${verb} **${name}** on **${charEntry.name}** (${newWeapon.attack >= 0 ? '+' : ''}${newWeapon.attack} to hit, ${newWeapon.die} ${newWeapon.damageType}). Use \`/sheet\` to see it.`, ephemeral: true });
    }

    // /char identity — modal for class/subclass/level/ancestry/heritage
    // All 5 slots used. Pre-fills with current values (merged from overrides).
    else if (sub === 'identity') {
      try {
        const charNameArg = interaction.options.getString('character');
        const characters = loadCharacters();
        const resolved = resolveChar(interaction.user.id, charNameArg, characters);
        if (resolved.error) return interaction.reply({ content: `❌ ${resolved.error}`, ephemeral: true });
        const { charKey, char: charEntry } = resolved;
        const c = charEntry.data ?? {};
        const identity = charEntry.edits?.identity ?? {};

        const modal = new ModalBuilder()
          .setCustomId(`char_identity_modal:${charKey}`)
          .setTitle(`Identity: ${c.name ?? charEntry.name ?? 'Character'}`.slice(0, 45));
        const mk = (id, label, defaultValue, maxLen = 100) => new TextInputBuilder()
          .setCustomId(id).setLabel(label.slice(0, 45))
          .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(maxLen)
          .setValue(String(defaultValue ?? '').slice(0, maxLen));
        modal.addComponents(
          new ActionRowBuilder().addComponents(mk('class', 'Class', identity.class ?? c.class)),
          new ActionRowBuilder().addComponents(mk('subclass', 'Subclass / Archetype', identity.subclass ?? c.subclass)),
          new ActionRowBuilder().addComponents(mk('level', 'Level (number)', identity.level ?? c.level, 3)),
          new ActionRowBuilder().addComponents(mk('ancestry', 'Ancestry (e.g. Human, Elf)', identity.ancestry ?? c.ancestry)),
          new ActionRowBuilder().addComponents(mk('heritage', 'Heritage (e.g. Versatile Human)', identity.heritage ?? c.heritage)),
        );
        return await interaction.showModal(modal);
      } catch (err) {
        console.error('/char identity showModal failed:', err);
        return interaction.reply({ content: `❌ Couldn\'t open the popup: ${err.message}`, ephemeral: true });
      }
    }

    // /char misc — modal for gender/age/size/alignment/keyability
    else if (sub === 'misc') {
      try {
        const charNameArg = interaction.options.getString('character');
        const characters = loadCharacters();
        const resolved = resolveChar(interaction.user.id, charNameArg, characters);
        if (resolved.error) return interaction.reply({ content: `❌ ${resolved.error}`, ephemeral: true });
        const { charKey, char: charEntry } = resolved;
        const c = charEntry.data ?? {};
        const misc = charEntry.edits?.misc ?? {};

        const modal = new ModalBuilder()
          .setCustomId(`char_misc_modal:${charKey}`)
          .setTitle(`Misc: ${c.name ?? charEntry.name ?? 'Character'}`.slice(0, 45));
        const mk = (id, label, defaultValue, maxLen = 60, placeholder) => {
          const b = new TextInputBuilder()
            .setCustomId(id).setLabel(label.slice(0, 45))
            .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(maxLen)
            .setValue(String(defaultValue ?? '').slice(0, maxLen));
          if (placeholder) b.setPlaceholder(placeholder);
          return b;
        };
        modal.addComponents(
          new ActionRowBuilder().addComponents(mk('gender', 'Gender / Pronouns', misc.gender ?? c.gender)),
          new ActionRowBuilder().addComponents(mk('age', 'Age', misc.age ?? c.age, 20)),
          new ActionRowBuilder().addComponents(mk('size', 'Size (number or name)', (misc.size !== undefined ? misc.size : c.size), 20, '0=Medium, -1=Small, 1=Large, etc.')),
          new ActionRowBuilder().addComponents(mk('alignment', 'Alignment (e.g. LG, N, CE)', misc.alignment ?? c.alignment, 10)),
          new ActionRowBuilder().addComponents(mk('keyability', 'Key ability (str/dex/int/etc.)', misc.keyability ?? c.keyability, 10)),
        );
        return await interaction.showModal(modal);
      } catch (err) {
        console.error('/char misc showModal failed:', err);
        return interaction.reply({ content: `❌ Couldn\'t open the popup: ${err.message}`, ephemeral: true });
      }
    }

    // /char ability — set one ability score. Stored as SCORE (not mod).
    // Quick conversion: mod = (score - 10) / 2, so +4 mod = 18 score.
    else if (sub === 'ability') {
      const charNameArg = interaction.options.getString('character');
      const field = interaction.options.getString('field');
      const action = interaction.options.getString('action') ?? 'set';
      const value = interaction.options.getInteger('value');

      const validFields = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
      if (!validFields.includes(field)) {
        return interaction.reply({ content: `❌ Invalid ability "${field}". Valid: ${validFields.join(', ')}.`, ephemeral: true });
      }
      if (action === 'set' && value === null) {
        return interaction.reply({ content: `❌ Provide a \`value\` when setting (or use \`action:clear\` to revert). Ability scores are typically 8-20 (a +4 modifier is a score of 18).`, ephemeral: true });
      }

      const characters = loadCharacters();
      const resolved = resolveChar(interaction.user.id, charNameArg, characters);
      if (resolved.error) return interaction.reply({ content: `❌ ${resolved.error}`, ephemeral: true });
      const { char: charEntry } = resolved;
      if (!charEntry.edits) charEntry.edits = {};
      if (!charEntry.edits.abilities) charEntry.edits.abilities = {};

      if (action === 'clear') {
        delete charEntry.edits.abilities[field];
        await saveCharacters(characters);
        return interaction.reply({ content: `✅ Cleared **${field.toUpperCase()}** override on **${charEntry.name}**. JSON value will show on \`/sheet\`.`, ephemeral: true });
      }

      charEntry.edits.abilities[field] = value;
      await saveCharacters(characters);
      const mod = Math.floor((value - 10) / 2);
      const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
      return interaction.reply({ content: `✅ Set **${field.toUpperCase()}** to **${value}** (${modStr} mod) on **${charEntry.name}**.`, ephemeral: true });
    }
    else if (sub === 'item') {
      const charNameArg = interaction.options.getString('character');
      const action = interaction.options.getString('action');
      const name = interaction.options.getString('name')?.trim();
      const quantity = interaction.options.getInteger('quantity') ?? 1;

      if (!['add', 'remove', 'edit'].includes(action)) {
        return interaction.reply({ content: '❌ action must be `add`, `remove`, or `edit`.', ephemeral: true });
      }
      if (!name) {
        return interaction.reply({ content: '❌ Please provide an item name.', ephemeral: true });
      }

      const characters = loadCharacters();
      const resolved = resolveChar(interaction.user.id, charNameArg, characters);
      if (resolved.error) return interaction.reply({ content: `❌ ${resolved.error}`, ephemeral: true });
      const { char: charEntry } = resolved;
      const c = charEntry.data ?? {};
      if (!charEntry.edits) charEntry.edits = {};
      if (!charEntry.edits.items) charEntry.edits.items = [];

      const nameLower = name.toLowerCase();
      // c.equipment is [name, quantity] tuples in Pathbuilder JSON
      const jsonItems = c.equipment ?? [];
      const existingJsonIdx = jsonItems.findIndex(([n]) => (n || '').toLowerCase() === nameLower);
      const existingEditIdx = charEntry.edits.items.findIndex(([n]) => (n || '').toLowerCase() === nameLower);

      if (action === 'remove') {
        if (existingJsonIdx === -1 && existingEditIdx === -1) {
          return interaction.reply({ content: `❌ No item "${name}" on **${charEntry.name}**.`, ephemeral: true });
        }
        if (existingEditIdx !== -1) charEntry.edits.items.splice(existingEditIdx, 1);
        if (existingJsonIdx !== -1) {
          if (!charEntry.edits.hiddenItems) charEntry.edits.hiddenItems = [];
          if (!charEntry.edits.hiddenItems.some(h => h.toLowerCase() === nameLower)) {
            charEntry.edits.hiddenItems.push(name);
          }
        }
        await saveCharacters(characters);
        return interaction.reply({ content: `✅ Removed **${name}** from **${charEntry.name}**.`, ephemeral: true });
      }

      // add/edit: un-hide if previously hidden, then set quantity
      if (charEntry.edits.hiddenItems) {
        charEntry.edits.hiddenItems = charEntry.edits.hiddenItems.filter(h => h.toLowerCase() !== nameLower);
      }
      if (existingEditIdx !== -1) {
        charEntry.edits.items[existingEditIdx] = [name, quantity];
      } else {
        charEntry.edits.items.push([name, quantity]);
      }
      await saveCharacters(characters);
      const verb = (existingEditIdx !== -1 || existingJsonIdx !== -1) ? 'Updated' : 'Added';
      return interaction.reply({ content: `✅ ${verb} **${name}** (x${quantity}) on **${charEntry.name}**.`, ephemeral: true });
    }

    // /char spellcasting — set DC, attack, tradition, key ability on the character's
    // primary spellcaster (c.spellCasters[0]). Stored in edits.spellcasting, merged
    // at display/cast time.
    else if (sub === 'spellcasting') {
      const charNameArg = interaction.options.getString('character');
      const field = interaction.options.getString('field');
      const action = interaction.options.getString('action') ?? 'set';
      const valueInt = interaction.options.getInteger('value');
      const valueStr = interaction.options.getString('text_value');

      const numericFields = ['dc', 'attack'];
      const textFields = ['tradition', 'keyAbility'];
      const valid = [...numericFields, ...textFields];
      if (!valid.includes(field)) {
        return interaction.reply({ content: `❌ Invalid field "${field}". Valid: ${valid.join(', ')}.`, ephemeral: true });
      }

      const characters = loadCharacters();
      const resolved = resolveChar(interaction.user.id, charNameArg, characters);
      if (resolved.error) return interaction.reply({ content: `❌ ${resolved.error}`, ephemeral: true });
      const { char: charEntry } = resolved;
      if (!charEntry.edits) charEntry.edits = {};
      if (!charEntry.edits.spellcasting) charEntry.edits.spellcasting = {};

      if (action === 'clear') {
        delete charEntry.edits.spellcasting[field];
        await saveCharacters(characters);
        return interaction.reply({ content: `✅ Cleared spellcasting **${field}** override on **${charEntry.name}**.`, ephemeral: true });
      }

      if (numericFields.includes(field)) {
        if (valueInt === null) return interaction.reply({ content: `❌ Provide a \`value\` (integer) when setting ${field}.`, ephemeral: true });
        charEntry.edits.spellcasting[field] = valueInt;
      } else {
        if (!valueStr) return interaction.reply({ content: `❌ Provide a \`text_value\` (e.g. "arcane", "int") when setting ${field}.`, ephemeral: true });
        charEntry.edits.spellcasting[field] = valueStr.toLowerCase();
      }
      await saveCharacters(characters);
      const val = numericFields.includes(field) ? valueInt : valueStr.toLowerCase();
      return interaction.reply({ content: `✅ Set spellcasting **${field}** to **${val}** on **${charEntry.name}**.`, ephemeral: true });
    }

    else if (sub === 'template') {
      try {
        const content = getBlankCharacterTemplate();
        const buffer = Buffer.from(content, 'utf8');
        const attachment = new AttachmentBuilder(buffer, { name: 'pathway_character_template.txt' });
        await interaction.reply({
          content: '📝 **Blank character template attached.**\n\n' +
            '**How to use:**\n' +
            '1. Download the file\n' +
            '2. Open it in any text editor (Notepad, TextEdit, phone notes app, etc.)\n' +
            '3. Fill in your character\'s details — the `//` comments explain each field\n' +
            '4. Save (keep the `.txt` extension)\n' +
            '5. Run `/char add file:<the-edited-file>` to import them\n\n' +
            '*You can keep the `// comments` or delete them — the bot ignores them either way.*\n' +
            '*For small changes to an existing character, `/char edit`, `/char skill`, and `/char lore` are faster.*',
          files: [attachment],
          ephemeral: true,
        });
      } catch (err) {
        console.error('/char template error:', err);
        await interaction.reply({ content: `❌ Couldn\'t generate the template: ${err.message}`, ephemeral: true });
      }
    }

    // /char dump — export the user's current character as a template-formatted
    // .txt file. For heavy modifications: dump → edit locally → re-import.
    else if (sub === 'dump') {
      try {
        const charNameArg = interaction.options.getString('character');
        const characters = loadCharacters();
        const resolved = resolveChar(interaction.user.id, charNameArg, characters);
        if (resolved.error) return interaction.reply({ content: `❌ ${resolved.error}`, ephemeral: true });
        const { char: charEntry } = resolved;
        const c = charEntry.data ?? {};

        // Serialize with the same pretty format as the template. Strip
        // _comment_* fields only when dumping (they're useful in the template
        // but the user's real character shouldn't carry them).
        const cleaned = {};
        for (const [k, v] of Object.entries(c)) {
          if (k.startsWith('_comment')) continue;
          cleaned[k] = v;
        }

        const header = `// Pathway Character Export — ${charEntry.name}\n` +
          `// =====================================================================\n` +
          `// Exported: ${new Date().toISOString().split('T')[0]}\n` +
          `// To re-import after editing: /char update file:<this-edited-file>\n` +
          `// (Or /char add to import as a new character with a different name.)\n` +
          `// =====================================================================\n\n`;
        const body = JSON.stringify(cleaned, null, 2);
        const buffer = Buffer.from(header + body, 'utf8');
        const safeName = (charEntry.name || 'character').toLowerCase().replace(/[^a-z0-9]+/g, '_');
        const attachment = new AttachmentBuilder(buffer, { name: `${safeName}.txt` });
        await interaction.reply({
          content: `📤 **${charEntry.name}** exported. Edit and re-import with \`/char update file:<the-edited-file>\` to apply changes.`,
          files: [attachment],
          ephemeral: true,
        });
      } catch (err) {
        console.error('/char dump error:', err);
        await interaction.reply({ content: `❌ Couldn\'t export that character: ${err.message}`, ephemeral: true });
      }
    }
    // ─── /char hp ─────────────────────────────────────────────────────
    // Override or reset a character's max HP, and/or set their current HP.
    // Useful when an import miscalculates HP (e.g. PDF imports missing
    // toughness/diehard/etc., or when a campaign uses house rules).
    //
    // Usage:
    //   /char hp max:42                  → sets max HP override to 42
    //   /char hp max:reset               → clears override, returns to computed
    //   /char hp current:30              → sets current HP to 30 (clamped to max)
    //   /char hp max:42 current:30       → both at once
    else if (sub === 'hp') {
      const userId = interaction.user.id;
      const characters = loadCharacters();
      const nameArg = interaction.options.getString('character');
      const { error, charKey, char: charEntry } = resolveChar(userId, nameArg, characters);
      if (error) return interaction.reply({ content: error, ephemeral: true });

      const maxArg = interaction.options.getString('max');
      const currentArg = interaction.options.getInteger('current');

      if (!maxArg && currentArg == null) {
        // No args — just show current state
        const computed = (() => {
          const c = charEntry.data;
          const lvl = c.level ?? 1;
          const conMod = Math.floor(((c.abilities?.con ?? 10) - 10) / 2);
          return (c.attributes?.ancestryhp ?? 0) + (c.attributes?.bonushp ?? 0) + (((c.attributes?.classhp ?? 0) + (c.attributes?.bonushpPerLevel ?? 0) + conMod) * lvl);
        })();
        const effective = computeCharMaxHp(charEntry);
        const current = getCharacterHp(charEntry);
        const overrideText = (typeof charEntry._hpMaxOverride === 'number' && charEntry._hpMaxOverride > 0)
          ? `\n*Override is active.* Computed value would be **${computed}**.`
          : '';
        return interaction.reply({
          content: `**${charEntry.data.name}**: ${current} / ${effective} HP${overrideText}\n\nUse \`/char hp max:<n>\` to override max, \`/char hp current:<n>\` to set current, or \`/char hp max:reset\` to clear an override.`,
          ephemeral: true,
        });
      }

      const changes = [];

      // Handle max: parameter
      if (maxArg) {
        if (maxArg.toLowerCase() === 'reset' || maxArg.toLowerCase() === 'clear' || maxArg.toLowerCase() === 'auto') {
          if (typeof charEntry._hpMaxOverride === 'number') {
            delete charEntry._hpMaxOverride;
            changes.push(`max HP override cleared (now computed)`);
          } else {
            changes.push(`max HP wasn't overridden — no change`);
          }
        } else {
          const n = parseInt(maxArg, 10);
          if (Number.isNaN(n) || n <= 0 || n > 9999) {
            return interaction.reply({ content: `❌ \`max\` must be a positive number (or \`reset\`). Got: \`${maxArg}\``, ephemeral: true });
          }
          charEntry._hpMaxOverride = n;
          changes.push(`max HP set to **${n}**`);
        }
      }

      // Handle current: parameter — apply AFTER max change so clamp uses new max
      if (currentArg != null) {
        const newMax = computeCharMaxHp(charEntry);
        if (currentArg < 0) {
          return interaction.reply({ content: `❌ Current HP can't be negative.`, ephemeral: true });
        }
        const clamped = Math.min(currentArg, newMax);
        setCharacterHp(charEntry, clamped);
        if (clamped !== currentArg) {
          changes.push(`current HP set to **${clamped}** (clamped to max)`);
        } else {
          changes.push(`current HP set to **${clamped}**`);
        }
      }

      await saveCharacters(characters);

      const finalMax = computeCharMaxHp(charEntry);
      const finalCurrent = getCharacterHp(charEntry);
      return interaction.reply(`✅ **${charEntry.data.name}**: ${changes.join(', ')}.\nNow at **${finalCurrent} / ${finalMax}** HP.`);
    }

    else if (sub === 'remove') {
      const userId = interaction.user.id;
      const characters = loadCharacters();
      const charKey = interaction.options.getString('name').toLowerCase().replace(/\s+/g, '-');
      if (!characters[userId]?.[charKey]) {
        const names = Object.keys(characters[userId] ?? {}).filter(k => !k.startsWith('_')).map(k => characters[userId][k].name).join(', ');
        return interaction.reply(`Couldn't find that character. Your characters: ${names}`);
      }
      const name = characters[userId][charKey].name;
      delete characters[userId][charKey];
      // If the removed character was the active one, clear that pointer.
      if (characters[userId]._activeChar === charKey) delete characters[userId]._activeChar;
      if (characters[userId]._serverActiveChars) {
        for (const [guildId, activeKey] of Object.entries(characters[userId]._serverActiveChars)) {
          if (activeKey === charKey) {
            delete characters[userId]._serverActiveChars[guildId];
            await characterState.syncServerActiveCharacterToSupabase(userId, guildId, null, interaction.user.username);
          }
        }
        if (Object.keys(characters[userId]._serverActiveChars).length === 0) delete characters[userId]._serverActiveChars;
      }
      await saveCharacters(characters);
      await interaction.reply(`✅ **${name}** has been removed.`);
    }

    else if (sub === 'list') {
      const userId = interaction.user.id;
      const characters = loadCharacters();
      const userChars = characters[userId] ?? {};
      const charKeys = Object.keys(userChars).filter(k => !k.startsWith('_'));
      {
        const activeKey = userChars._activeChar;
        {
        const displayName = interaction.member?.displayName ?? interaction.user.displayName ?? interaction.user.username;
        const avatarUrl = interaction.user.displayAvatarURL({ extension: 'png', size: 64 });
        const sortedKeys = [...charKeys].sort((a, b) => {
          const aName = userChars[a]?.data?.name ?? userChars[a]?.name ?? a;
          const bName = userChars[b]?.data?.name ?? userChars[b]?.name ?? b;
          return String(aName).localeCompare(String(bName));
        });
        const activeChar = activeKey && userChars[activeKey]
          ? (userChars[activeKey]?.data?.name ?? userChars[activeKey]?.name ?? activeKey)
          : 'None set';
        const names = sortedKeys.map(k => {
          const c = userChars[k];
          return c?.data?.name ?? c?.name ?? k;
        });
        const description = charKeys.length
          ? [
              '**Your characters**',
              '',
              `**Active Character:** ${activeChar}`,
              '',
              names.join(', '),
            ].join('\n').slice(0, 4096)
          : '**Your characters**\n\nNo saved characters yet.';
        const charListEmbed = new EmbedBuilder()
          .setColor(0xff9b45)
          .setAuthor({ name: displayName, iconURL: avatarUrl })
          .setDescription(description);
        if (charKeys.length === 0) {
          charListEmbed.setFooter({ text: 'Use /char add, /char import, or /char create to add one.' });
        }
        return interaction.reply({ embeds: [charListEmbed] });
        }
/*
        if (charKeys.length === 0) {
          const emptyEmbed = new EmbedBuilder()
            .setColor(0x7c3aed)
            .setTitle(`${interaction.user.displayName}'s Characters`)
            .setDescription('No saved characters yet.')
            .setFooter({ text: 'Use /char add, /char import, or /char create to add one.' });
          return interaction.reply({ embeds: [emptyEmbed] });
        }

        const sortedKeys = [...charKeys].sort((a, b) => {
          if (a === activeKey) return -1;
          if (b === activeKey) return 1;
          const aName = userChars[a]?.data?.name ?? userChars[a]?.name ?? a;
          const bName = userChars[b]?.data?.name ?? userChars[b]?.name ?? b;
          return String(aName).localeCompare(String(bName));
        });

        const list = sortedKeys.map((k, idx) => {
          const c = userChars[k];
          const name = c?.data?.name ?? c?.name ?? k;
          const level = c?.data?.level ?? c?.level ?? c?.data?.details?.level ?? null;
          const ancestry = c?.data?.ancestry ?? c?.ancestry ?? null;
          const className = c?.data?.class ?? c?.class ?? c?.data?.className ?? null;
          const activeTag = k === activeKey ? ' 📌' : '';
          const artTag = c?.art ? ' 🖼️' : '';
          const detailParts = [];
          if (level !== null && level !== undefined && level !== '') detailParts.push(`Level ${level}`);
          if (ancestry) detailParts.push(ancestry);
          if (className) detailParts.push(className);
          const details = detailParts.length ? `\n${detailParts.join(' • ')}` : '';
          return `**${idx + 1}. ${name}**${activeTag}${artTag}${details}`;
        }).join('\n\n');

        const embed = new EmbedBuilder()
          .setColor(0x7c3aed)
          .setTitle(`${interaction.user.displayName}'s Characters`)
          .setDescription(list.slice(0, 4096))
          .setFooter({ text: `${charKeys.length} saved character${charKeys.length === 1 ? '' : 's'} • 📌 active • 🖼️ art set` });
        return interaction.reply({ embeds: [embed] });
      }
      if (charKeys.length === 0)
        return interaction.reply('You have no saved characters! Use `/char add` to add one.');
      const activeKey = userChars._activeChar;
      const list = charKeys.map(k => {
        const c = userChars[k];
        const activeTag = k === activeKey ? ' 📌 *(active)*' : '';
        const artTag = c.art ? ' 🖼️' : '';
        return `• **${c.name}**${activeTag}${artTag}`;
      }).join('\n');
      await interaction.reply(`Your characters:\n${list}`);
*/
    }
    }

    // /char import — fetch from Pathbuilder's JSON endpoint or Pathway web.
    else if (sub === 'import') {
      await interaction.deferReply({ ephemeral: true });
      const idInput = interaction.options.getString('id', true);
      try {
        const parsedRef = parseCharacterUpdateRef(idInput);
        if (parsedRef.error) return interaction.editReply(`❌ ${parsedRef.error}`);
        const fetched = parsedRef.type === 'pathway'
          ? await fetchPathwayCharacter(parsedRef.id, interaction.user.id)
          : await fetchPathbuilderCharacter(parsedRef.id);
        if (fetched.error) return interaction.editReply(fetched.error);
        const saved = await saveImportedCharacter(interaction.user.id, fetched.char, { preserveOverlay: false, pathwayRow: fetched.row });
        if (saved.error) return interaction.editReply(`❌ ${saved.error}`);
        if (parsedRef.type === 'pathway') {
          return interaction.editReply(`✅ **${saved.name}** imported from Pathway web JSON ID \`${fetched.id}\`! Use \`/sheet\` to view them.`);
        }
        return interaction.editReply(`✅ **${saved.name}** imported from Pathbuilder ID \`${fetched.id}\`! Use \`/sheet\` to view them.`);
      } catch (err) {
        console.error('/char import fetch error:', err);
        return interaction.editReply(`❌ Something went wrong importing that character: \`${err.message}\``);
      }
    }

    else if (sub === 'art') {
      const url = interaction.options.getString('url');
      const characters = loadCharacters();
      const { error, charKey } = resolveChar(interaction.user.id, interaction.options.getString('character'), characters);
      if (error) return interaction.reply({ content: error, ephemeral: true });
      if (!url.startsWith('http://') && !url.startsWith('https://')) return interaction.reply({ content: "That doesn't look like a valid URL.", ephemeral: true });
      characters[interaction.user.id][charKey].art = url;
      await saveCharacters(characters);
      const charName = characters[interaction.user.id][charKey].name;
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x7289DA).setTitle(`✅ Art set for ${charName}`).setThumbnail(url).setDescription('Character art updated!')] });
    }

    // ── /char active ──
    // Set (or clear, or view) the user's active/default character. When set,
    // any command that takes a `character:` option will fall through to this
    // character if the user doesn't specify one. Per-user, applies globally.
    else if (sub === 'active') {
      const userId = interaction.user.id;
      const characters = loadCharacters();
      if (!characters[userId] || Object.keys(characters[userId]).filter(k => !k.startsWith('_')).length === 0) {
        return interaction.reply({ content: 'You have no saved characters! Use `/char add` to add one.', ephemeral: true });
      }
      const nameArg = interaction.options.getString('character');
      const action = interaction.options.getString('action'); // optional: 'clear' or null

      // /char active action:clear
      if (action === 'clear') {
        delete characters[userId]._activeChar;
        await syncActiveCharacterToSupabase(userId, null, interaction.user.username);
        await saveCharacters(characters);
        return interaction.reply({ content: `✅ Active character cleared. Commands will now prompt you to choose when you have multiple characters.`, ephemeral: true });
      }

      // /char active (no args) — view current active
      if (!nameArg) {
        const activeKey = characters[userId]._activeChar;
        if (activeKey && characters[userId][activeKey]) {
          const name = characters[userId][activeKey].name;
          return interaction.reply({ content: `📌 Active character: **${name}**\n*Use \`/char active character:<n>\` to change, or \`/char active action:clear\` to clear.*`, ephemeral: true });
        } else {
          const names = Object.keys(characters[userId]).filter(k => !k.startsWith('_')).map(k => characters[userId][k].name).join(', ');
          return interaction.reply({ content: `📌 No active character set.\n*Your characters: ${names}*\n*Use \`/char active character:<n>\` to set one.*`, ephemeral: true });
        }
      }

      // /char active character:<n> — set active
      const charKey = nameArg.toLowerCase().replace(/\s+/g, '-');
      if (!characters[userId][charKey]) {
        const names = Object.keys(characters[userId]).filter(k => !k.startsWith('_')).map(k => characters[userId][k].name).join(', ');
        return interaction.reply({ content: `❌ Couldn't find **${nameArg}**.\nYour characters: ${names}`, ephemeral: true });
      }
      characters[userId]._activeChar = charKey;
      await syncActiveCharacterToSupabase(userId, charKey, interaction.user.username);
      await saveCharacters(characters);
      const charName = characters[userId][charKey].name;
      return interaction.reply({ content: `📌 Active character set to **${charName}**. Commands will default to them when no \`character:\` is specified.`, ephemeral: true });
    }

    else if (sub === 'serveractive') {
      const userId = interaction.user.id;
      const guildId = interaction.guildId;
      if (!guildId) {
        return interaction.reply({ content: '`/char serveractive` only works in a server, not in DMs.', ephemeral: true });
      }

      const characters = loadCharacters();
      if (!characters[userId] || Object.keys(characters[userId]).filter(k => !k.startsWith('_')).length === 0) {
        return interaction.reply({ content: 'You have no saved characters! Use `/char add` to add one.', ephemeral: true });
      }
      const nameArg = interaction.options.getString('character');
      const action = interaction.options.getString('action');

      if (action === 'clear') {
        await characterState.saveServerActive(userId, guildId, null, interaction.user.username);
        return interaction.reply({ content: `Server active character cleared for **${interaction.guild?.name ?? 'this server'}**. Commands will fall back to your global active character.`, ephemeral: true });
      }

      if (!nameArg) {
        const activeKey = characters[userId]._serverActiveChars?.[guildId];
        if (activeKey && characters[userId][activeKey]) {
          const name = characters[userId][activeKey].name;
          return interaction.reply({ content: `Server active character for **${interaction.guild?.name ?? 'this server'}**: **${name}**\nUse \`/char serveractive character:<n>\` to change, or \`/char serveractive action:clear\` to clear.`, ephemeral: true });
        }
        const globalKey = characters[userId]._activeChar;
        const globalName = globalKey && characters[userId][globalKey]?.name ? characters[userId][globalKey].name : null;
        const names = Object.keys(characters[userId]).filter(k => !k.startsWith('_')).map(k => characters[userId][k].name).join(', ');
        return interaction.reply({
          content: `No server active character set for **${interaction.guild?.name ?? 'this server'}**.${globalName ? `\nGlobal fallback: **${globalName}**.` : ''}\nYour characters: ${names}\nUse \`/char serveractive character:<n>\` to set one.`,
          ephemeral: true,
        });
      }

      const resolved = resolveChar(userId, nameArg, characters, { guildId });
      if (resolved.error) return interaction.reply({ content: resolved.error, ephemeral: true });

      const saved = await characterState.saveServerActive(userId, guildId, resolved.charKey, interaction.user.username);
      if (saved.error) return interaction.reply({ content: saved.error, ephemeral: true });

      return interaction.reply({
        content: `Server active character for **${interaction.guild?.name ?? 'this server'}** set to **${resolved.char.name}**. Commands in this server will default to them when no \`character:\` is specified.`,
        ephemeral: true,
      });
    }

    else if (sub === 'feat') {
      const action = interaction.options.getString('action'); // add or remove
      const featName = interaction.options.getString('name');
      const userId = interaction.user.id;
      const characters2 = loadCharacters();
      const { error: e2, charKey: ck2, char: ce2 } = resolveChar(userId, interaction.options.getString('character'), characters2);
      if (e2) return interaction.reply({ content: e2, ephemeral: true });
      const featLevel = interaction.options.getInteger('level') ?? ce2.data?.level ?? 1;
      if (!ce2.data.feats) ce2.data.feats = [];
      if (action === 'add') {
        // Pathbuilder stores feats as arrays: [name, sourceText, level, ...]
        ce2.data.feats.push([featName, '', featLevel, '']);
        characters2[userId][ck2] = ce2;
        await saveCharacters(characters2);
        return interaction.reply({ content: `✅ Added feat **${featName}** (level ${featLevel}) to **${ce2.data.name}**.` });
      }
      if (action === 'remove') {
        const before = ce2.data.feats.length;
        ce2.data.feats = ce2.data.feats.filter(f => {
          const name = Array.isArray(f) ? f[0] : (f.name ?? f);
          return String(name).toLowerCase() !== featName.toLowerCase();
        });
        if (ce2.data.feats.length === before) return interaction.reply({ content: `❌ Feat "${featName}" not found on **${ce2.data.name}**.`, ephemeral: true });
        characters2[userId][ck2] = ce2;
        await saveCharacters(characters2);
        return interaction.reply({ content: `🗑️ Removed feat **${featName}** from **${ce2.data.name}**.` });
      }
    }
}

module.exports = {
  name: 'char',
  execute,
};
