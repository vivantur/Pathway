# Strikes & Weapons — Design

*Plan of record for the Strike model, weapons, runes, and the multiple attack
penalty. Split out of `effects-engine-design.md` (which is 120KB+ and no longer
readable end to end); that doc remains the plan of record for the effects engine
itself and links here.*

Started 2026-07-19. Status markers are maintained the same way as the main doc —
if you change one, re-verify it against the code first.

---

## What this is

`attack` and `damage` were in core's selector vocabulary but **returned 0** —
marked *reserved* in `selectors.ts` because they are per-strike and the resolved
model carries one number per selector. Nothing in the engine could modify an
attack or damage roll.

### ⚠️ What this does NOT unlock — measured, not assumed (2026-07-19)

This work was initially scoped as "the largest single ingest-coverage unlock in
the corpus." **That was wrong, and the measurement is recorded here so nobody
re-derives the wrong expectation.**

Landing the scoped selector vocabulary moved ingest coverage from 717 to **720**
mapped elements. Three. The reason:

| of the 417 attack/damage-selector elements | count |
|---|---|
| carrying a Foundry **predicate** (→ `needs-combat-tags`, which fires first) | **374 (90%)** |
| `FlatModifier` at all | 109 |
| `FlatModifier` **and** unconditional — the entire addressable set | **11** |

The same holds for the item model. Of the 1,446 `needs-item-model` elements,
**1,220 (84%) also carry a predicate.** So a complete Strike + item model, on its
own, reaches at most the 226 unconditional ones.

**The real gate on attack/damage content is the predicate/combat-tag model, not
the selector vocabulary and not the item model.** Most attack content is
conditional by nature — "when you're flanking", "against a target you've already
hit this turn". `needs-combat-tags` is the largest bucket (1,779) and it
*multiplies* with this one rather than being independent of it.

### Why do this work anyway

Ingest coverage is not the point, and it is not what the owner's three goals
measure. This work is what makes the product function:

- **The character sheet can show attacks at all**, computed by the one engine.
- **`/use` can execute a real Strike** — currently impossible.
- **Non-weapon attacks become expressible** — Elemental Blast, unarmed, custom
  builder attacks (see the slot design below). This was the originating question.
- **It ends a live duplication**: the web app already computes weapon attack and
  damage independently (below), which is the exact bug class CLAUDE.md's one rule
  exists to prevent.

It also unblocks things named elsewhere as blocked:
- **Enfeebled and Clumsy in the bot** — `apps/bot/CLAUDE.md` records these as
  blocked on "scoped attack/damage selectors". Step 1 alone fixes that.
- **Goal 1's *actions* half** — a feat that grants a strike is the common shape.
- **Goal 3's spell damage** — the same damage-component pipeline.

### This is a consolidation, not a greenfield build

`apps/web/src/features/builder/rules.ts` (~L992–1060) **already computes weapon
attack and damage**, including potency/striking runes, ABP, Weapon
Specialization, finesse, propulsive, and thrown. `EquippedWeapon` (L711) is a
working strike model in all but name.

Per CLAUDE.md's one rule, that is already the duplication this repo is organized
to prevent — it is invisible only because nothing else computes attacks yet. The
port should move that math **unchanged** (it is verified against the sheet and
locked by web tests), not re-derive it.

Two spot-checks confirming the existing web math matches the rules text below:
- potency feeds only `itemBonus` on the attack roll; `damageMod` never sees it ✅
- `dice: 1 + striking` → striking 2 dice, greater 3, major 4 ✅

---

## The design: a strike is a slot pipeline, and a weapon is one provider

**`Strike` is the primitive. A weapon is one *producer* of strikes.**

This is the load-bearing decision. If we build `Weapon → attack number` and
generalize later, weapon assumptions get baked into core's type — striking runes
as *the* dice-count source, weapon groups, str/dex finesse — and unpicking them
later is a rewrite.

Instead a strike resolves through **named slots**, each of which accepts a
higher-priority provider:

```
traits      ← weapon traits + additional traits
              (resolved FIRST — agile/finesse/propulsive/deadly/fatal feed
               every slot below)
ability     ← trait-driven default (finesse→max(str,dex), ranged→dex, else str)
              ⟵ source declaration (Kineticist blast: con)  ⟵ user override
rank        ← weapon category proficiency  ⟵ proficiency override
itemBonus   ← potency (+1/+2/+3)  ⟵ ABP  ⟵ override
diceCount   ← 1  ⟵ striking (2/3/4)  ⟵ ABP  ⟵ source scaling rule
diceSize    ← weapon die  ⟵ increase-dice  ⟵ source scaling rule
damageBonus ← per-trait ability rules + weapon specialization + custom rows
```

### Why this shape

**Non-weapon attacks need no special case.** Kineticist Elemental Blast is a
`StrikeSource` that populates `ability=con`, `rank` from class proficiency, and a
scaling rule that sets count/size directly instead of reading runes. A homebrew
attack from the builder is the same thing with user-supplied slots. "Custom
attack not tied to a weapon" stops being a feature and becomes *the absence of a
weapon provider*.

**Pathbuilder's override fields and a source's own declarations are the same
mechanism.** Its attack editor exposes Attack (ability), Attack Override, Damage
Override, Proficiency Override, Increase Dice, Additional traits, and a repeating
damage-bonus row builder. Those are not ten features — they are one feature seen
from the user side. Matching Pathbuilder's capability is therefore not extra
work; it falls out of the pipeline.

**Dice is `{count, size}`, not a count.** Striking sets count; increase-dice
steps size; they are independent contributors to different fields. A single
"number of dice" model cannot hold this.

### The output is directly executable

A resolved strike emits:

```
{ attackBonus: number + per-slot provenance,
  damage: DamageComponent[] }
```

`DamageComponent` is **already** core's type (`automation.ts`). So a Strike is
directly runnable by the existing Layer 2 interpreter via an `attack` node plus a
`damage` node — **no new interpreter surface, no adapter.** Everything downstream
(the bot's `/use`, combat targeting, the web execution surface when it exists)
works on strikes the day they land.

Pathbuilder's header display — `Dex Prof Item / 1 4 0` — confirms the strike must
carry **per-slot provenance**, not just a total. `EffectProvenance` already exists
in the web for other stats; follow that pattern.

---

## Rules text (owner-supplied — implement ONLY from this)

Per the rules-from-source rule, everything below is quoted from text supplied in
the prompt or fetched from the cited source. Do not extend it from memory.

### Multiple Attack Penalty — *Player Core p. 402*

> The more attacks you make beyond your first in a single turn, the less accurate
> you become... The second time you use an attack action during your turn, you
> take a –5 penalty to your check. The third time you attack, and on any
> subsequent attacks, you take a –10 penalty to your check. **Every check that has
> the attack trait counts toward your multiple attack penalty, including Strikes,
> spell attack rolls, certain skill actions like Shove, and many others.**
>
> Some weapons and abilities reduce multiple attack penalties, such as agile
> weapons, which reduce these penalties to –4 on the second attack or –8 on
> further attacks.

| Attack | MAP | Agile |
|---|---|---|
| First | None | None |
| Second | −5 | −4 |
| Third and subsequent | −10 | −8 |

> **Always calculate your multiple attack penalty based on the weapon you're using
> on that attack, not ones you used on previous attacks.** For example... you're
> wielding a longsword in one hand and a shortsword (which has the agile trait) in
> your other hand, and you make three Strikes with these weapons over the course of
> your turn. The first Strike... has no penalty... The second Strike will take
> either a –5 penalty if you use the longsword or a –4 penalty if you use the
> shortsword. Your third attack would be a –10 penalty with the longsword and a –8
> penalty with the shortsword, no matter which weapon you used for your previous
> Strikes.
>
> The multiple attack penalty **applies only during your turn**, so you don't have
> to keep track of it if you can perform a Reactive Strike or a similar reaction
> that lets you make a Strike on someone else's turn.

### Runes

**Striking** (damage dice count):
- Striking — two weapon damage dice
- Greater Striking — three weapon damage dice
- Major Striking — four weapon damage dice

**Potency** (**attack rolls only — NOT damage**):
- Weapon Potency (+1/+2/+3) — a +1/+2/+3 **item** bonus

### Increase Dice

Moves the damage die up one step: **d4 → d6 → d8 → d10 → d12**. No effect on an
existing d12.

### Large weapons

> In Pathfinder 2E, Small or Medium creatures can wield a Large weapon, but it is
> considered unwieldy, giving them the clumsy 1 condition. This means they can use
> it, but with some difficulty, and it won't provide any special benefits.

A Large or larger creature uses a Large weapon normally — this only penalises
smaller wielders. **This is a wielder property, not a dice modifier.**

**A Large weapon confers NO BENEFIT WHATSOEVER** (owner clarification,
2026-07-19), not even to a Large creature. "It won't provide any special
benefits" is a complete statement, not a vague one: the entire mechanical effect
of the Large trait is clumsy 1 on a Small or Medium wielder, and nothing else.

This matters because the obvious implementation is wrong in both directions.
Pathbuilder's attack editor puts a "Large Weapon" checkbox directly beside
"Increase Dice", which invites modelling it as a damage-die step — it is not one.
Nor does being Large "unlock" anything. A Large weapon is strictly a downside or
a no-op.

### Deadly

> On a critical hit, the weapon adds a weapon damage die of the listed size. **Roll
> this after doubling the weapon's damage.** This increases to two dice if the
> weapon has a greater striking rune and three dice if the weapon has a major
> striking rune. For instance, a rapier with a greater striking rune deals 2d8
> extra piercing damage on a critical hit. **An ability that changes the size of
> the weapon's normal damage dice doesn't change the size of its deadly die.**

Worked example (owner-confirmed 2026-07-19), d6 weapon with deadly d10:
- Hit: `d6 + mod`
- Crit: `(d6 + mod) × 2 + d10`

**The deadly die is NOT doubled.** (An earlier worked example in the thread
doubled it; the owner confirmed the text's reading is correct. At +4 mod the
difference is 30 vs 20 average, so this is not cosmetic.)

Deadly die **count** keys off striking rank: 1 normally, 2 at greater striking, 3
at major striking. Note plain striking gives no increase.

### Fatal

> The fatal trait includes a die size. On a critical hit, the weapon's damage die
> increases to that die size instead of the normal die size, and the weapon adds
> one additional damage die of the listed size.

Worked example (owner-supplied), d6 weapon with fatal d10:
- Hit: `d6 + mod`
- Crit: `(2d10 + mod) × 2`

**Fatal happens INSIDE the doubling; deadly happens OUTSIDE it.** Encode that
asymmetry explicitly — it is the single easiest thing here to get wrong.

### Agile

The MAP values above are agile's **entire** mechanical effect on its own.

### Critical specialization — *2e.aonprd.com/WeaponGroups.aspx*

| Group | Effect |
|---|---|
| Axe | Choose one creature adjacent to the initial target and within reach. If its AC is lower than your attack roll result for the critical hit, you deal damage to that creature equal to the result of the weapon damage die you rolled (including extra dice for its striking rune, if any). This amount isn't doubled, and no bonuses or other additional dice apply to this damage. |
| Bomb | Increase the radius of the bomb's splash damage (if any) to 10 feet. |
| Bow | If the target of the critical hit is adjacent to a surface, it gets stuck to that surface by the missile. The target is immobilized and must spend an Interact action to attempt a DC 10 Athletics check to pull the missile free; it can't move from its space until it succeeds. The creature doesn't become stuck if it is incorporeal, is liquid, or could otherwise escape without effort. |
| Brawling | The target must succeed at a Fortitude save against your class DC or be slowed 1 until the end of your next turn. |
| Club | You knock the target away from you up to 10 feet (you choose the distance). This is forced movement. |
| Crossbow | The target takes 1d8 persistent bleed damage. You gain an item bonus to this bleed damage equal to the weapon's item bonus to attack rolls. |
| Dart | The target takes 1d6 persistent bleed damage. You gain an item bonus to this bleed damage equal to the weapon's item bonus to attack rolls. |
| Firearm | The target must succeed at a Fortitude save against your class DC or be stunned 1. |
| Flail | The target is knocked prone unless they succeed at a Reflex save against your class DC. |
| Hammer | The target is knocked prone unless they succeed at a Fortitude save against your class DC. |
| Knife | The target takes 1d6 persistent bleed damage. You gain an item bonus to this bleed damage equal to the weapon's item bonus to attack rolls. |
| Pick | The weapon viciously pierces the target, who takes 2 additional damage per weapon damage die. |
| Polearm | The target is moved 5 feet in a direction of your choice. This is forced movement. |
| Shield | You knock the target back from you 5 feet. This is forced movement. |
| Sling | The target must succeed at a Fortitude save against your class DC or be stunned 1. |
| Spear | The weapon pierces the target, weakening its attacks. The target is clumsy 1 until the start of your next turn. |
| Sword | The target is made off-balance by your attack, becoming off-guard until the start of your next turn. |

**Crit spec effects are automation subtrees, not modifiers.** They are saves vs
class DC, conditions, persistent damage, and forced movement — i.e. they slot
into the `attack` node's existing `criticalSuccess` branch. This needs **no new
engine surface**; it is authored content.

---

## MAP: three things that are easy to get wrong

**1. MAP is not a Strike concept.** "Every check that has the attack trait counts
toward" — Strikes, spell attack rolls, *and* skill actions like Shove. So MAP is a
**turn-scoped counter over attack-trait checks**, living on the execution context,
not on `ResolvedCharacter`. Any node carrying the attack trait increments it,
which means the attack trait must be expressible on automation nodes.

**2. Store the COUNT, never the penalty.** The longsword/shortsword example is
explicit: the third attack is −10 with the longsword or −8 with the shortsword
*regardless of what was swung before*. So the context holds
`attackTraitChecksThisTurn`, and each strike derives its own penalty from that
count plus **its own** agile trait. Any design caching "current MAP = −5" is
wrong, and wrong in a way that only surfaces in mixed-weapon turns. That example
is encoded directly as a test.

**3. Turn-scoped; off-turn attacks are outside it entirely.** A Reactive Strike
neither consults nor increments the counter. That is a flag on the invocation, not
on the strike.

**Leave room for feature interaction.** Owner note 2026-07-19: features beyond
agile will modify MAP later. So the MAP penalty is itself computed by a **slot
with providers** — the same pattern as every other slot — with agile as merely one
provider. Do not hardcode `agile ? -4 : -5`.

---

## Open questions / known holes

Tracked deliberately so they are not mistaken for oversights.

- ~~**Large weapon "special benefits"**~~ — RESOLVED 2026-07-19: there is no such
  clause to implement. A Large weapon has no benefits at all; see the rules
  section above. Nothing is outstanding here.
- **Creature size is not on `ResolvedCharacter`** — required to know whether a
  wielder takes the large-weapon clumsy 1. A small but real widening of the
  resolved model, **deliberately deferred** (owner, 2026-07-19). Until it lands,
  the Large trait is carried on the weapon and applies nothing.
- ~~**Forced movement has no model**~~ — **CLOSED, and it is not coming**
  (owner, 2026-07-19): forced movement is table-level information the bot has no
  way to recognise. Club, Polearm, and Shield crit specialization are therefore
  permanently narration-only — their effect text is shown to the players and the
  table adjudicates the movement. This is a decision, NOT a gap: do not "fix" it
  later by inventing a position model.
- ~~**"Bleed" is not in core's `DamageType` vocabulary**~~ — RESOLVED 2026-07-19,
  `bleed` added. Owner's ruling: it is "sort of a damage type… there are feats
  that give resistance to persistent bleed damage, so we SHOULD recognize it as a
  damage type for that purpose." It exists to be NAMED by a resistance, a
  weakness, or a crit spec's `1d6 persistent bleed`.
  - Filed under a new `OTHER_DAMAGE_TYPES` group, NOT physical. Classing it
    physical would be a rules claim nobody made and would silently let anything
    resisting physical damage shrug it off.
  - `persistent` stays a `DamageCategory`, so persistent bleed is the PAIR
    `{ type: "bleed", categories: ["persistent"] }`. Most bleed is persistent but
    the two are orthogonal; collapsing them would make non-persistent bleed
    inexpressible. Both facts are under test.
- **Bomb/Bow crit spec** need splash-radius and immobilise-with-escape-DC
  modelling respectively.

---

## Sequencing

1. ✅ **Scoped attack/damage selectors + attack-trait tagging on nodes + MAP as
   turn-scoped context state** — landed 2026-07-19. No weapon code.
   - `selectors.ts` — `attack`/`damage` left `FIXED_SELECTORS` and became scoped,
     with colon-delimited segments that INTERSECT (`damage:strike:melee` is melee
     Strikes, not melee-or-Strikes). Segment vocabulary derived from the corpus's
     435 usages, which is also why there is no `trait:` dimension — the corpus
     contains none.
   - `map.ts` — the MAP rules, as a count plus a replacement penalty PAIR, with a
     typed `override` seam for the future MAP-altering features the owner flagged.
   - `automation.ts` — an optional `map` marker on `attack` AND `check` nodes
     (Shove has the attack trait too); its presence is the opt-in, so every
     pre-existing tree is unchanged. The count enters via
     `ExecutionContext.attacksThisTurn` and leaves via `Outcome.attacksThisTurn`.
   - `foundry.ts` — strike selectors now map, including patterned group scopes.
     The per-weapon tail (`jaws-damage`, ~50 usages) is still refused: the pattern
     that would catch it also catches `damage-received`, which is INCOMING damage.
   - 859 core tests (+26), all four workspaces green.
2. ✅ **`Strike` + `StrikeSource` as the slot pipeline** — landed 2026-07-19,
   `packages/core/src/strike.ts`, 28 tests.
   - `resolveStrike(character, input)` runs the slot pipeline above and returns an
     attack total, a per-slot `breakdown` (the sheet's "Dex Prof Item" line), and
     damage as `DamageComponent[]`.
   - The web's verified trait math is PORTED unchanged and marked `[PORTED]`:
     finesse picks the attack ability only, propulsive adds half a positive Str
     but ALL of a negative one, thrown adds full Str, plain ranged adds none.
   - **Non-weapon sources need no special case** — a Kineticist-style blast is a
     source declaring `attackAbility: "con"` plus its own `scaling`, and is
     covered by a test that touches no weapon code.
   - Pathbuilder's whole override surface is present: attack/damage/proficiency
     overrides, ability selection, dice count, increase-dice, extra traits, and
     custom typed damage rows.
   - `strikeAutomation(strike, map?)` emits a runnable tree using ONLY the
     existing node vocabulary — the design's central claim, now under test.
   - **The fatal/deadly asymmetry is structural, and verified end to end** through
     the interpreter with a maximum-roll RNG: a d6 bow with deadly d10 crits for
     `[12, 10]` = 22 (base doubled, deadly not), a d6 pick with fatal d10 crits
     for `[40]` (dice become 2d10, all doubled), an ordinary d8+4 longsword for
     `[24]`. Collapsing deadly into the doubled list would read 32 for the bow.
   - `collectStrikeModifiers` is the join to step 1: a `damage:strike:melee`
     effect reaches the longsword and not the shortbow.

   **Deliberately NOT in this slice:** the item/weapon JSON schema and rune
   storage (step 3), creature size and the large-weapon rule, and critical
   specialization content (step 6). `rank` is an INPUT — deciding it from class
   tables is builder orchestration that has not moved yet.
3. ✅ **Item/weapon schema + runes** — landed 2026-07-19,
   `packages/core/src/weapon.ts`, 16 tests.
   - `weaponSchema` + `coerceWeapon`. **All 909 shipped weapons validate — 100%.**
     That is deliberate and worth contrasting with the other content schemas,
     which validate 0/300 of the shipped JSON: the enums here (categories, the 17
     groups, hands, die sizes, damage codes) were DERIVED from `items.json`, not
     from an ideal shape the data then failed to meet.
   - `coerceWeapon` owns the file's two storage encodings — `"d8"` for a die and
     `B`/`P`/`S` for a damage type — so neither escapes into the model. The web's
     app-local copy of that normalization is deleted; it now calls core's.
   - Runes: `potencyAttackBonus` (rank IS the bonus) and `strikingDamageDice`
     (rank + 1 IS the dice count). **Property runes are deliberately absent** — no
     rules text has been supplied and inventing flaming/corrosive would be exactly
     the rules-from-memory this project forbids.
   - `PathbuilderWeapon` — core's Pathbuilder-storage `Weapon` was renamed, since
     a real weapon content entity now exists and the two are different things. The
     web aliases it back to `Weapon` in its own `characters/pathbuilder.ts`, the
     same aliasing that file already does for the `pathbuilder*` readers.

   ### Strike variants (rules text supplied 2026-07-19 — all four implemented)

   The four trait families turned out to be THREE mechanisms, not four:

   | trait | weapons | mechanism |
   |---|---|---|
   | `two-hand-dN` | 178 | **two-handed grip** — sets the damage die size |
   | `fatal-aim-dN` | 8 | **two-handed grip** — grants fatal |
   | `versatile-X` | 124 | damage-type choice, free per attack |
   | `thrown-N` | 73 | a genuinely SEPARATE strike |

   **Two-hand and fatal-aim are the same axis.** Both are "what happens when you
   wield this in two hands", so one `twoHanded` toggle drives both. That they
   arrived as two traits is a data detail, not two mechanics. The owner's note
   that two-hand is "resolvable with a simple toggle on the character sheet"
   applies to fatal aim unchanged.

   **Two-hand sets the die SIZE, never the count** — "this change applies to all
   the weapon's damage dice", so a greater-striking longsword with two-hand d12
   deals `3d12`, not `2d8 + 1d12`. It also does NOT touch the deadly die (5
   shipped weapons pair the traits), because deadly's own text exempts it.

   **Thrown is the one that is a separate strike, not a toggle**, because it
   changes which ability makes the attack roll: "it is a ranged weapon when
   thrown" (Dex attacks) but "you add your Strength modifier to damage as you
   would for a melee weapon" (Str damage). A javelin now yields two sources whose
   attack modifiers differ by Str − Dex while their damage is identical — the
   asymmetry is under test. Only the 73 melee `thrown-N` weapons gain a second
   source; the 15 already-ranged bare-`thrown` ones use their own Range entry.

   **Result: 909 weapons now yield 982 strike sources, 296 carrying variants.**
   The named-but-unbuildable backlog went from **383 to 13**:

   - `modular` (12) — ships BARE on every weapon that has it; the configurations
     live in the weapon's prose, not the trait, so there is nothing to parse. Kept
     as its own field rather than folded into versatile, because switching a
     modular weapon costs an Interact action and switching a versatile one is
     free — collapsing them would make modular look free.
   - `versatile-spirit` (1) — "spirit" is not in core's damage vocabulary.

   `traitDieSize` still explicitly REFUSES `fatal-aim-dN` as a plain `fatal`,
   under test: fatal aim applies only in two hands, so reading it as unconditional
   fatal would hand those 8 firearms a crit die the rules grant only sometimes.
4. ✅ **Point the web at it** — landed 2026-07-19. `deriveCharacter`'s weapon block
   no longer computes rules math; it calls `resolveStrike`. **The duplication this
   doc opened by naming is gone.**
   - What moved: finesse/propulsive/thrown ability selection, potency (attack
     only), striking dice, and Proficiency Without Level.
   - What stayed, correctly: the ORCHESTRATION — reading the build to decide the
     proficiency rank (`attackRankAtLevel`, doctrine, the fighter's chosen group),
     which runes are equipped, and whether Weapon Specialization applies. That is
     build interpretation, not rules arithmetic.
   - `EquippedWeapon` is unchanged, so its three consumers (`CharacterSummary`,
     the Pathbuilder export, `effects.test.ts`) needed no edits.
   - `toStrikeSource` is the boundary adapter: `items.json` encodes damage types
     as `B`/`P`/`S` and dice as `'d8'`, which are storage details of a file that
     predates core's schemas. Core should not learn them.
   - Two small core additions this required, both things a resolved strike should
     have carried anyway: `StrikeActor` (level + mods, narrower than
     `ResolvedCharacter`, so a caller mid-derivation need not fabricate an AC) and
     `damageBonus`/`damageBreakdown` (a sheet shows the flat bonus as its own
     line; recovering it by parsing the formula back apart would be absurd).

   **How it was verified.** A temporary parity harness recomputed attack, dice,
   and damage with the ORIGINAL inline formula across 6 weapons × 5 levels × 4
   rune combinations × ABP × PWL (>100 comparisons), and required that some valid
   proficiency rank reproduce each ported attack total EXACTLY. It was
   mutation-tested — injecting `striking + 1` made it fail — then **deleted**,
   because keeping a second copy of the rules math is the very thing this step
   removed. Spot-checked output: a L16 fighter with a major striking longsword
   reads `+27, 4d8+8`; the same character's shortbow reads `4d6+6`, correctly
   omitting Strength from a plain ranged weapon's damage while still applying
   Weapon Specialization.
5. ✅ **Non-weapon sources** — landed 2026-07-19, 916 core tests.

   The capability existed since step 2 (a Kineticist blast needed no special
   case). **The actual blocker was that a strike source could not be STORED.**
   `StrikeScaling` was a JS function, and a closure cannot survive JSON, a
   database, a review queue, or a diff — so "custom attacks" could only ever have
   been hard-coded, which is not a feature a player can use.

   - `StrikeScaling` is now a union: a declarative `{ count?: Expr; size?: Expr }`
     evaluated against the sandboxed expression AST with `level` in scope (expr.ts,
     no `eval`), plus a plain function for sources constructed in code.
   - `strikeSourceSchema` accepts ONLY the declarative form, so a closure cannot
     reach stored content — under test. It is `.strict()`, so a typo'd key in
     authored content fails loudly instead of vanishing.
   - The scaling scope exposes `level` and nothing else. A rule needing a
     character's abilities is a different mechanism (a `modifier` effect);
     widening the scope would invite content that depends on evaluation order.
   - Proven by resolving an Elemental Blast authored as **pure JSON**, put through
     `JSON.stringify`/`parse`, scaling 1d8 → 2d8 at level 5 off Constitution.

   **Why this matters most for unarmed attacks.** Only **5** unarmed weapons exist
   as items (`unarmed-strike`, plus 4 handwraps). Jaws, claws, hooves and the rest
   are granted by feats and ancestries — so they can only ever be CONTENT, never
   inventory. Without a storable strike source there was no shape for them to
   take.

   **Deliberately not done here:** core defines no built-in fist. Its damage die
   and type are a rules claim, and the shipped `unarmed-strike` item already
   carries them — the app should supply it rather than core hard-coding one.

### The next increment, measured

Ingesting the Foundry `Strike` elements is now unblocked, and the shape lines up
almost 1:1 with `strikeSourceSchema`:

- **116 `Strike` rule elements across 57 entities** (Bestial Manifestation,
  Automaton Armament, …), each carrying `category`, `group`, `traits`, and
  `damage.base.{damageType, dice, die}`.

That work is INGEST (a `foundry.ts` mapping plus a `strikes` field on the feat
schema), not strike modelling, which is why it is not folded into step 5. Doing it
would also be the first content to populate such a field — worth confirming before
adding a schema field, given the other content schemas' 0/300 conformance record.
6. **Critical specialization** as authored content in `criticalSuccess` branches.
   Needs no new engine surface — the prerequisites are now in place (`bleed` is a
   damage type; conditions, saves vs class DC, and persistent damage all exist).
   Club / Polearm / Shield stay narration-only by decision, not by omission.

---

## Where this stands (end of 2026-07-19)

Steps 1–5 landed; step 6 is authoring, not engineering. The engine can resolve a
strike for a weapon, an unarmed attack, a class feature, or a player-built custom
attack, and hand the result to the existing Layer-2 interpreter unchanged.

**Known and accepted — not gaps to rediscover:**
- The web takes `sources[0]`, so the 73 thrown strikes and the two-handed /
  damage-type toggles exist in the engine but are not on the sheet. Deferred to a
  dedicated frontend pass covering all the engine updates at once (owner,
  2026-07-19).
- `rank` is still an INPUT to `resolveStrike`. Deciding it from class tables is
  builder orchestration and has not moved to core.
- Creature size is still absent, so the large-weapon clumsy 1 applies nothing.
- Property runes (flaming, corrosive…) are unmodelled — no rules text supplied.

**The next stage is not on this list.** It is the `needs-combat-tags` bucket —
**1,779 elements, the largest in the corpus** — which the step-1 measurement
identified as the real gate on attack/damage content: 90% of attack/damage
selector elements and 84% of `needs-item-model` elements are predicate-gated. See
`effects-engine-design.md`.
