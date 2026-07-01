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
--            'created'         -> web-only user (no prior bot row); created a fresh
--                                 users row keyed to auth.uid() so they can import
--            'no_discord_id'   -> JWT had no Discord claim (non-Discord login)
--            'conflict'        -> auth.uid() already maps to a DIFFERENT bot user
--            'not_authenticated'
--
-- Web-only signup: a user who has never used the Discord bot has no `users`
-- row, but characters.user_id FKs to users.id — so without a row, they can't
-- import. The 'no_bot_identity' path now CREATES a minimal users row (only
-- discord_id is required; everything else is nullable or defaulted) keyed to
-- auth.uid(), pulling username/avatar/email from the JWT. Because the row is
-- keyed by discord_id, when that user later uses the bot, the bot finds this
-- exact row and stays in sync.
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
  v_username text;
  v_avatar   text;
  v_email    text;
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
    -- Web-only signup: no bot row exists for this Discord id. Guard against a
    -- row already carrying auth.uid() under a different discord (shouldn't
    -- happen — auth uids are random — but abort cleanly if so).
    select discord_id into v_conflict_discord from public.users where id = v_auth_uid;
    if v_conflict_discord is not null then
      return jsonb_build_object(
        'status', 'conflict',
        'detail', 'auth id already exists as a bot user with a different Discord id'
      );
    end if;

    -- Pull display fields from the verified JWT (all optional / defaulted in
    -- the users table; only discord_id is strictly required).
    v_username := coalesce(
      auth.jwt() -> 'user_metadata' ->> 'full_name',
      auth.jwt() -> 'user_metadata' ->> 'name',
      auth.jwt() -> 'user_metadata' ->> 'user_name',
      'Discord User'
    );
    v_avatar := auth.jwt() -> 'user_metadata' ->> 'avatar_url';
    v_email  := coalesce(
      auth.jwt() ->> 'email',
      auth.jwt() -> 'user_metadata' ->> 'email'
    );

    insert into public.users (id, discord_id, discord_username, discord_avatar, email)
    values (v_auth_uid, v_discord, v_username, v_avatar, v_email);

    return jsonb_build_object('status', 'created', 'characters', 0);
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
