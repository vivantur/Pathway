# Roadmap

> Status: **Revised after reading the live bot.** Re-sequenced around the real
> situation: the Discord bot and its Supabase backend already exist; the website
> is a new client that must join them and stay in sync.

The earlier draft sequenced phases as if the whole platform were greenfield
(rules library → character engine → *then build the bot*). That ordering is
wrong: the bot is **done and in production**, and the database already holds
characters, content, and play state. So the website's phases are labeled **W**
(web) and are ordered around *connecting to and conforming with the existing
backend first*, then expanding feature coverage.

Per the [Master Specification](../../PATHWAY_MASTER_SPEC.md), each phase still
moves through **Design → Review → Approve → Build → Test → Refactor → Release**,
with a gate before the next phase.

> **Current status:** W0–W3 complete (foundations, identity, live sync,
> character vault + builder). **W4 (companions, editable inventory/notes) is
> next.** W5 (rules library) is partially shipped — searchable archive + monster
> stat blocks are live; traits, full-text search, and homebrew authoring remain.

---

## Phase W0 — Reconcile with the live backend *(do this first)*

No user features. Establish the truth and the wiring.

- Confirm `pathway-website` **is** the bot's `web/` repo; adopt
  `supabase/migrations/` here as the canonical schema home.
- **Back-fill already-applied migrations** into this repo (the `20260524*`
  Realtime set, `align_user_ids_with_auth`, `active_character`,
  `character_xp_log`, the homebrew/draft catch-ups) so schema history is tracked.
- Introspect the **develop** project to pin exact column inventories/types for
  every table in [data-model.md](./data-model.md); fix any *(inferred)* notes.
- Stand up `apps/web` (Vite + React + TS + Tailwind) that boots and connects to
  Supabase **develop** with the **anon key** under RLS.

**Gate to W1:** the web app authenticates a user against develop and reads one of
*their own* `characters` rows through RLS — no service key in the browser.

---

## Phase W1 — Identity unification

Make a web login and a Discord user the **same `users` row**.

- Decide & implement Discord ⇄ web identity (ADR): Discord as a Supabase Auth
  provider (recommended) and/or an explicit link flow writing `users.discord_id`.
- Guarantee `users.id = auth.uid()` and never double-create a user.

**Gate to W2:** a user who exists in the bot can log into the website and land on
*their* account, and a brand-new web user can link Discord and be seen by the bot.

---

## Phase W2 — Character read + live sync (the core of "in sync")

The flagship sync milestone.

- Read & render a character from `pathbuilder_data` (sheet view).
- **Subscribe to Realtime** on `characters` (+ `character_xp_log`) so bot-side HP/
  XP/condition changes appear live, with the `updated_at` freshness check.
- Write-path correctness: live state to columns, build to `pathbuilder_data`,
  `overlay` read-modify-written, `updated_at` always stamped (add DB triggers).

**Gate to W3:** a character edited in Discord updates live on the website and
vice-versa, with no clobbering in either direction. This satisfies the
[sync "definition of done"](./web-bot-sync.md#8-definition-of-done-for-in-sync).

---

## Phase W3 — Character builder / editor (write-heavy) — ✅ complete

- ✅ Guided step-by-step builder with Beginner Mode, tooltips, and
  auto-calculation, producing valid `pathbuilder_data` (`features/builder`).
- ✅ Save / level-up / edit straight into the vault (`useSaveBuild` →
  `createCharacterFromBuild` / `updateCharacterFromBuild`); the bot reads the
  stored build back (`stored?.build ?? stored`).
- ✅ Variant rules from creation: Free Archetype, Automatic Bonus Progression,
  Ancestry Paragon, Gradual Ability Boosts.
- ✅ Level-accurate proficiency for saves, Perception, class DC, spell DC, and
  AC — driven by the class progression table now living in `packages/core`
  (`proficiencyRankAtLevel`), the builder being core's first consumer.
- ✅ Portraits via Supabase Storage; Pathbuilder JSON + PDF sheet export.

**Gate to W4 — met:** a user builds/levels/exports a character on the web whose
`pathbuilder_data` the bot reads back correctly (standard Pathbuilder shape).

_Remaining polish (tracked, not blocking): a distinct "Learning Mode", PDF
export directly from the builder (currently from the saved sheet), and
weapon-attack proficiency progression (deferred — it is weapon-group/choice
scoped; see `packages/core/src/proficiency.ts`)._

---

## Phase W4 — Companions, inventory, downtime, notes

Surface the rest of the per-character state the bot already stores.

- `companions`, `bags`/`bag_items`, `downtime`, `character_notes`, snippets —
  read, edit, and live-sync each, honoring its table's shape and invariants.

**Gate to W5:** all per-character state is editable on web and stays in sync.

---

## Phase W5 — Rules & homebrew browser

- Browse/search `monsters`, `spells`, `items`, `gamedata`, and `homebrew_entries`
  with the grimoire UI.
- Homebrew authoring writes `homebrew_entries` in the shape the bot splices live.

**Gate to W6:** the website is a usable rules/homebrew reference matching the bot.

---

## Phase W6 — Campaigns, encounters, guild/server features

- Combat tracker / encounter views over `encounters`/`encounter_events`.
- Guild-scoped content (`guild_state`, `guild_snippets`, monster overlays).
- Campaign/GM organization features per the master spec, layered on the above.

**Gate to W7:** GMs can run server-side content from the website in step with
the bot.

---

## Phase W7+ — Platform & future

Sequenced after parity and proven sync:

- Community Library / Marketplace.
- Public API hardening + scoped API keys; plugin framework (API-only).
- Payments (Stripe-ready) gated behind the whitelist flag.
- Offline character sheets (local cache + reconcile).
- Localization beyond `en`.
- (If/when worthwhile) extract shared PF2e rules logic from the bot into a
  package both clients consume.

---

## Sequencing rationale

- **Why reconcile (W0) before any feature:** writing the wrong column shape or a
  migration that breaks an invariant would desync or even corrupt live bot data.
  Get the schema truth and safe wiring first.
- **Why identity (W1) before character sync (W2):** syncing the wrong user's row
  is worse than not syncing. The accounts must be one before the data can be one.
- **Why the bot is *not* a build phase:** it already exists. The roadmap's job is
  to bring the website up to it, not to rebuild it.

Phase boundaries are gates, not deadlines. We never rush — and we never ship a
change that could clobber live bot data.
