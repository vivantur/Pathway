# Supabase Data Utilities

This directory is for Supabase-backed data and import helpers.

`gamedata/` is legacy/deprecated for new database content. New homebrew entries
should be imported into Supabase so Railway redeploys do not wipe them.

## Homebrew Items

Put item catalog JSON in `supabase/homebrew-items.json`, then run:

```powershell
node supabase/import-homebrew-items.js
```

The importer writes rows to the existing `homebrew_entries` table with:

- `type = "item"`
- `entry_key = item slug`
- `name = item name`
- `data = bot item JSON`

On bot startup, the existing Supabase restore flow splices those rows into the
live item database automatically.
