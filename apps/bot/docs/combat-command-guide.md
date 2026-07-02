# Pathway Combat Command Guide

This guide covers the current combat system: `/init`, `/i`, `/m`, and `/mattack`.

Use `/init` for encounter setup and GM management. Use `/i` for player actions. Use `/m` and `/mattack` for monster actions.

## Quick Combat Flow

1. GM starts combat:
   `/init start`

2. Players join:
   `/i join`

3. GM adds monsters:
   `/init addmonster monster:Goblin Warrior count:3 init_mode:shared`

4. Check the tracker:
   `/init view`

5. Run turns:
   `/init next`

6. Players act:
   `/i attack target:Goblin Warrior 1`
   `/i cast spell:Heal target:Hylia`
   `/i save name:fort dc:18`

7. GM runs monsters:
   `/mattack attacker:Goblin Warrior 1 name:dogslicer target:Hylia`
   `/m save monster:Goblin Warrior 1 save:fort dc:18`

8. End combat:
   `/init end`

## Player Commands

### `/i join`

Adds your active character to the current initiative encounter.

Examples:

`/i join`

`/i join character:Hylia`

`/i join result:22`

`/i join bonus:9`

Use `result:` if you already rolled initiative manually.

### `/i attacks`

Shows your available attacks.

Examples:

`/i attacks`

`/i attacks actor:Hylia`

Use this when you are not sure what attack name to use with `/i attack`.

### `/i attack`

Rolls one of your attacks. Works in or out of initiative.

Examples:

`/i attack`

`/i attack target:Goblin Warrior 1`

`/i attack name:Longsword target:Goblin Warrior 1`

`/i attack name:Shortbow target:Goblin Warrior 1 bonus:1`

`/i attack name:Longsword target:Goblin Warrior 1 n:2`

`/i attack name:Dagger target:Goblin Warrior 1 map:1`

Notes:

- If you are in initiative, the bot tries to choose your combatant automatically.
- `target:` can be omitted if there is an obvious opposing target.
- `n:` rolls the same attack multiple times.
- MAP is automatic in initiative. Use `map:` only when you need to override it.
- `map:0` means first attack, `map:1` means second attack, `map:2` means third attack.

### `/i cast`

Casts one of your spells. Works in or out of initiative.

Examples:

`/i cast spell:Electric Arc target:Goblin Warrior 1`

`/i cast spell:Heal target:Hylia level:2`

`/i cast spell:Ignition target:Goblin Warrior 1 bonus:1`

`/i cast spell:Fear target:Goblin Warrior 1 caster:Divine`

Notes:

- `spell:` is the spell name.
- `level:` is the spell rank to cast at.
- `caster:` chooses which spellcasting entry to use if your character has more than one.
- If a spell uses a save and the target has that save recorded, the bot can roll the target save.

### `/i save`

Rolls one of your saves. Works in or out of initiative.

Examples:

`/i save name:fort`

`/i save name:ref dc:19`

`/i save name:will dc:21 bonus:1`

Save names:

- `fort`
- `ref`
- `will`

### `/i skill`

Rolls a skill check. Works in or out of initiative.

Examples:

`/i skill name:Athletics`

`/i skill name:Stealth dc:18`

`/i skill name:Medicine dc:15 bonus:2`

### `/i hp`

Changes your HP. In initiative, it changes your combatant. Out of initiative, it changes your saved character HP.

Examples:

`/i hp change:-7`

`/i hp change:10`

`/i hp set:22`

`/i hp actor:Hylia change:-7`

Use positive numbers to heal and negative numbers for damage.

### `/i thp`

Sets temporary HP for your combatant in initiative.

Examples:

`/i thp amount:5`

`/i thp actor:Hylia amount:8`

### `/i reaction`

Marks your reaction as used.

Examples:

`/i reaction reason:Reactive Strike`

`/i reaction actor:Hylia reason:Shield Block`

Reactions reset when your turn comes around.

### `/i effect`

Shows your active effects.

Examples:

`/i effect`

`/i effect actor:Hylia`

### `/i remove`

Removes your combatant from the encounter.

Examples:

`/i remove`

`/i remove actor:Hylia`

## GM Initiative Commands

### `/init start`

Starts combat in the current channel.

Example:

`/init start`

The person who starts combat becomes the GM for that encounter.

### `/init end`

Ends the current encounter.

Example:

`/init end`

### `/init view`

Shows the combat tracker.

Example:

`/init view`

The tracker is paginated if there are many combatants.

### `/init list`

Shows the current initiative order and HP.

Example:

`/init list`

### `/init next`

Advances to the next turn.

Example:

`/init next`

### `/init prev`

Moves back to the previous turn.

Example:

`/init prev`

### `/init add`

Adds a player, companion, monster, or NPC to initiative.

Examples:

`/init add kind:Player character:Hylia`

`/init add kind:Companion companion:Shadow`

`/init add kind:Monster name:Goblin Warrior count:3 group:Goblin Mob`

`/init add kind:NPC name:Guard hp:18 ac:16 bonus:5`

`/init add kind:NPC name:Guard hp:18 ac:16 result:20`

Useful options:

- `kind:` chooses Player, Companion, Monster, or NPC.
- `name:` is used for monsters and NPCs.
- `companion:` adds a companion.
- `character:` adds a specific character.
- `bonus:` overrides initiative bonus.
- `result:` sets initiative to a specific number.
- `count:` adds multiple copies.
- `group:` puts creatures under a shared group label.
- `hp:` and `ac:` are for custom NPCs.

### `/init addmonster`

Adds a bestiary creature with HP, AC, saves, attacks, and perception pulled from the database.

Examples:

`/init addmonster monster:Goblin Warrior`

`/init addmonster monster:Goblin Warrior count:4`

`/init addmonster monster:Goblin Warrior count:4 init_mode:shared`

`/init addmonster monster:Goblin Warrior count:4 init_mode:per_copy`

`/init addmonster monster:Goblin Warrior hp_mode:varied`

Options:

- `count:` adds multiple copies.
- `init_mode:shared` rolls one initiative for the group.
- `init_mode:per_copy` rolls each copy separately.
- `hp_mode:fixed` uses published HP.
- `hp_mode:varied` varies HP slightly.
- `bonus:` overrides creature initiative bonus.
- `result:` sets initiative directly.

### `/init addnpc`

Adds a custom NPC or monster.

Examples:

`/init addnpc name:Bandit hp:20 ac:17 bonus:6`

`/init addnpc name:Villager hp:8 ac:12 result:14`

### `/init remove`

Removes a combatant.

Examples:

`/init remove name:Goblin Warrior 2`

`/init remove name:Bandit`

Use this for dead enemies, mistakes, or creatures leaving the fight.

### `/init modify`

Changes a combatant's stats.

Examples:

`/init modify name:Goblin Warrior 1 hp:3`

`/init modify name:Goblin Warrior 1 ac:18`

`/init modify name:Goblin Warrior 1 initiative:25`

`/init modify name:Goblin Warrior 1 new_name:Goblin Boss`

`/init modify name:Goblin Warrior 1 hidden:true`

`/init modify name:Goblin Warrior 1 fort:8 ref:10 will:5`

`/init modify name:Skeleton Guard resistances:slashing 5 weaknesses:vitality 5 immunities:poison`

Useful options:

- `hp:` sets current HP.
- `max_hp:` sets maximum HP.
- `ac:` sets AC.
- `initiative:` changes initiative.
- `new_name:` renames the combatant.
- `hidden:` hides or reveals monster stats.
- `fort:`, `ref:`, `will:` set saves.
- `resistances:` use comma text like `fire 5, cold 10, all 2`.
- `weaknesses:` use comma text like `vitality 5, fire 10`.
- `immunities:` use comma text like `poison, paralyzed`.
- `notes:` adds GM notes.

### `/init hp`

Changes HP for any combatant.

Examples:

`/init hp name:Hylia change:-12`

`/init hp name:Hylia change:10`

`/init hp name:Goblin Warrior 1 change:-7`

Positive numbers heal. Negative numbers deal damage.

### `/init thp`

Sets temporary HP for any combatant.

Examples:

`/init thp name:Hylia amount:5`

`/init thp name:Goblin Warrior 1 amount:10`

### `/init effect`

Adds a condition or effect to a combatant.

Examples:

`/init effect target:Goblin Warrior 1 name:Frightened value:1`

`/init effect target:Hylia name:Bless duration:10 attack_bonus:1`

`/init effect target:Goblin Warrior 1 name:Off-Guard duration:1 ac_bonus:-2`

`/init effect target:Hylia name:Custom Buff attack_bonus:1 damage_bonus:2 description:Inspired`

Options:

- `name:` can be a preset condition or a custom effect.
- `value:` is for scaling conditions like Frightened 2.
- `duration:` is rounds.
- `attack_bonus:`, `damage_bonus:`, `ac_bonus:`, `save_bonus:`, and `skill_bonus:` create custom modifiers.
- `description:` adds reminder text.

### `/init conditions`

Lists preset PF2e conditions available for `/init effect`.

Example:

`/init conditions`

### `/init effects`

Shows effects on a combatant.

Example:

`/init effects target:Hylia`

### `/init removeeffect`

Removes an effect from a combatant.

Examples:

`/init removeeffect target:Goblin Warrior 1 name:Frightened`

`/init removeeffect target:Hylia name:Bless`

### `/init move`

Declares that a combatant moved and prompts possible reactions.

Examples:

`/init move name:Hylia`

`/init move name:Goblin Warrior 1`

### `/init reaction`

Prompts a specific combatant to use a reaction.

Examples:

`/init reaction name:Goblin Warrior 1 reason:Reactive Strike`

`/init reaction name:Hylia reason:Shield Block`

### `/init delay`

Delays the current combatant's turn.

Example:

`/init delay`

### `/init rejoin`

Rejoins initiative after delaying.

Examples:

`/init rejoin name:Hylia`

`/init rejoin name:Hylia target:Goblin Warrior 1`

If `target:` is provided, the delayed combatant rejoins just before that combatant.

### `/init dying`

GM command to manually set a dying value.

Examples:

`/init dying name:Hylia value:1`

`/init dying name:Hylia value:0`

Setting dying to 0 stabilizes the dying value, but does not automatically heal HP.

### `/init recovery`

Rolls a recovery check for a dying combatant.

Example:

`/init recovery name:Hylia`

### `/init damage`

Manually rolls persistent damage for a combatant outside the normal turn tick.

Example:

`/init damage name:Hylia`

## Monster Commands

### `/m attacks`

Lists a monster combatant's attacks and spells.

Examples:

`/m attacks monster:Goblin Warrior 1`

`/m attacks monster:Goblin Warrior 1 public:false`

Use this before attacking if you are not sure what the attack is called.

### `/mattack`

Rolls a monster or NPC attack. In initiative, it can use saved/bestiary attacks. Out of initiative, provide manual bonus and damage.

Examples:

`/mattack attacker:Goblin Warrior 1 name:dogslicer target:Hylia`

`/mattack attacker:Goblin Warrior 1 name:shortbow target:Hylia map:1`

`/mattack attacker:Bandit name:Scimitar target:Hylia bonus:8 damage:1d6+4 type:slashing`

`/mattack attacker:Wolf name:Jaws target:Hylia bonus:9 damage:1d8+3 type:piercing agile:false`

Options:

- `attacker:` is the attacking combatant.
- `name:` is the attack name.
- `target:` is the target combatant.
- `bonus:` manually sets attack bonus.
- `damage:` manually sets damage dice.
- `type:` sets damage type.
- `map:` overrides MAP.
- `agile:` uses agile MAP values.

### `/m save`

Rolls a monster save.

Examples:

`/m save monster:Goblin Warrior 1 save:fort`

`/m save monster:Goblin Warrior 1 save:ref dc:19`

`/m save monster:Goblin Warrior 1 save:will dc:21 public:false`

### `/m skill`

Rolls a monster skill.

Examples:

`/m skill monster:Goblin Warrior 1 skill:Stealth`

`/m skill monster:Goblin Warrior 1 skill:Athletics dc:18`

`/m skill monster:Goblin Warrior 1 skill:Stealth dc:20 public:false`

### `/m cast`

Casts a monster spell or spell-like ability.

Examples:

`/m cast monster:Cultist 1 spell:Harm target:Hylia`

`/m cast monster:Cultist 1 spell:Fear target:Hylia dc:19`

`/m cast monster:Cultist 1 spell:Chilling Darkness target:Hylia attack_bonus:12`

`/m cast monster:Cultist 1 spell:Breath Weapon target:Hylia save:ref dc:20 damage:4d6`

Useful options:

- `monster:` is the casting combatant.
- `spell:` is the spell or ability name.
- `target:` is the target combatant.
- `level:` casts at a chosen spell rank.
- `dc:` overrides DC.
- `attack_bonus:` overrides spell attack.
- `damage:` manually provides damage dice.
- `save:` manually sets save type.
- `public:false` makes it GM-only.

### `/m ability`

Uses a monster ability that forces a target save.

Examples:

`/m ability monster:Vampire Spawn 1 name:Vitality Drain target:Hylia save:fort dc:21 damage:4d6 type:void`

`/m ability monster:Dragon 1 name:Breath Weapon target:Hylia save:ref dc:24 damage:8d6 type:fire basic:true`

`/m ability monster:Ghost 1 name:Frightful Moan target:Hylia save:will dc:20 notes:Frightened on failure`

Options:

- `monster:` is the acting combatant.
- `name:` is the ability name.
- `target:` is the target combatant.
- `save:` is Fortitude, Reflex, or Will.
- `dc:` is required.
- `damage:` is optional.
- `type:` is the damage type.
- `basic:` applies basic-save damage scaling.
- `notes:` adds a reminder.
- `public:false` makes it GM-only.

## Companion Commands In Combat

Add a companion:

`/init add kind:Companion companion:Shadow`

Or, if the player controls it:

`/init add kind:Companion companion:Shadow character:Hylia`

Companion attacks use player commands if the companion is owned by the player:

`/i attacks actor:Shadow`

If the companion is the current or only combatant you control, use:

`/i attack target:Goblin Warrior 1`

If the bot cannot infer the companion as the actor, the GM can roll the companion attack with:

`/init attack monster:Shadow target:Goblin Warrior 1`

Companion HP in combat:

`/i hp actor:Shadow change:-6`

`/i hp actor:Shadow change:8`

GM can also adjust companion HP:

`/init hp name:Shadow change:8`

Out of combat companion HP:

`/companion hp companion:Shadow change:8`

`/companion hp companion:Shadow set:20`

## Common GM Examples

Start a simple fight:

`/init start`

`/init addmonster monster:Goblin Warrior count:3 init_mode:shared`

`/init view`

Player joins:

`/i join`

First turn:

`/init next`

Monster attacks:

`/mattack attacker:Goblin Warrior 1 name:dogslicer target:Hylia`

Player attacks:

`/i attack target:Goblin Warrior 1`

Apply frightened:

`/init effect target:Goblin Warrior 1 name:Frightened value:1 duration:1`

Heal a player:

`/init hp name:Hylia change:10`

Remove a defeated monster:

`/init remove name:Goblin Warrior 1`

End the fight:

`/init end`

## Notes And Tips

- Most combatant name fields autocomplete.
- Positive HP changes heal. Negative HP changes damage.
- Monster stats can be hidden from players with `/init modify hidden:true`.
- MAP is tracked automatically during initiative.
- Temporary HP is tracked separately from normal HP.
- If a command needs a target and you omit it, Pathway tries to choose an obvious target.
- If there are multiple possible actors or targets, provide `actor:`, `name:`, `monster:`, or `target:`.
- Use `/i attacks` and `/m attacks` when you do not remember attack names.
- Use `/init conditions` to see condition presets.
- Use `public:false` on monster commands when the GM wants a private roll.
