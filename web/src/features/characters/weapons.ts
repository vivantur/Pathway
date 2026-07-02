import type { PathbuilderBuild, Weapon } from './pathbuilder';
import type { CharacterOverlay } from './types';

/**
 * Merge the Pathbuilder weapons array with the bot's overlay-side additions
 * (natural weapons, custom entries) — bot-side takes precedence when a name
 * matches. Overlay weapons come with pre-formatted `die` like `"1d8+3"`, so
 * we normalize to the shape our WeaponRow expects.
 *
 * Shared between the Overview's Attacks & Spellcasting panel and the
 * dedicated Equipment tab so both views agree on the weapon list.
 */
export function mergeWeapons(
  build: PathbuilderBuild,
  overlay: CharacterOverlay | null,
): Weapon[] {
  const pathbuilderWeapons: Weapon[] = build.weapons ?? [];
  const overlayWeapons = overlay?.pathway_bot_state?.edits?.weapons ?? [];
  if (overlayWeapons.length === 0) return pathbuilderWeapons;

  const nameOf = (w: { name?: string; display?: string }) =>
    (w.display ?? w.name ?? '').toLowerCase();
  const overlayByName = new Map(overlayWeapons.map((w) => [nameOf(w), w]));
  const merged: Weapon[] = pathbuilderWeapons.map((w) => {
    const override = overlayByName.get(nameOf(w));
    if (!override) return w;
    overlayByName.delete(nameOf(w));
    return {
      ...w,
      display: override.display ?? w.display,
      die: parseOverlayDie(override.die) ?? w.die,
      damageBonus: override.damageBonus ?? w.damageBonus,
      damageType: override.damageType?.[0] ?? w.damageType,
      attack: override.attack ?? w.attack,
    };
  });
  for (const extra of overlayByName.values()) {
    merged.push({
      name: extra.name ?? extra.display ?? 'Weapon',
      display: extra.display ?? extra.name,
      die: parseOverlayDie(extra.die),
      attack: extra.attack,
      damageBonus: extra.damageBonus,
      damageType: extra.damageType?.[0],
    });
  }
  return merged;
}

/** Overlay stores die as `"1d8+3"`; the Weapon row wants just the die (`d8`). */
export function parseOverlayDie(die: string | undefined): string | undefined {
  if (!die) return undefined;
  const m = die.match(/d\d+/);
  return m ? m[0] : die;
}
