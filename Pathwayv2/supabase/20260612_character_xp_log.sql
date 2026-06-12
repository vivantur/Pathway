CREATE TABLE IF NOT EXISTS public.character_xp_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  char_key TEXT NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT,
  old_xp INTEGER NOT NULL DEFAULT 0,
  new_xp INTEGER NOT NULL DEFAULT 0,
  awarded_by_discord_id TEXT,
  entry_type TEXT NOT NULL DEFAULT 'award'
    CHECK (entry_type IN ('award', 'set', 'reset')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS character_xp_log_character_idx
  ON public.character_xp_log (user_id, char_key, created_at DESC);

CREATE INDEX IF NOT EXISTS character_xp_log_created_at_idx
  ON public.character_xp_log (created_at DESC);

ALTER TABLE public.character_xp_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages character XP log" ON public.character_xp_log;
CREATE POLICY "Service role manages character XP log"
  ON public.character_xp_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users can read their character XP log" ON public.character_xp_log;
CREATE POLICY "Users can read their character XP log"
  ON public.character_xp_log
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

ALTER TABLE public.character_xp_log REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'character_xp_log'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.character_xp_log;
  END IF;
END $$;
