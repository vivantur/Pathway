# PF2e Content — Dedupe & Remaster Refresh Runbook

A safe, step-by-step way to **review, dedupe, and refresh** the bot's PF2e content
in Supabase. Written to be run by hand, cautiously. **Do every step on the
`develop` project first, and only touch `prod` once develop looks right.**

Supabase project ids (from `apps/bot/CLAUDE.md`):
- **develop** — `nqnswvuqszpkntnjzomv`  ← do everything here first
- **prod** — `cmmwirlrvqmjqbydlqks`

## What can and can't duplicate (why this runbook focuses on spells)

| Table | How import de-dupes | Can accumulate dupes? |
|-------|--------------------|-----------------------|
| `spells` | match on `aon_id › name+source › name`, then update/insert | **Yes** — an identity miss inserts a 2nd row; legacy+remaster same-name spells collide |
| `monsters` | delete official slice, then re-insert | No for official rows, but the delete+insert is **not atomic** (back up first) |
| `homebrew_entries` (items) | true upsert on `(type, entry_key)` | No |
| `gamedata` | true upsert on `(category, slug)` | No |

So the dedupe work is really about **`spells`**. Monsters are fixed by a careful
re-import; items/gamedata can't duplicate.

---

## Step 0 — Set up local access (one time)

The dedupe script reads your Supabase credentials from a `.env` file. Create
`apps/bot/.env` with your **develop** project's values:

```
SUPABASE_URL=https://nqnswvuqszpkntnjzomv.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<develop service_role key>
```

Get these from the Supabase dashboard → your **develop** project → **Settings →
API** (`Project URL` and the `service_role` secret). `.env` is git-ignored — never
commit it. To later run against prod, swap these two values for the prod project's.

## Step 1 — Back up (always, before any change)

In the Supabase dashboard → **SQL Editor**, run:

```sql
create table if not exists spells_backup_20260702           as select * from spells;
create table if not exists monsters_backup_20260702         as select * from monsters;
create table if not exists homebrew_entries_backup_20260702 as select * from homebrew_entries;
create table if not exists gamedata_backup_20260702         as select * from gamedata;
```

(Change the date suffix each time.) If anything goes wrong you can restore with
`insert into spells select * from spells_backup_...` after truncating.

## Step 2 — Dry-run report (read-only, safe)

```
node apps/bot/supabase/dedupe-content.js
```

This writes **nothing**. It prints:
- how many spell rows exist, and **exact-identity duplicate groups** (safe to merge),
- **same-name / different-identity** spells (possible legacy+remaster pairs — need your judgement),
- how many spells still carry the removed-in-Remaster **`school`** field or a **legacy damage type**,
- monster sanity checks (official rows that would escape the refresh delete, official name duplicates).

Read these numbers before doing anything else. If "exact-identity duplicate
groups" is 0, you have no safe-to-auto-remove spell dupes.

## Step 3 — (Optional) Refresh content from source

Only if you want to pull fresh AoN content. From `apps/bot/`:

```
node tools/aon-fetch.js spell --force        # re-fetch raw AoN spell data
node tools/aon-transform-spells.js           # transform → gamedata/spells.json
node supabase/import-aon-spells.js --dry-run  # preview: "will update N, insert M"
node supabase/import-aon-spells.js --replace-official   # apply (upserts, preserves ids)
```

For monsters, **because the import deletes-then-inserts non-atomically**, back up
first (Step 1), run during low traffic, and if the insert half errors, restore
`monsters` from the backup rather than re-running blind:

```
node tools/aon-fetch.js creature --force && node tools/aon-transform-creatures.js
node supabase/import-aon-bestiary.js --dry-run
node supabase/import-aon-bestiary.js --replace-official
```

> A rising `insert N` count across repeated spell dry-runs is the tell-tale sign
> of identity misses producing duplicates — that's what Step 4 cleans up.

## Step 4 — Dedupe spells (destructive — three safety tiers)

All on **develop**, after a backup.

```
node apps/bot/supabase/dedupe-content.js --apply         # prints the deletion PLAN, writes nothing
node apps/bot/supabase/dedupe-content.js --apply --yes   # actually deletes the duplicate rows
```

- It only deletes **exact-identity** duplicates (same `aon_id`, or same
  `name`+`source`), keeping the best row in each group (prefers one with an
  `aon_id`, then the newest import).
- It **never** deletes the "same-name / different-identity" pairs — review those
  by hand (they may be a legacy vs remaster version of the same spell; keep the
  remaster one).

## Step 5 — (Optional) Remaster-clean the spell data

The bot's *display* no longer shows `school` or legacy damage types (fixed in
code), so this is data hygiene, not required for correct output. On develop, in
the SQL Editor — **inspect the JSON shape first** (the dry-run report tells you how
many rows are affected):

```sql
-- Drop the removed-in-Remaster magic school from spell metadata:
update spells set spell_metadata = spell_metadata - 'school'
where spell_metadata ? 'school';

-- Normalize legacy damage types (verify the JSON path matches your data first):
update spells set spell_metadata = jsonb_set(spell_metadata, '{damage,type}', '"vitality"')
where spell_metadata->'damage'->>'type' = 'positive';
update spells set spell_metadata = jsonb_set(spell_metadata, '{damage,type}', '"void"')
where spell_metadata->'damage'->>'type' = 'negative';
```

Deity `alignment` (also removed in Remaster) is already ignored by the bot's
deity embed, so it's harmless; null it only if you want strictly-clean data, and
only after confirming which table/column holds deities.

## Step 6 — Verify, then repeat on prod

1. Re-run the dry-run report (Step 2) — duplicate groups should now be 0.
2. Test the bot against develop: `/spell`, `/cast`, `/monster` a few entries.
3. When develop looks right, repeat Steps 1–5 against **prod** (swap the `.env`
   values to the prod project, back up prod first).

---

### Known follow-up (code, not data)

To stop *future* imports from re-introducing legacy content, the transform
pipeline could be updated to prefer Remaster entries and normalize/drop
`school`, `alignment`, and `positive/negative` damage at write time
(`tools/aon-transform-spells.js`, `tools/aon-transform-misc.js`). That needs the
raw AoN dumps to test against — ask Claude to do it when you're ready to
re-import.
