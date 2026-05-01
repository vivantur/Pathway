# Combat V2 Plan

Goal: replace the legacy combat commands with an Avrae-style PF2e combat workflow that works both inside and outside initiative.

## Command Surface

### Initiative
- `/init start`
- `/init end`
- `/init next`
- `/init prev`
- `/init view`
- `/init add kind:<pc|monster|npc|companion> name:<name> initiative:<count> count:<n> group:<name>`

### Player and Initiative Actions
- `/i join`
- `/i attack`
- `/i cast`
- `/i skill`
- `/i save`
- `/i hp`
- `/i thp`
- `/i effect`
- `/i remove`
- `/i attacks`

### Monster/NPC Actions
- `/mattack`
- `/m save`
- `/m skill`
- `/m cast`
- `/m attacks`

## Engine Requirements

- PCs, monsters, NPCs, and companions use one combatant model.
- Combatants can have grouped initiative for hordes, swarms, and duplicate monsters.
- Monster HP and stat details are hidden from players by default.
- GM gets private details for monster adds and hidden stat views.
- Effects support durations and stat modifiers.
- HP changes work in and out of combat.
- Temporary HP is tracked separately.
- Resistances, weaknesses, and immunities are applied during damage.
- MAP is tracked per combatant per turn.
- Save-based abilities use the same resolver as attacks.
- Attack lists are available before rolling.
- The combat embed is pinned, paginated at five combatants per page, and button-flippable.

## Migration Order

1. Add the isolated v2 state, roll, and render modules.
2. Wire `/init start/end/view/next/prev`.
3. Wire `/init add` for PCs, monsters, NPCs, companions, duplicate monsters, and grouped initiative.
4. Wire `/i attack`, `/i save`, `/i skill`, `/i cast`.
5. Wire monster commands: `/mattack`, `/m save`, `/m skill`, `/m cast`, `/m attacks`.
6. Wire HP, temp HP, effects, remove, and modify commands.
7. Replace legacy deploy command definitions.
8. Remove or archive legacy combat handlers after parity testing.
