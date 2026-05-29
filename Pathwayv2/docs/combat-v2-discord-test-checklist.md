# Combat V2 Discord Test Checklist

Use this before removing legacy combat handlers or merging combat v2 into `main`.

## Deploy

1. Deploy commands from this branch.
2. Confirm Discord shows `/init`, `/i`, `/m`, and `/mattack`.
3. Start a test encounter with `/init start`.

## Initiative

1. Add a player with `/i join`.
2. Add a monster with `/init add kind:Monster name:<creature>`.
3. Add multiple monsters with `/init add kind:Monster count:3 group:<label>`.
4. Add an NPC with `/init add kind:NPC name:<name> hp:<hp> ac:<ac>`.
5. Confirm `/init view`, `/init next`, `/init prev`, `/init delay`, and `/init rejoin` behave correctly.

## Player Actions

1. `/i attacks`
2. `/i attack target:<monster>`
3. `/i save name:fort dc:<dc>`
4. `/i skill name:Athletics dc:<dc>`
5. `/i cast spell:<spell> target:<monster>`
6. `/i hp change:-5`, `/i hp change:5`, `/i hp set:<value>`
7. `/i thp amount:<value>`
8. `/i reaction reason:<reaction name>`
9. `/i effect`
10. `/i remove`

## Monster Actions

1. `/m attacks monster:<monster>`
2. `/mattack attacker:<monster> name:<attack> target:<player>`
3. `/m save monster:<monster> save:fort dc:<dc>`
4. `/m skill monster:<monster> skill:Stealth dc:<dc>`
5. `/m cast monster:<monster> spell:<spell> target:<player>`
6. `/m ability monster:<monster> name:<ability> target:<player> save:fort dc:<dc> damage:<dice> type:<type> notes:<effect>`

## GM Management

1. `/init hp name:<combatant> change:<amount>`
2. `/init thp name:<combatant> amount:<amount>`
3. `/init effect target:<combatant> name:Frightened value:1`
4. `/init removeeffect target:<combatant> name:Frightened`
5. `/init effects target:<combatant>`
6. `/init modify name:<combatant> ac:<value> hidden:true`
7. `/init modify name:<combatant> resistances:"fire 5" weaknesses:"vitality 5" immunities:"poison"`
8. `/init remove name:<combatant>`

## Pass Criteria

- No command returns "application did not respond".
- Summary embed stays pinned and updates after HP, turn, add, remove, and effect changes.
- Player-facing views hide monster HP/AC when `hidden:true`.
- GM can still see enough details to run the fight.
- Damage applies temp HP, resistance, weakness, and immunity correctly.
- MAP increments on repeated attacks and resets on turn change.
