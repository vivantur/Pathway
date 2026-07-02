import {
  AbilitiesIcon,
  AncestryIcon,
  ClassIcon,
  CompanionIcon,
  EquipmentIcon,
  FeatsIcon,
  JournalIcon,
  OverviewIcon,
  SkillsIcon,
  SpellsIcon,
} from '../icons';

export type TabId =
  | 'overview'
  | 'ancestry'
  | 'class'
  | 'abilities'
  | 'skills'
  | 'feats'
  | 'spells'
  | 'companions'
  | 'equipment'
  | 'journal';

export interface TabDefinition {
  id: TabId;
  label: string;
  icon: (props: { className?: string }) => JSX.Element;
  description: string;
}

/**
 * Ordered list of sheet tabs. Also drives the bottom tab bar's rendering.
 * Extracting this from Sheet.tsx keeps Fast Refresh happy (that file can
 * only re-export components) and gives non-component consumers (e.g.
 * `normalizeTabId`, `TabContent`) a stable import path.
 */
export const TAB_DEFINITIONS: TabDefinition[] = [
  { id: 'overview',  label: 'Overview',  icon: OverviewIcon,  description: 'Everything about this character at a glance.' },
  { id: 'ancestry',  label: 'Ancestry',  icon: AncestryIcon,  description: 'Ancestry, heritage, senses, and ancestry feats in detail.' },
  { id: 'class',     label: 'Class',     icon: ClassIcon,     description: 'Class features, key ability, class DC, and class-granted proficiencies.' },
  { id: 'abilities', label: 'Abilities', icon: AbilitiesIcon, description: 'Ability score breakdown and the boost trail from level 1 onward.' },
  { id: 'skills',    label: 'Skills',    icon: SkillsIcon,    description: 'Every skill with its full breakdown — proficiency, ability, and any bonuses.' },
  { id: 'feats',     label: 'Feats',     icon: FeatsIcon,     description: 'All feats grouped by category and level with detail.' },
  { id: 'spells',    label: 'Spells',     icon: SpellsIcon,     description: 'Spellcasters, spells per level, slots, focus pool, and innate magic.' },
  { id: 'companions',label: 'Companions', icon: CompanionIcon,  description: 'Animal companions, familiars, eidolons, and mounts.' },
  { id: 'equipment', label: 'Equipment',  icon: EquipmentIcon,  description: 'Weapons, armor, full inventory, and treasure.' },
  { id: 'journal',   label: 'Journal',    icon: JournalIcon,    description: 'XP history, notes, and biographical detail.' },
];

export function normalizeTabId(raw: string | null): TabId {
  const known = TAB_DEFINITIONS.map((t) => t.id);
  return known.includes(raw as TabId) ? (raw as TabId) : 'overview';
}
