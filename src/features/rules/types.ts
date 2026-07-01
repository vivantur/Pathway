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
}

export type RuleCategoryId =
  | 'feats'
  | 'spells'
  | 'items'
  | 'conditions'
  | 'ancestries'
  | 'backgrounds';
