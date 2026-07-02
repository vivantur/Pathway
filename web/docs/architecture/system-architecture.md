# System Architecture

> Status: **Revised after reading the live bot** · Companion to the
> [Master Specification](../../PATHWAY_MASTER_SPEC.md) and the
> [Web ⇄ Bot Sync Contract](./web-bot-sync.md).

> **Important correction (2026-06-30):** An earlier draft of this document
> assumed Pathway was greenfield and the Discord bot would be built later as a
> thin client on a new shared `core` package. **That is not the situation.** The
> Discord bot (`vivantur/pathway`) is **already built, functional, and in
> production**, and it already owns a live Supabase database with a real schema
> and a working Realtime sync layer. The website is therefore a **second client
> on an existing backend**, not the origin of a new one. The architecture below
> reflects reality. See [ADR-0002](./decisions/0002-website-as-second-client.md).

---

## 1. The actual shape of the platform

Pathway is already a two-client platform with **one authoritative datastore**.
The website's job is to become the second, equal client — not to re-found the
backend.

```
        ┌─────────────┐                      ┌──────────────────────────┐
        │   Website    │                      │   Discord Bot (LIVE)     │
        │ React/Vite/TS│                      │  Node.js (CommonJS)      │
        │  (this repo) │                      │  discord.js v14          │
        └──────┬───────┘                      │  vivantur/pathway        │
               │                              └────────────┬─────────────┘
               │  Supabase JS, ANON key,                   │ Supabase JS, SERVICE-ROLE key
               │  user JWT → RLS applies                   │ (bypasses RLS), in-memory cache
               │                                           │ + Realtime postgres_changes
               ▼                                           ▼
        ┌──────────────────────────────────────────────────────────────┐
        │                    Supabase  (PostgreSQL 16)                   │
        │   prod: cmmwirlrvqmjqbydlqks   ·   develop: nqnswvuqszpkntnjzomv│
        │   Auth · Storage · Realtime publication (supabase_realtime)    │
        │   Source of truth for ALL user state and content               │
        └──────────────────────────────────────────────────────────────┘
```

**Sync is mostly a consequence of this topology, not a feature to build.** There
is exactly one `characters` row per character. When the website writes it, the
bot's Realtime subscription patches its in-memory cache; when the bot writes it,
the website (if it subscribes to Realtime) sees the update. The bot already
implements the hard half — see §4.

---

## 2. Repository reality

The bot's own docs describe the intended layout:

```
pathfinder_bot/                 (a working tree, not one repo)
  Pathway/                      → repo vivantur/pathway  (the bot, LIVE)
    index.js                    → v1, currently deployed on Railway
    Pathwayv2/                  → v2 rewrite (feature folders, in progress)
      src/{commands,state,rules,lib,parsers}
      supabase/                 → import helpers + a couple of ad-hoc migrations
  web/                          → "the web companion app (separate repo)"
    supabase/migrations/        → ⚠️ the canonical migration home
```

`vivantur/pathway-website` (this repo) is, by all evidence, that `web/` app —
but it is currently empty. **Two consequences:**

1. The website is **not** a monorepo that contains the bot. It is its own repo
   (`apps/web`-style), talking to the shared Supabase project over the network.
2. By the bot's convention, **the web repo owns the Supabase migrations**
   (`supabase/migrations/`). The bot deliberately does not. So schema changes —
   even ones the bot needs — are authored and applied from here.

> **Open decision:** confirm that `pathway-website` *is* the `web/` repo the bot
> references, and that its `supabase/migrations/` becomes the canonical schema
> source. Already-applied migrations (the `20260524*` Realtime set, the
> `align_user_ids_with_auth` migration, etc.) should be back-filled into this
> repo so the schema has a single tracked history. Tracked in
> [the roadmap](./roadmap.md), Phase W0.

---

## 3. There is no greenfield `core` — the rules logic already exists

The bot already contains the PF2e logic, in `Pathwayv2/src/rules/` (e.g.
`pf2eMath.js` proficiency math, `lore.js`) and `lib/` (formatting, dice,
spell damage, ancestry parsing). It is **CommonJS JavaScript, not a shared
TypeScript package.**

So the website has three honest options for rules logic, decided per-feature
rather than globally:

- **(A) Re-derive in the web stack (TypeScript).** Fastest to start; risks
  drift from the bot's math. Acceptable for pure display math that's easy to
  test against PF2e rules.
- **(B) Extract shared logic into a published/shared package over time.** The
  ideal end state, but it means porting battle-tested JS to TS and keeping two
  consumers in lockstep. A later investment, not a prerequisite.
- **(C) Let the database be the contract.** For anything the bot computes and
  *persists* (HP, XP, overlay state), the website reads/writes the stored
  columns and does **not** recompute authoritatively. This is the safest path
  and the one the existing `characters` schema is built for.

The guiding rule: **never let the website and bot disagree about a persisted
value.** Where a value lives in a column, the column wins; the website edits the
column and lets the bot's cache catch up via Realtime.

---

## 4. Synchronization — already half-built on the bot side

This is the heart of the user's request ("the bot just needs to be in sync with
the website"), and the bot already does the difficult part:

- **Service-role + in-memory cache + Realtime.** The bot connects with the
  service key, hydrates caches at startup, and subscribes to `postgres_changes`
  on every user-state table.
- **The "Liv's bug" fix (Phase 2).** Each state module uses
  *subscribe-before-restore* ordering with a pending-event queue, plus a per-row
  `updated_at` freshness check, so a web-app write is reflected in the bot
  promptly and the bot's next write won't clobber a fresher web value.
- **Realtime membership is already configured** (`REPLICA IDENTITY FULL` +
  `supabase_realtime` publication) for the existing state tables.

**What the website must do to "be in sync"** is therefore narrow and concrete —
it is specified in full in [web-bot-sync.md](./web-bot-sync.md):

1. Authenticate the user with Supabase Auth and resolve them to the **same
   `users` row** the bot uses (`users.id = auth.uid()`, `users.discord_id`).
2. Write user-state rows in the **exact column shape** the bot reads (especially
   `characters.pathbuilder_data` + the HP/XP/overlay columns).
3. Always set `updated_at` on writes so the freshness check works.
4. Optionally subscribe to Realtime itself for live UI updates from bot writes.
5. **Never** ship the service-role key to the browser — the website uses the
   anon key and relies on RLS.

---

## 5. Identity & authorization

| Concept | Value | Notes |
| --- | --- | --- |
| Pathway account | `users` row | `id` equals Supabase Auth `auth.uid()`. |
| Discord link | `users.discord_id` | Snowflake string. Bot resolves via `lib/userMap.js`. |
| Web auth | Supabase Auth | Email and/or Discord OAuth provider. |
| Web access control | **RLS** | Authenticated users act as `auth.uid()`; policies gate rows by `user_id`. |
| Bot access control | **Service role** | Bypasses RLS by design (it's a trusted server acting for many users). |

**Decision to confirm:** how a Discord identity and a web login become the *same*
`users` row. Cleanest is enabling **Discord as a Supabase Auth provider** so a
web login via Discord yields `auth.uid()` already associated with the snowflake;
a fallback is an explicit account-link flow. Tracked as an ADR in Phase W1.

---

## 6. Storage, exports, payments (unchanged in intent)

- **Portraits/tokens/banners:** Supabase Storage (the `characters` row already
  carries art via the bot's `art` overlay / `source` fields).
- **Pathbuilder JSON / PDF export:** the website can export directly from
  `pathbuilder_data`. The bot already *imports* Pathbuilder data
  (`parsers/`, `lib/pathwayWebClient.js`), so the formats are known and shared.
- **Payments / whitelist / public API / plugins:** unchanged from the master
  spec's intent; they layer on top of this backend later. Stripe-ready stubs and
  the whitelist flag are website concerns when we reach them.

---

## 7. What this revision changes vs. the first draft

| First draft assumed | Reality |
| --- | --- |
| Greenfield platform, build backend from scratch | Backend is live; website joins it |
| Bot is Phase 5, built as a thin client later | Bot is done and in production now |
| New monorepo with `packages/core` | Separate repos; bot logic is existing CommonJS |
| Design a new schema | Conform to the **existing** schema (see [data-model.md](./data-model.md)) |
| Sync is a feature to design | Sync is mostly inherent; bot already does the hard part |

---

## 8. Open decisions (upcoming ADRs)

1. Confirm `pathway-website` == the bot's `web/` repo + adopt
   `supabase/migrations/` as canonical (Phase W0).
2. Discord ⇄ web identity unification (Auth provider vs. link flow) (Phase W1).
3. Website framework details: plain Vite SPA vs. a meta-framework; how it talks
   to Supabase (direct client vs. a thin Express API as the spec's stack implies).
4. Per-feature rules-logic strategy (A/B/C from §3).
5. Whether/when to extract a shared rules package from the bot.
