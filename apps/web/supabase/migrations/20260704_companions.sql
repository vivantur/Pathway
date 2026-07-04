-- Companions — reconcile the web app with the bot's live `companions` table.
--
-- IMPORTANT: this table already exists in the live Supabase project; its schema
-- was RECONSTRUCTED from the bot's upsert/read code (apps/bot/src/state/
-- companions.js) because no DDL was ever checked into the repo. Every statement
-- here is IDEMPOTENT and ADDITIVE (CREATE ... IF NOT EXISTS, ADD COLUMN IF NOT
-- EXISTS, DROP POLICY IF EXISTS/CREATE) so applying it against the existing
-- table changes nothing destructive. REVIEW against the live table (column
-- inventory + existing constraints) before applying — see data-model.md Open
-- Question #1.
--
-- Sync contract the bot depends on (do not change without changing the bot):
--   * Row identity / upsert conflict key: (user_id, char_key, comp_key).
--   * The character link is the logical (user_id, char_key) pair — NOT a DB FK
--     to characters.id.
--   * `custom_stats` is a nested JSONB envelope:
--       { customStats, art, skills, customAbilities, customAttacks, overrides }
--   * RLS/Realtime invariants per data-model.md §6.

CREATE TABLE IF NOT EXISTS public.companions (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  char_key TEXT NOT NULL,
  comp_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  base_type TEXT NOT NULL DEFAULT 'custom',
  form TEXT NOT NULL DEFAULT 'young'
    CHECK (form IN ('young', 'mature', 'nimble', 'savage')),
  notes TEXT,
  current_hp INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT false,
  custom_stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Defensive: ensure columns the website relies on exist even if the live table
-- predates them (additive, no-op when already present).
ALTER TABLE public.companions ADD COLUMN IF NOT EXISTS base_type TEXT NOT NULL DEFAULT 'custom';
ALTER TABLE public.companions ADD COLUMN IF NOT EXISTS form TEXT NOT NULL DEFAULT 'young';
ALTER TABLE public.companions ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.companions ADD COLUMN IF NOT EXISTS current_hp INTEGER;
ALTER TABLE public.companions ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.companions ADD COLUMN IF NOT EXISTS custom_stats JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.companions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.companions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Upsert conflict key (unique index satisfies the bot's onConflict target).
CREATE UNIQUE INDEX IF NOT EXISTS companions_identity_idx
  ON public.companions (user_id, char_key, comp_key);

CREATE INDEX IF NOT EXISTS companions_character_idx
  ON public.companions (user_id, char_key);

ALTER TABLE public.companions ENABLE ROW LEVEL SECURITY;

-- The bot writes with the service role.
DROP POLICY IF EXISTS "Service role manages companions" ON public.companions;
CREATE POLICY "Service role manages companions"
  ON public.companions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- The website (anon key, authenticated user) manages only its own companions.
DROP POLICY IF EXISTS "Users manage their own companions" ON public.companions;
CREATE POLICY "Users manage their own companions"
  ON public.companions
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- DELETE payloads must carry all columns (the bot's cache key is not the PK).
ALTER TABLE public.companions REPLICA IDENTITY FULL;

-- Ensure the table is published for Realtime (guarded so re-runs are no-ops).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'companions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.companions;
  END IF;
END $$;
