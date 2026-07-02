// ── lib/pathwayWebClient.js ─────────────────────────────────────────────────
// Read/write client for the Pathway web app's character store.
//
// The web app and the bot share the same Supabase `characters` table. This
// module is the bot's narrow API for fetching a row by its web-side UUID
// (`/char add pathway-id:<uuid>`), finding a row that matches a locally
// stored character by name/key (`/sheet` refresh), and importing fetched
// data into the bot's local cache (`saveImportedCharacter`).
//
// Each function returns either `{ error: '...' }` (a user-displayable
// message) or a success shape — these are NOT thrown errors. The bot's
// command handlers can `.reply(result.error)` directly when it's set.
//
// Phase 3.7 extracted these from index.js along with the username cache
// and the character-storage limit constant, both of which now live in
// state/characters.js so this module can pull them via clean imports.

const { getSupabase } = require('./supabase');
const characterState = require('../state/characters');
const {
  computeCharMaxHp,
  MAX_CHARACTERS_PER_USER,
} = characterState;

// ── Reads ──────────────────────────────────────────────────────────────────

// Fetch a Pathway web character by its Supabase row UUID. Verifies the
// requesting Discord user owns the linked Supabase user row.
async function fetchPathwayCharacter(pathwayId, discordId) {
  const sb = getSupabase();
  if (!sb) {
    return {
      error:
        '❌ Supabase is not configured for this bot process, so I cannot read Pathway web JSON IDs here yet.',
    };
  }

  const { data: charRow, error: charErr } = await sb
    .from('characters')
    .select('id, user_id, char_key, name, source, pathbuilder_data, current_hp, hero_points, dying, wounded, experience, overlay, updated_at')
    .eq('id', pathwayId)
    .maybeSingle();
  if (charErr) return { error: `❌ Could not read that Pathway character: ${charErr.message}` };
  if (!charRow) return { error: `❌ No Pathway web character found for JSON ID \`${pathwayId}\`.` };

  if (charRow.user_id) {
    const { data: userRow, error: userErr } = await sb
      .from('users')
      .select('id')
      .eq('discord_id', String(discordId))
      .maybeSingle();
    if (userErr) return { error: `❌ Could not verify the Pathway character owner: ${userErr.message}` };
    if (!userRow?.id) {
      return {
        error:
          '❌ I found that Pathway character, but your Discord account is not linked to a Pathway web account in Supabase.',
      };
    }
    if (userRow.id !== charRow.user_id) {
      return { error: '❌ That Pathway JSON ID belongs to a different Pathway web account.' };
    }
  }

  const stored = charRow.pathbuilder_data;
  const char = stored?.build ?? stored;
  if (!char || typeof char !== 'object' || !char.name) {
    return {
      error:
        `❌ Pathway web character \`${pathwayId}\` does not have usable Pathbuilder sheet data saved yet.`,
    };
  }

  if (charRow.source) char._pathwaySource = charRow.source;
  return { char, id: pathwayId, updatedAt: charRow.updated_at, charKey: charRow.char_key, row: charRow };
}

// Find the Pathway web row matching a locally stored character by name or
// char_key. Used by /sheet's auto-refresh — when the bot has a local
// Pathway-native character but doesn't know its UUID, this discovers the
// row on Supabase via fuzzy name/key matching.
async function fetchLinkedPathwayCharacter(discordId, localKey, localEntry) {
  const sb = getSupabase();
  if (!sb) return { error: 'Supabase is not configured.' };

  const { data: userRow, error: userErr } = await sb
    .from('users')
    .select('id')
    .eq('discord_id', String(discordId))
    .maybeSingle();
  if (userErr) return { error: userErr.message };
  if (!userRow?.id) return { error: 'No linked Pathway web user found.' };

  const { data: rows, error: charErr } = await sb
    .from('characters')
    .select('id, user_id, char_key, name, source, pathbuilder_data, current_hp, hero_points, dying, wounded, experience, overlay, updated_at')
    .eq('user_id', userRow.id);
  if (charErr) return { error: charErr.message };

  const normalize = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, '-');
  const localName = localEntry?.name ?? localEntry?.data?.name ?? '';
  const candidates = rows ?? [];
  const row = candidates.find((candidate) =>
    normalize(candidate.char_key) === normalize(localKey) ||
    normalize(candidate.name) === normalize(localName) ||
    normalize(candidate.name) === normalize(localKey)
  );
  if (!row) return { error: 'No matching Pathway web character found.' };

  const stored = row.pathbuilder_data;
  const char = stored?.build ?? stored;
  if (!char || typeof char !== 'object' || !char.name) {
    return { error: `Pathway web character \`${row.id}\` does not have usable sheet data saved yet.` };
  }
  if (row.source) char._pathwaySource = row.source;
  return { char, id: row.id, updatedAt: row.updated_at, charKey: row.char_key, row };
}

// ── Writes ─────────────────────────────────────────────────────────────────

// Merge two overlay objects shallowly, with special handling for the
// `daily` sub-object (also shallow-merged). Used when /char update or
// /char sync receives fresh data from Pathway web but the bot has its own
// overlay state to preserve.
function _mergeCharacterOverlay(baseOverlay, incomingOverlay) {
  if (!incomingOverlay || typeof incomingOverlay !== 'object' || Array.isArray(incomingOverlay)) {
    return baseOverlay;
  }
  const base = (baseOverlay && typeof baseOverlay === 'object' && !Array.isArray(baseOverlay)) ? baseOverlay : {};
  const incoming = incomingOverlay;
  return {
    ...base,
    ...incoming,
    daily: {
      ...(base.daily ?? {}),
      ...(incoming.daily ?? {}),
    },
  };
}

// Save an imported Pathway/Pathbuilder character into the bot's cache + Supabase.
// Returns `{ ok: true, key, name, level, replaced }` on success or `{ error }` if
// the data is malformed or the user has hit the character cap.
//
// Options:
//   preserveOverlay (bool): keep all bot-managed state (HP, hero points, XP,
//     dying/wounded, companions, etc.). Used by /char update and the
//     /sheet auto-refresh path so re-imports don't wipe in-flight state.
//   pathwayRow (object|null): the Supabase row this import came from. If
//     present, the local entry gets stamped with `pathwayWebId` so future
//     /sheet refreshes can find it again without name matching.
async function saveImportedCharacter(userId, rawChar, { preserveOverlay = false, pathwayRow = null } = {}) {
  const char = rawChar?.build ?? rawChar;
  if (!char || !char.name) {
    return { error: 'Pathbuilder data is missing a character name. Re-export and try again.' };
  }
  const characters = characterState.getAll();
  if (!characters[userId]) characters[userId] = {};
  const nameKey = char.name.toLowerCase().replace(/\s+/g, '-');
  const rowKey = pathwayRow?.char_key || null;
  const existingWebKey = pathwayRow?.id
    ? Object.entries(characters[userId]).find(([k, entry]) =>
        !k.startsWith('_') && entry?.pathwayWebId === pathwayRow.id
      )?.[0]
    : null;
  const key = existingWebKey || (rowKey && characters[userId][rowKey] ? rowKey : rowKey || nameKey);
  const prev = characters[userId][key];
  const existed = !!prev || !!pathwayRow;

  // Enforce character limit for new characters only (updates are fine)
  if (!existed) {
    const count = Object.keys(characters[userId]).filter(k => !k.startsWith('_')).length;
    if (count >= MAX_CHARACTERS_PER_USER) {
      return { error: `You've reached the ${MAX_CHARACTERS_PER_USER}-character limit. Remove one with \`/char remove\` before adding another.` };
    }
  }

  // Always preserve art, senses, and user edits (background/deity/skill overrides).
  const existingArt    = prev?.art ?? null;
  const existingSenses = prev?.senses ?? null;
  const existingEdits  = prev?.edits ?? null;
  const baseEntry = {
    name: char.name,
    data: char,
    art: existingArt,
    senses: existingSenses,
    edits: existingEdits,
    pathwayWebId: pathwayRow?.id ?? prev?.pathwayWebId,
    saved: new Date().toISOString(),
  };

  if (preserveOverlay && prev) {
    // /char update / /char sync path: keep all bot-managed state.
    const preserved = {
      heroPoints: Number.isFinite(Number(pathwayRow?.hero_points)) ? Number(pathwayRow.hero_points) : prev.heroPoints,
      xp: Number.isFinite(Number(pathwayRow?.experience)) ? Number(pathwayRow.experience) : prev.xp,
      xpLog: prev.xpLog,
      hp: Number.isFinite(Number(pathwayRow?.current_hp)) ? Number(pathwayRow.current_hp) : prev.hp,
      dying: Number.isFinite(Number(pathwayRow?.dying)) ? Number(pathwayRow.dying) : prev.dying,
      wounded: Number.isFinite(Number(pathwayRow?.wounded)) ? Number(pathwayRow.wounded) : prev.wounded,
      overlay: _mergeCharacterOverlay(prev.overlay, pathwayRow?.overlay),
      languages: prev.languages, // languages overlay, separate from `edits.languages`
      // Companions are bot-managed (added via /companion add, edited via
      // /companion edit) and have nothing to do with Pathbuilder data, so
      // /char update must keep them. Without this preservation the entire
      // companions map gets nuked on every re-import.
      companions: prev.companions,
      activeCompanion: prev.activeCompanion,
      pathwayWebId: pathwayRow?.id ?? prev.pathwayWebId,
    };
    characters[userId][key] = { ...baseEntry, ...preserved };
    // Clamp current HP if max dropped.
    if (typeof preserved.hp === 'number') {
      const newMax = computeCharMaxHp(characters[userId][key]);
      if (newMax > 0 && preserved.hp > newMax) {
        characters[userId][key].hp = newMax;
      }
    }
  } else {
    characters[userId][key] = baseEntry;
  }

  await characterState.saveAll(characters);
  return { ok: true, key, name: char.name, level: char.level, replaced: existed };
}

module.exports = {
  fetchPathwayCharacter,
  fetchLinkedPathwayCharacter,
  saveImportedCharacter,
};
