# Data Model (Conceptual)

> Status: **Draft for review** · Phase 0 (Planning) · Companion to the
> [System Architecture](./system-architecture.md).

This is a **conceptual** data model — entities, relationships, and the scoping
columns that drive Row Level Security. It is not a finalized schema. Exact
column types, indexes, and migrations are produced during the foundation and
per-feature phases. The goal here is to agree on the shape before writing SQL.

Legend: `PK` primary key · `FK` foreign key · *italic* = scope/permission column.

---

## 1. Domains at a glance

```
 Identity        Rules Content        Player Content         Collaboration
 ─────────       ──────────────       ───────────────        ─────────────
 user            rule_source          character              campaign
 account_link    spell                companion              campaign_member
 (discord)       feat                 character_feat         organization
                 class                character_item         org_member
                 ancestry             character_history      campaign_entity
                 item                  (audit/level log)      (npc/quest/loot…)
                 monster
                 hazard               Homebrew              Commerce / API
                 condition            ─────────             ───────────────
                 trait                homebrew_object        subscription
                                      homebrew_version       api_key
                                      moderation_report      plugin
                                      rating / comment
```

---

## 2. Identity

### `user`
The Pathway account. Backed by Supabase Auth.
- `id` PK
- `display_name`, `avatar_url`
- `created_at`
- *`is_whitelisted`* (gates premium features pre-launch)

### `account_link`
Links external identities (Discord) to a `user`.
- `id` PK
- `user_id` FK → user
- `provider` (`discord`)
- `provider_user_id`
- `linked_at`

**Why separate:** the bot resolves a Discord user → Pathway user through this
table, so bot actions run with the right account's permissions.

---

## 3. Rules content (ingested, read-only to users)

All official content is **published** from the AoN pipeline and is read-only to
normal users. Every record carries source/attribution.

### `rule_source`
- `id` PK · `name` (e.g. "Player Core") · `publisher` · `license` · `url`

### Shared columns on every rules entity
- `id` PK
- `source_id` FK → rule_source
- `name`, `slug`
- `traits` (array / join to `trait`)
- `data` (JSONB — the structured rules body)
- `legacy` (bool — Legacy vs. Remaster)
- `published_at`

### Entities
`spell`, `feat`, `class`, `ancestry`, `item`, `monster`, `hazard`,
`condition`, `trait`. Each may add type-specific columns, but all follow the
shared shape above so the `core` engine and search treat them uniformly.

**Tradeoff — JSONB `data`:** PF2e content is deeply variable. Storing the
structured body as JSONB (with a Zod schema in `packages/schema`) avoids dozens
of sparse columns while keeping name/traits/source as real, indexable columns
for search and filtering.

---

## 4. Player content (character & companions)

### `character`
- `id` PK
- *`owner_id`* FK → user
- *`campaign_id`* FK → campaign (nullable)
- `name`, `level`
- `build` (JSONB — the raw choices: ancestry, class, boosts, selections)
- `portrait_url`, `token_url`, `banner_url`
- `created_at`, `updated_at`

The **computed sheet is derived**, not stored authoritatively — `packages/core`
computes it from `build`. Optional cached computed snapshot for fast reads.

### `character_feat`, `character_item`, `character_spell` …
Join rows connecting a character to chosen rules/homebrew objects. Each FK may
point at either official content or a `homebrew_object` (resolved via a
`source_kind` discriminator), so the engine handles both identically.

### `character_history`
The **audit + level log** (also the sync conflict record).
- `id` PK · `character_id` FK · `actor_id` FK → user
- `change_type` (level_up, edit, import, bot_edit…)
- `diff` (JSONB) · `created_at`

### `companion`
- `id` PK · *`owner_id`* · `character_id` FK (nullable)
- `companion_type` (animal, familiar, eidolon, mount, custom)
- `build` (JSONB)

---

## 5. Collaboration: campaigns & organizations

### `campaign`
- `id` PK · *`organization_id`* FK (nullable) · *`gm_id`* FK → user
- `name`, `description`, `settings` (JSONB)

### `campaign_member`
- `campaign_id` FK · `user_id` FK · *`role`* (player, co_gm)
- This row is what RLS policies read to authorize campaign data access.

### `campaign_entity`
A unified table (or a small set of typed tables) for GM content owned by a
campaign: NPCs, encounters, journals, loot, quests.
- `id` PK · *`campaign_id`* FK · `entity_type` · `data` (JSONB) · *`visibility`*

### `organization` / `org_member`
West Marches / multi-GM container.
- `organization` : `id` PK · `name` · `discord_guild_id` (nullable)
- `org_member` : `organization_id` FK · `user_id` FK · *`role`* (member, gm, admin)

**Why containers:** campaigns and orgs exist primarily to *scope permissions and
shared content*. RLS policies key off `campaign_member.role` and
`org_member.role`, so granting access is a membership row, not bespoke code.

---

## 6. Homebrew

### `homebrew_object`
Mirrors a rules entity but is user-authored and scoped.
- `id` PK · *`author_id`* FK · *`scope`* (private, campaign, organization, public)
- *`scope_ref_id`* (campaign_id / organization_id when scoped)
- `object_type` (spell, feat, item, monster, …)
- `data` (JSONB — same schema as official content of that type)
- *`moderation_state`* (draft, pending, approved, rejected)

### `homebrew_version`
- `id` PK · `homebrew_object_id` FK · `version` · `data` (JSONB) · `created_at`

### `rating`, `comment`, `moderation_report`
Community signals + moderation queue, all FK → homebrew_object.

**Key invariant:** a `homebrew_object` of type `spell` must validate against the
same Zod schema as an official `spell`, so the rules engine can consume either.

---

## 7. Commerce, API, plugins (future-facing, stubbed early)

### `subscription`
- `id` PK · `user_id` FK · `stripe_customer_id` · `status` · `tier`
- Entitlements gated behind *`user.is_whitelisted`* until launch.

### `api_key`
- `id` PK · *`user_id`* FK · `scopes` (array) · `hashed_key` · `revoked_at`

### `plugin`
- `id` PK · *`author_id`* · `manifest` (JSONB) · *`review_state`*
- Plugins operate only through the scoped public API — never direct DB access.

---

## 8. Scoping & RLS summary

The columns that authorization depends on, in one place:

| Entity | Scope columns RLS reads |
| --- | --- |
| character / companion | `owner_id`, `campaign_id` (+ campaign membership) |
| campaign_entity | `campaign_id` (+ `campaign_member.role`), `visibility` |
| campaign | `gm_id`, `organization_id` (+ membership) |
| homebrew_object | `author_id`, `scope`, `scope_ref_id`, `moderation_state` |
| rules content | public read; write restricted to import pipeline service role |
| api_key / subscription / plugin | `user_id` / `author_id` |

---

## 9. Open questions (future ADRs)

1. **`campaign_entity` — one polymorphic table vs. typed tables per kind?**
   Tradeoff: query simplicity & RLS uniformity vs. type safety & indexing.
2. **Computed sheet caching** — store a materialized snapshot, recompute on
   read, or both with invalidation on `character_history` writes?
3. **Content versioning across Remaster/Legacy** — separate rows vs. a
   `legacy` flag vs. an edition dimension on `rule_source`.
4. **Homebrew ↔ official references** — discriminator column vs. separate join
   tables per source kind.

Each is resolved in its phase's ADR before schema is finalized.
