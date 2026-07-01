-- Self-relink on login (Phase W1)
-- =============================================================================
-- Problem: the web gets a Supabase `auth.uid()` per user, but the bot owns
-- characters under its own `public.users.id`. The two only agree for the
-- owner, whom we relinked by hand. This function generalizes that relink so
-- ANY community member who signs in with Discord automatically claims their
-- existing bot characters.
--
-- Safe because:
--   * The Discord id is read from the caller's own cryptographically-signed
--     JWT (`auth.jwt()`), so a user can never claim someone else's identity.
--   * Every FK to users.id is ON UPDATE CASCADE (verified 2026-07-01), so a
--     single `UPDATE users SET id = …` reassigns all 24 child tables
--     atomically inside the function's transaction.
--   * Idempotent: after the first successful link the caller's auth.uid()
--     already equals their users.id, so subsequent calls no-op.
--   * SECURITY DEFINER + a pinned search_path (prevents search-path injection).
--
-- Return shape (jsonb): { status, characters?, previous_id?, detail? }
--   status = 'linked'          -> rewrote OLD id → auth.uid(); characters = count claimed
--            'already_linked'  -> nothing to do; characters = count owned
--            'no_bot_identity' -> no users row for this Discord id (web-only user)
--            'no_discord_id'   -> JWT had no Discord claim (non-Discord login)
--            'conflict'        -> auth.uid() already maps to a DIFFERENT bot user
--            'not_authenticated'
-- =============================================================================

create or replace function public.relink_current_user()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_uid uuid := auth.uid();
  v_discord  text := (auth.jwt() -> 'user_metadata' ->> 'provider_id');
  v_old_id   uuid;
  v_conflict_discord text;
  v_char_count int;
begin
  if v_auth_uid is null then
    return jsonb_build_object('status', 'not_authenticated');
  end if;

  -- provider_id is Supabase's canonical spot for the Discord snowflake;
  -- fall back to sub inside user_metadata just in case.
  if v_discord is null then
    v_discord := (auth.jwt() -> 'user_metadata' ->> 'sub');
  end if;

  if v_discord is null then
    return jsonb_build_object('status', 'no_discord_id');
  end if;

  -- Find the bot users row for this verified Discord identity.
  select id into v_old_id from public.users where discord_id = v_discord limit 1;

  if v_old_id is null then
    return jsonb_build_object('status', 'no_bot_identity');
  end if;

  if v_old_id = v_auth_uid then
    select count(*) into v_char_count from public.characters where user_id = v_auth_uid;
    return jsonb_build_object('status', 'already_linked', 'characters', v_char_count);
  end if;

  -- Guard: never clobber a users row that already carries the auth.uid() but
  -- belongs to a different Discord identity (should be impossible, but abort
  -- cleanly rather than corrupt if it ever happens).
  select discord_id into v_conflict_discord from public.users where id = v_auth_uid;
  if v_conflict_discord is not null then
    return jsonb_build_object(
      'status', 'conflict',
      'detail', 'auth id is already mapped to a different bot user'
    );
  end if;

  -- The one line that does the work. ON UPDATE CASCADE fans this out to
  -- characters, character_notes, bags, xp_log, and every other child table.
  update public.users set id = v_auth_uid where id = v_old_id;

  select count(*) into v_char_count from public.characters where user_id = v_auth_uid;
  return jsonb_build_object(
    'status', 'linked',
    'characters', v_char_count,
    'previous_id', v_old_id
  );
end;
$$;

-- Only signed-in users may call it; it always acts on the caller's own identity.
grant execute on function public.relink_current_user() to authenticated;
