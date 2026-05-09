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

## Calendar And Weather Rules

`calendar-rules/` and `weather-rules/` hold the fallback rule documents used by
the bot if Supabase is missing the `calendar_rules` or `weather_rules` rows.
Run this to upsert them into the Supabase `gamedata` table:

```powershell
node supabase/import-calendar-weather-rules.js
```
