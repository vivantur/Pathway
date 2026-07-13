-- Add an `associations` jsonb column to `spells`.
--
-- Holds the "granted by" data (oracle mystery, sorcerer bloodline, cleric domain,
-- deities, witch lesson, warlock/psychic patron) that the old AoN transform
-- dropped entirely. Shape matches what @pathway/core's coerceSpell reads:
--   [{ "kind": "deity", "values": ["Sarenrae", "Angradd", ...] }, ...]
--
-- Combat-neutral: the bot's spell/combat code does not read this column, so
-- populating it (via tools/aon-import-associations.js --apply) cannot affect
-- /cast, /i, or /monstercast. The web recovers Spell.associations for free.
ALTER TABLE IF EXISTS public.spells
  ADD COLUMN IF NOT EXISTS associations jsonb;
