# `gamedata/aon-raw/` — Raw AoN Snapshots

This folder holds **raw, untransformed** documents pulled from Archives of Nethys's Elasticsearch endpoint. The bot does NOT read these files at runtime — they're a staging area for the sync pipeline.

## Pipeline

```
   Phase 1                  Phase 2 (planned)
   ───────                  ─────────────────
                                                
[ AoN ES ] → [ aon-raw/*.json ] → [ transformers ] → [ ../{spells,feats,...}.json ]
                  this folder                              the bot reads these
```

## How to refresh

```bash
node tools/aon-fetch.js              # fetch every category (~2-3 min)
node tools/aon-fetch.js spell        # just one category
node tools/aon-fetch.js --force      # re-fetch even if already cached
```

The fetcher is gentle (rate-limited) and identifies itself in its User-Agent so AoN's ops team can reach us if there's ever a problem.

## What's here

After a successful run:

| File | Contents |
|---|---|
| `spell.json` | All 1,600+ spells |
| `feat.json` | All feats |
| `creature.json` | All bestiary creatures |
| `equipment.json` | All items |
| `ancestry.json` | All ancestries |
| `archetype.json` | All archetypes |
| `background.json` | All backgrounds |
| `class.json` | All classes |
| `deity.json` | All deities |
| `rules.json` | All rules pages |
| ...and more | (see `tools/aon-fetch.js`) |

Each file is a JSON array of raw AoN documents. Open one and look at the structure — that's exactly what AoN serves.

## What's NOT here

The bot's actual game data lives one folder up at `gamedata/spells.json`, `gamedata/feats.json`, etc. Those files are the result of running transformers over the raw data, plus your homebrew (entries marked `custom: true`). The bot reads only those — never these raw files.

## Don't commit the raw files (probably)

These files are **large** (the spell file alone is megabytes; creatures is bigger) and they can be regenerated anytime by running the fetcher. Adding them to `.gitignore` keeps your repo light.

Recommended `.gitignore` line:
```
gamedata/aon-raw/*.json
```

(But keep this README and the `.gitkeep` so the folder structure is preserved.)