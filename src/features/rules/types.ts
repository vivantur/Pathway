/**
 * A normalized reference entry for the Rules Library. Each source table
 * (feats, spells, items, conditions, …) maps its rows onto this shape so the
 * browser can render them uniformly.
 */
export interface RuleEntry {
  id: string;
  name: string;
  category: RuleCategoryId;
  level: number | null;
  rarity: string | null;
  traits: string[];
  /** Short "1 action" / "reaction" style cost, when applicable. */
  actionCost: string | null;
  prerequisites: string | null;
  trigger: string | null;
  description: string | null;
  aonUrl: string | null;
  /** Type-specific labeled facts shown in the detail view (range, price, …). */
  meta: Array<{ label: string; value: string }>;
  /** Present for monsters — renders as a PF2e stat-block grid. */
  statBlock?: MonsterStatBlock;
}

export interface MonsterAttack {
  name: string;
  /** "Melee" | "Ranged". */
  kind: string;
  toHit: string | null;
  damage: string | null;
  traits: string[];
}

export interface MonsterAbility {
  name: string;
  actionCost: string | null;
  traits: string[];
  description: string;
}

/** The full PF2e stat-block fields shown for a monster. */
export interface MonsterStatBlock {
  imageUrl: string | null;
  aonUrl: string | null;
  // Defense
  ac: string | null;
  hp: string | null;
  fort: string | null;
  ref: string | null;
  will: string | null;
  perception: string | null;
  immunities: string[];
  resistances: string[];
  weaknesses: string[];
  // Movement / senses / social
  speed: string | null;
  size: string | null;
  senses: string[];
  languages: string[];
  // Six ability modifiers, STR…CHA order, as display strings ("+4").
  abilities: Array<{ label: string; value: string }>;
  skills: Array<{ label: string; value: string }>;
  items: string[];
  // Offense
  attacks: MonsterAttack[];
  specialAbilities: MonsterAbility[];
}

export type RuleCategoryId =
  | 'feats'
  | 'spells'
  | 'items'
  | 'conditions'
  | 'ancestries'
  | 'backgrounds'
  | 'monsters'
  | 'classes'
  | 'archetypes'
  | 'actions'
  | 'afflictions'
  | 'heritages'
  | 'hazards'
  | 'rituals'
  | 'deities'
  | 'domains'
  | 'familiars'
  | 'relics'
  | 'planes'
  | 'languages'
  | 'skills'
  | 'traits'
  | 'rules'
  | 'sources';
