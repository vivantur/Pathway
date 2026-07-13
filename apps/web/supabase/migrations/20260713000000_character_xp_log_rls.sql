-- Let the website (authenticated user, anon key) manage its own XP-log entries.
--
-- The `character_xp_log` table was created by the bot (apps/bot/supabase/
-- 20260612_character_xp_log.sql) with a service-role FOR-ALL policy and a
-- SELECT-only policy for authenticated users. That's enough for the website to
-- *read* the log, but not to add/edit/delete entries. This adds the write policy
-- (owner-scoped, mirroring the `companions` table) so the XP-log editor on the
-- character sheet can insert/update/delete a user's own rows with their auth
-- token. The bot's Realtime subscription on this table reflects those writes
-- automatically — no bot change needed.
--
-- Idempotent: safe to re-apply. Apply to each environment with
--   npx supabase db push   (from apps/web/supabase, linked to the target project)

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'character_xp_log'
  ) THEN
    EXECUTE 'ALTER TABLE public.character_xp_log ENABLE ROW LEVEL SECURITY';

    -- Full CRUD for the owning authenticated user (user_id must be their auth uid).
    EXECUTE 'DROP POLICY IF EXISTS "Users manage their own XP log" ON public.character_xp_log';
    EXECUTE $p$
      CREATE POLICY "Users manage their own XP log"
        ON public.character_xp_log
        FOR ALL
        TO authenticated
        USING (user_id = auth.uid())
        WITH CHECK (user_id = auth.uid())
    $p$;

    -- DELETE payloads must carry all columns so the bot's Realtime cache (keyed
    -- by row id, not always the PK) can evict the right entry.
    EXECUTE 'ALTER TABLE public.character_xp_log REPLICA IDENTITY FULL';
  END IF;
END $$;
