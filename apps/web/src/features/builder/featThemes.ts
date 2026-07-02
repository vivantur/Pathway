import type { Feat } from '@/features/builder/data';

export const THEMES = ['Damage', 'Defense', 'Magic', 'Skills', 'Support', 'Utility'] as const;
export type Theme = (typeof THEMES)[number];

/**
 * Best-effort theme tagging so newcomers can filter feats by what they *do*,
 * without knowing feat names. Uses explicit tags if present, else infers from
 * traits and keywords. Every feat lands in at least one theme.
 */
export function featThemes(feat: Feat): Theme[] {
  if (feat.tags?.length) {
    const known = feat.tags.filter((t): t is Theme => (THEMES as readonly string[]).includes(t));
    if (known.length) return known;
  }

  const hay = `${feat.name} ${feat.description} ${feat.traits.join(' ')}`.toLowerCase();
  const themes = new Set<Theme>();

  if (/(damage|strike|attack|weapon|hit|blow|swing|shot|slice|charge)/.test(hay)) themes.add('Damage');
  if (/(shield|armor|ac\b|defen|dodge|resist|block|prone|stable)/.test(hay)) themes.add('Defense');
  if (/(spell|cantrip|magic|focus|cast|arcane|primal|occult|divine|metamagic|familiar|hex)/.test(hay))
    themes.add('Magic');
  if (/(skill|trained|lore|recall knowledge|balance|climb|perform|intimidat|deceiv)/.test(hay))
    themes.add('Skills');
  if (/(heal|ally|allies|aid|restore|help|bolster|inspire|compan)/.test(hay)) themes.add('Support');

  if (themes.size === 0) themes.add('Utility');
  return [...themes];
}
