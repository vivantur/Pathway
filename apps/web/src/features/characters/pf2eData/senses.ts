/**
 * Base senses granted by PF2e ancestries and heritage overlays.
 *
 * This is a hand-maintained snapshot of Player Core + Character Guide senses.
 * Keys are stored lowercase-trimmed so we don't have to normalize at every
 * lookup site. When a character's overlay carries `edits.senses`, that takes
 * priority — this table is the fallback for characters the bot hasn't
 * annotated (imports directly from Pathbuilder, freshly created characters,
 * etc.).
 *
 * Not exhaustive — extend as needed. The `senses` block in the sheet renders
 * whatever comes out of `computeSenses()`; anything missing here just falls
 * out of the list, no visual break.
 */

const ANCESTRY_SENSES: Record<string, string[]> = {
  // Player Core
  dwarf: ['Darkvision'],
  elf: ['Low-Light Vision'],
  gnome: ['Low-Light Vision'],
  goblin: ['Darkvision'],
  halfling: ['Keen Eyes'],
  human: [],
  leshy: ['Low-Light Vision'],
  orc: ['Darkvision'],

  // Character Guide + common Rare/Uncommon
  android: ['Low-Light Vision'],
  automaton: ['Low-Light Vision', 'Darkvision'],
  azarketi: ['Low-Light Vision'],
  catfolk: ['Low-Light Vision'],
  conrasu: [],
  dhampir: ['Darkvision'],
  fetchling: ['Darkvision'],
  fleshwarp: ['Darkvision'],
  gnoll: ['Low-Light Vision'],
  goloma: ['Darkvision'],
  grippli: ['Darkvision'],
  hobgoblin: ['Darkvision'],
  ifrit: ['Low-Light Vision'],
  kashrishi: ['Low-Light Vision'],
  kitsune: ['Low-Light Vision'],
  kobold: ['Darkvision'],
  lizardfolk: [],
  iruxi: [],
  nagaji: ['Low-Light Vision'],
  oread: ['Low-Light Vision'],
  poppet: ['Low-Light Vision'],
  ratfolk: ['Low-Light Vision', 'Scent 30 ft. (imprecise)'],
  shisk: ['Darkvision'],
  shoony: ['Low-Light Vision'],
  skeleton: ['Darkvision'],
  sprite: ['Low-Light Vision'],
  strix: ['Darkvision'],
  suli: ['Low-Light Vision'],
  sylph: ['Low-Light Vision'],
  tengu: ['Low-Light Vision'],
  tiefling: ['Darkvision'],
  undine: ['Low-Light Vision'],
  vanara: ['Low-Light Vision'],
  vishkanya: ['Low-Light Vision'],

  // Versatile / planar-scion umbrellas (Remaster)
  aiuvarin: ['Low-Light Vision'],
  ganzi: ['Low-Light Vision'],
  nephilim: ['Darkvision'],
};

/**
 * Heritages that change or add senses. Keyed by heritage name lowercased.
 * Value is an "override" mode:
 *   - 'add'     : append these senses to whatever the ancestry granted
 *   - 'replace' : the ancestry's senses are removed and this used instead
 */
const HERITAGE_SENSES: Record<string, { mode: 'add' | 'replace'; senses: string[] }> = {
  // Elf heritages
  'ancient-blooded': { mode: 'add', senses: [] },
  'cavern elf': { mode: 'replace', senses: ['Darkvision'] },
  'seer elf': { mode: 'add', senses: [] },
  'whisper elf': { mode: 'add', senses: [] },
  'woodland elf': { mode: 'add', senses: [] },

  // Dwarf heritages
  'ancient-blooded dwarf': { mode: 'add', senses: [] },
  'anvil dwarf': { mode: 'add', senses: [] },
  'death warden dwarf': { mode: 'add', senses: [] },
  'forge-blessed dwarf': { mode: 'add', senses: [] },
  'oathkeeper dwarf': { mode: 'add', senses: [] },
  'rock dwarf': { mode: 'add', senses: [] },
  'strong-blooded dwarf': { mode: 'add', senses: [] },

  // Half-elven umbrella heritages that grant Low-Light
  aiuvarin: { mode: 'add', senses: ['Low-Light Vision'] },
  nephilim: { mode: 'add', senses: ['Darkvision'] },

  // Halfling — most heritages don't touch vision, twilight halfling being the exception
  'twilight halfling': { mode: 'add', senses: ['Low-Light Vision'] },

  // Common vision-adding heritages across many ancestries
  'nightvision goblin': { mode: 'replace', senses: ['Darkvision'] },
  'unbreakable goblin': { mode: 'add', senses: [] },
};

/** Compute the fallback senses list for a character with no overlay-side edit. */
export function computeSensesFromAncestry(
  ancestry: string | undefined | null,
  heritage: string | undefined | null,
): string[] {
  const anc = (ancestry ?? '').trim().toLowerCase();
  const her = (heritage ?? '').trim().toLowerCase();

  const base = ANCESTRY_SENSES[anc] ?? [];
  if (!her) return dedupe(base);

  const heritageEntry = HERITAGE_SENSES[her];
  if (!heritageEntry) return dedupe(base);
  if (heritageEntry.mode === 'replace') return dedupe(heritageEntry.senses);
  return dedupe([...base, ...heritageEntry.senses]);
}

function dedupe(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    const k = s.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(s);
    }
  }
  return out;
}
