# Companion Creator — design sketch

> Status: **design sketch, pre-implementation.** Part of Phase W4. Grounded in
> the live bot's companion model so the website and bot stay two views of one
> companion. See the [Roadmap](./roadmap.md) and the
> [Web ⇄ Bot Sync Contract](./web-bot-sync.md).

## Goal

Let a player create **any** companion type — animal companion, eidolon,
familiar, mount, summon, or custom/homebrew — from the website, **assigned to a
character** exactly like the bot does (by `char_key`, with one active companion
per character), each with its own sheet and live two-way sync.

## Backend truth (so web ≡ bot)

Every companion the bot knows lives in **one** `companions` table, keyed by
`(user_id, char_key, comp_key)`. The type-specific detail lives in a few columns
plus a `custom_stats` JSON blob — the same row shape holds an animal companion,
an eidolon, a familiar, or a summon. The website writes this same shape; the
bot's Realtime subscription splices it into its cache. **No new storage tables
are needed.**

| column | meaning |
|---|---|
| `char_key` | **the assignment** — which character owns the companion |
| `comp_key` | companion slug, unique per character |
| `display_name` | player-facing name |
| `base_type` | catalog type slug, or `'custom'` for homebrew |
| `form` | maturity / variant (`young` / `mature` / `nimble` / `savage`, or the eidolon/familiar equivalent) |
| `current_hp`, `notes` | live state |
| `is_active` | the character's currently-active companion (exactly one) |
| `custom_stats` (jsonb) | `{ customStats, art, skills, customAbilities, customAttacks, overrides }` |

## "Scan all types" — a federated catalog search

Companions are not one system in PF2e, so the type picker searches **several
sourced catalogs**, each result tagged with its system category:

- **Animal companions & mounts** → Supabase `gamedata` (category `companions`) —
  the bot's existing companion catalog, already grouped by creature category.
  The web reads `gamedata` the same way it reads classes.
- **Summons** → the `monsters` / bestiary table (a summon *is* a stat-blocked
  creature); the web already queries this for the Rules Library.
- **Eidolons / familiars** → source to be confirmed (gamedata? class features? a
  familiar-ability list?). Familiars are ability-lists, not stat blocks — a
  different shape. **Open question below.**
- **Custom / homebrew** → free-form, stored as `base_type: 'custom'` with
  `custom_stats`, mirroring the bot's `custom:true` path.

One search box; results labelled by type; the pick writes into the single
`companions` table.

## UX flow

The **Companions tab** (today a "Coming Soon" placeholder) becomes the home:

- List the character's companions read from `companions` (not just
  build-imported pets), each with an **⭐ active** toggle.
- **"+ Create a Companion"** opens the creator: (1) search/pick a type across
  catalogs *or* go custom, (2) name it and choose form/level, (3) it is assigned
  to this character and can be set active.
- Each companion gets a **sheet** (stat block, attacks, abilities, HP, notes)
  built from the catalog entry plus `custom_stats`, with inline edits (HP, notes,
  custom attacks/abilities) like the character sheet.
- Mirror the bot's verbs: add, set-active / swap, edit, remove.

## Sync & safety

- Per-row upsert / delete on `companions` keyed by `(user_id, char_key,
  comp_key)` — the same anti-clobber discipline as notes / downtime / bags.
  Setting one companion active clears the others in a single write.
- Realtime subscription on `companions` (filter `char_key`) so bot-side changes
  appear live.
- Same owner-RLS assumption as the other W4 writes on `bags` / `character_notes`
  / `downtime`.

## Rules-from-source flag

Companion **stat scaling** (animal-companion form progression, eidolon
evolution) is real PF2e rules. The bot already has a `scaleCompanion()`. Per the
project's non-negotiable rules-from-source rule, the website must **not**
reimplement it from memory — the clean move is to lift that scaling into
`packages/core` (as was done for proficiency progression) so the bot and web
share one implementation. A v1 can instead display the catalog's sourced stats
and store manual overrides, deferring scaling.

## Open questions

1. **Eidolon & familiar sources** — are their options in `gamedata`, or is a
   separate catalog needed? Familiars especially are ability-lists, not stat
   blocks.
2. **Summons scope** — allow picking any bestiary creature as a summon, or a
   curated summon list for v1?
3. **Scaling** — lift `scaleCompanion` into `packages/core` now, or v1 =
   store-and-display catalog stats + manual overrides?
4. **Companion-sheet depth** — full editable stat block, or start with identity +
   HP + notes + active-toggle and grow it?

## Recommended phasing

- **C1 — Assignment + list + active** *(small)*: read `companions` for the
  character, show them, set active, remove. Immediately makes the tab real and
  two-way.
- **C2 — Creator (animal companions + custom)**: the type picker over `gamedata`
  companions plus custom entry; write + assign.
- **C3 — Broaden the scan**: summons (bestiary) and eidolons / familiars once
  their sources are confirmed.
- **C4 — Companion-sheet depth + shared scaling** in `packages/core`.

Build **C1 first** — it is the "assign like the bot" core and unblocks the tab —
and resolve the four open questions before C2 / C3.
