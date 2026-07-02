# Supabase — canonical schema home

By the bot's own convention (see
[ADR-0002](../docs/architecture/decisions/0002-website-as-second-client.md) and
[data-model.md](../docs/architecture/data-model.md)), **this web repo owns the
Supabase migrations** — the Discord bot deliberately does not. Schema changes,
even ones the bot needs, are authored and applied from here.

## Project

One Supabase project for now: **`udefzabsnuqwcwqevtpd`**
(`https://udefzabsnuqwcwqevtpd.supabase.co`). This is the website's backend and
the destination the bot's data is being migrated to.

> **Current reality (migration pending):** the live Discord bot still reads a
> third-party Supabase project; its data has not yet been migrated here, so this
> project may not contain the bot's tables yet. The website connects to this
> project today, but true website ⇄ bot sync only switches on once the bot also
> points at this project. A separate "develop/sandbox" project can be added
> later as a safety net but is not required to start.

## Invariants every user-state migration must preserve

The bot's in-memory cache + Realtime sync depend on these. For any user-state
table (see [data-model.md §6](../docs/architecture/data-model.md)):

1. **RLS enabled** — `service_role` gets full access (the bot); `authenticated`
   is scoped by `user_id = auth.uid()` (the website).
2. **`REPLICA IDENTITY FULL`** so DELETE payloads carry all columns.
3. **Membership in the `supabase_realtime` publication.**
4. An **`updated_at TIMESTAMPTZ`** column set on every write.

The bot's `20260612_character_xp_log.sql` is the reference template for all four.

## Workflow (Phase W0+)

- Author migrations as timestamped SQL files in `migrations/`.
- Apply with the Supabase CLI (`npx supabase ...`), linked to project
  `udefzabsnuqwcwqevtpd`. **Verify the linked project before pushing.**
- **Back-fill** the bot's existing migrations (the `20260524*` Realtime set,
  `align_user_ids_with_auth`, `active_character`, `character_xp_log`, the
  homebrew/draft catch-ups) into this repo as part of the data migration, so the
  schema has a single tracked history here.
- **Coordinate with the bot** before changing existing tables — it caches their
  shapes in `state/*` modules and needs a paired change.

> Per the bot owner's standing rule: use the Supabase **CLI**, not the MCP
> Supabase tool, and confirm the linked project before every push.
