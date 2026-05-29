# PF2e Character Calculations

Reference for every numeric calculation used in character creation (`synthesizeBuild`) and the character detail page (`/characters/[id]`). Formulas are quoted directly from the implemented code.

---

## Proficiency Ranks

All proficiency values are stored as integers on the 0–4 scale. This applies to every key in `pathbuilder_data.build.proficiencies`.

| Stored value | Rank name | Proficiency bonus |
|---|---|---|
| 0 | Untrained | 0 (no bonus, not even level) |
| 1 | Trained | +2 + level |
| 2 | Expert | +4 + level |
| 3 | Master | +6 + level |
| 4 | Legendary | +8 + level |

**Formula (`profBonus` in `page.tsx`):**
```typescript
function profBonus(rank: number, level: number): number {
  return rank === 0 ? 0 : rank * 2 + level;
}
```

Untrained proficiency grants zero bonus — **level is not added** for untrained.

---

## Ability Modifier

**Formula:**
```typescript
Math.floor((score - 10) / 2)
```

| Score | Modifier |
|---|---|
| 8 | −1 |
| 10 | +0 |
| 12 | +1 |
| 14 | +2 |
| 16 | +3 |
| 18 | +4 |
| 20 | +5 |

---

## Maximum Hit Points

**Formula (`deriveMaxHp` in `page.tsx`):**
```typescript
function deriveMaxHp(build: PBBuild, level: number): number | null {
  const attr = build.attributes;
  if (!attr) return null;
  const conMod = Math.floor(((build.abilities?.con ?? 10) - 10) / 2);
  const perLevel = (attr.classhp ?? 0) + conMod + (attr.bonushpPerLevel ?? 0);
  return (attr.ancestryhp ?? 0) + perLevel * level + (attr.bonushp ?? 0);
}
```

**Expanded:**
```
maxHP = ancestryHP + (classHP + CON modifier + bonusHPPerLevel) × level + bonusHP
```

**Sources stored in `attributes`:**

| Field | Source |
|---|---|
| `ancestryhp` | Ancestry row's `ancestry_hp` column |
| `classhp` | Class row's `class_hp` column |
| `bonushp` | Flat HP bonus (feats, abilities) — always 0 for native builds |
| `bonushpPerLevel` | Per-level HP bonus (toughness feat etc.) — always 0 for native builds |

**Example — Level 1 Human Fighter (CON 12):**
```
ancestryHP = 8   (Human)
classHP    = 10  (Fighter)
CON mod    = +1  (score 12)

maxHP = 8 + (10 + 1) × 1 = 8 + 11 = 19
```

---

## Armor Class

**Formula (`synthesizeBuild` in `route.ts`):**
```typescript
const dexMod = Math.floor((input.abilities.dex - 10) / 2);
const unarmoredRank = mergedProfs.unarmored ?? 2;
const acProfBonus = unarmoredRank > 0 ? unarmoredRank * 2 + input.level : 0;

acTotal = {
  acProfBonus,
  acAbilityBonus: dexMod,
  acItemBonus:    0,
  acTotal:        10 + acProfBonus + dexMod,
  shieldBonus:    null,
}
```

**Expanded:**
```
AC = 10 + acProfBonus + DEX modifier + itemBonus + shieldBonus
   = 10 + (unarmoredRank × 2 + level) + DEX modifier
```

Native builds always use unarmored defense. `acItemBonus` is 0 (no equipped armor during creation) and `shieldBonus` is null (not raised). The proficiency contribution is 0 for Untrained (rank 0).

**Example — Level 1 character, Trained unarmored (rank 1), DEX 14:**
```
acProfBonus = 1 × 2 + 1 = 3
DEX mod     = +2
AC          = 10 + 3 + 2 = 15
```

---

## Saving Throws

**Formula (`SaveBox` in `page.tsx`):**
```typescript
const total = profBonus(rank, level) + abilityModNum(abilityScore);
```

**Ability scores by save:**

| Save | Ability |
|---|---|
| Fortitude | CON |
| Reflex | DEX |
| Will | WIS |

**Example — Level 1 Fighter, Expert Fortitude (rank 2), CON 14:**
```
profBonus(2, 1) = 4 + 1 = 5
CON mod         = +2
Fortitude total = +7
```

---

## Perception

**Formula (`StatsTabPanel` / `SaveBox` in `page.tsx`):**
```typescript
profBonus(profs.perception ?? 2, level) + abilityModNum(abs.wis)
```

Ability: **WIS**

**Minimum rank:** All characters are guaranteed at least rank 1 (Trained) in Perception. `synthesizeBuild` enforces this floor:

```typescript
if ((mergedProfs.perception ?? 0) < 2) mergedProfs.perception = 2;
```

> Note: the floor is stored as 2 (Expert) in the current synthesis code, matching what class `initial_proficiencies` typically grants. Classes that grant Trained perception will store rank 1; this floor only fires for classes that omit perception entirely.

---

## Skills

**Formula (`StatsTabPanel` in `page.tsx`):**
```typescript
const total = profBonus(rank, level) + abilityModNum(abilScore);
```

**Skill → Ability mapping:**

| Skill | Ability |
|---|---|
| Acrobatics | DEX |
| Arcana | INT |
| Athletics | STR |
| Crafting | INT |
| Deception | CHA |
| Diplomacy | CHA |
| Intimidation | CHA |
| Medicine | WIS |
| Nature | WIS |
| Occultism | INT |
| Performance | CHA |
| Religion | WIS |
| Society | INT |
| Stealth | DEX |
| Survival | WIS |
| Thievery | DEX |

The 16 skills above always appear. Additional skills (lores, campaign skills, piloting, computers) are rendered in a separate "Additional Skills" section and have no hard-coded ability association — they show their stored rank with no ability modifier applied.

---

## Skill Budget (Native Builder)

**Formula (`AbilitySkillStep.tsx`):**
```
freePicks = max(0, classTrainedCount + INT modifier)
```

`classTrainedCount` comes from the class row (how many free skill trains the class grants). INT modifier adds or subtracts from that pool.

**Separately locked (not counting against free picks):**
- Class-granted skills from `initial_proficiencies` (rank > 0 already set)
- Background trained skill (auto-extracted from `skill_proficiencies`)

Locked skills show a badge ("class" or "bg") and their checkbox is disabled in the UI.

---

## Proficiency Merge Order (Synthesis)

When `synthesizeBuild` builds `mergedProfs`, the spreads are applied in this order — later writes win, so higher ranks always take precedence:

```typescript
const mergedProfs = {
  ...baseSkills,          // all 18 skills = 0 (floor)
  ...classProfs,          // class initial_proficiencies (saves, weapons, armor, class DC, perception, some skills)
  ...bgSkillProfs,        // background trained skill → max(classRank, 2)
  ...trainedSkillProfs,   // user free picks → max(classRank, 2) each
  ...additionalSkillProfs,// extra/lore skills → rank 2–5 as entered
};
// Perception floor applied after merge
if ((mergedProfs.perception ?? 0) < 2) mergedProfs.perception = 2;
```

The `Math.max(existingRank, 2)` used for background and trained skills ensures a class-granted Expert+ proficiency is never downgraded if the player also selects that skill as a free pick.

---

## Lores

Lores are stored as a two-element array `[name, rank]` in `build.lores`.

```typescript
lores: [
  ...(input.lore ? [[input.lore, 2]] : []),    // background lore, always rank 2
  ...(input.additional_skills ?? [])
    .filter(skill => /lore$/i.test(skill.name.trim()))
    .map(skill => [
      skill.name.trim().replace(/\s+lore$/i, ""),
      Math.max(2, Math.min(5, Math.round(skill.rank || 2))),
    ]),
]
```

Background lore is always rank 2. Additional lore skills use whatever rank the user entered (clamped 2–5).

The lore name has " Lore" stripped before storing (Pathbuilder convention): `"Alcohol Lore"` → `["Alcohol", 2]`.

---

## Companion HP (Custom Companions)

**Formula (`companionMaxHp` in `page.tsx`):**
```typescript
function companionMaxHp(comp: BotCompanion, charLevel: number): number | null {
  if (comp.baseType !== "custom" || !comp.customStats) return null;
  const base = comp.customStats.hpPerLevel ?? 8;
  const con  = comp.customStats.abilities?.con ?? 0;
  if (comp.form === "young")  return base * charLevel;
  if (comp.form === "mature") return (base + con) * charLevel;
  return (base + con + 1) * charLevel; // nimble or savage
}
```

| Form | Formula |
|---|---|
| Young | `hpPerLevel × charLevel` |
| Mature | `(hpPerLevel + CON bonus) × charLevel` |
| Nimble / Savage | `(hpPerLevel + CON bonus + 1) × charLevel` |

Only applies to companions with `baseType === "custom"`. Standard companions (from base types) return null and display HP from the bot's overlay without a calculated max.

---

## Price Formatting

Item prices are stored as copper pieces (integer). Display converts to the largest clean denomination:

```typescript
function formatPriceCp(cp: number | null): string {
  const gp  = Math.floor(cp / 100);
  const sp  = Math.floor((cp % 100) / 10);
  const rem = cp % 10;
  // render non-zero denominations separated by ", "
}
```

| Stored (cp) | Displayed |
|---|---|
| 100 | 1 gp |
| 150 | 1 gp, 5 sp |
| 235 | 2 gp, 3 sp, 5 cp |
| 0 | — |

---

## Size Encoding

Ancestry size is stored as a string in the `ancestries` table and converted to Pathbuilder's integer encoding in `synthesizeBuild`:

```typescript
const ANCESTRY_SIZE_MAP: Record<string, number> = {
  tiny: 1, small: 1, medium: 2, large: 3, huge: 4, gargantuan: 5,
};
```

Note: tiny and small both map to 1 (Pathbuilder treats them identically in the size field).

---

## What Is Not Calculated (Phase 2)

The following values are accepted as manual input or left at fixed defaults in Phase 1, to be derived automatically in a later phase:

- **Ability score boosts** — ancestry/background/class boost layers; user enters final scores directly
- **Spell attack bonus / spell DC** — not computed; `castingArcane/Divine/Occult/Primal` stored from `initial_proficiencies` as-is
- **Attack bonus for weapons** — stored as freetext `bonus` string, not calculated
- **Class DC** — stored from `initial_proficiencies`, not separately computed on the detail page
- **Focus points** — stored as 0 for native builds; bot tracks the actual pool
- **XP** — stored as 0; bot manages XP accrual
