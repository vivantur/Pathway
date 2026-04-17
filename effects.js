// effects.js
// PF2e condition presets. Each preset is a function that takes a `value`
// (for scaling conditions like Frightened 2) and returns an effect object.
//
// Effect modifier shape:
// {
//   attackBonus: number,    // added to attack rolls
//   damageBonus: number,    // added to damage rolls
//   acBonus: number,        // added to AC (typically negative for conditions)
//   saveBonus: number,      // added to saving throws
//   skillBonus: number,     // added to skill checks
//   noAttack: boolean,      // combatant can't attack (informational, shows warning)
//   description: string     // human-readable description shown when applied
// }

// Helper: a penalty equal to -value
const neg = v => -Math.abs(v);

const PRESETS = {
  // ── Negative conditions ─────────────────────────────────────────────────
  frightened: {
    name: 'Frightened',
    scaling: true, // takes a value
    build: (value) => ({
      attackBonus: neg(value),
      damageBonus: neg(value),
      acBonus: neg(value),
      saveBonus: neg(value),
      skillBonus: neg(value),
      description: `Status penalty of ${neg(value)} to all checks and DCs.`,
    }),
  },
  stupefied: {
    name: 'Stupefied',
    scaling: true,
    build: (value) => ({
      // Technically only mental actions, but we apply broadly for simplicity
      attackBonus: neg(value),
      saveBonus: neg(value),
      skillBonus: neg(value),
      description: `Status penalty of ${neg(value)} to Intelligence/Wisdom/Charisma-based checks and spell DCs.`,
    }),
  },
  sickened: {
    name: 'Sickened',
    scaling: true,
    build: (value) => ({
      attackBonus: neg(value),
      damageBonus: neg(value),
      acBonus: neg(value),
      saveBonus: neg(value),
      skillBonus: neg(value),
      description: `Status penalty of ${neg(value)} to all checks and DCs.`,
    }),
  },
  clumsy: {
    name: 'Clumsy',
    scaling: true,
    build: (value) => ({
      // Dex-based: attacks with finesse/ranged, Reflex, Acrobatics, Stealth, Thievery, AC
      attackBonus: neg(value),
      acBonus: neg(value),
      saveBonus: neg(value),
      skillBonus: neg(value),
      description: `Status penalty of ${neg(value)} to Dexterity-based rolls and AC.`,
    }),
  },
  enfeebled: {
    name: 'Enfeebled',
    scaling: true,
    build: (value) => ({
      // Str-based: melee attacks, damage, Athletics
      attackBonus: neg(value),
      damageBonus: neg(value),
      skillBonus: neg(value),
      description: `Status penalty of ${neg(value)} to Strength-based rolls and damage.`,
    }),
  },
  drained: {
    name: 'Drained',
    scaling: true,
    build: (value) => ({
      // Con-based: Fortitude saves, also reduces HP (we don't auto-reduce HP; GM handles)
      saveBonus: neg(value), // approximation
      description: `Status penalty of ${neg(value)} to Constitution-based rolls and Fortitude. Also reduces max HP by ${value}×level (apply manually).`,
    }),
  },
  'off-guard': {
    name: 'Off-Guard',
    scaling: false,
    build: () => ({
      acBonus: -2,
      description: '-2 status penalty to AC. Flanked, prone, and certain conditions cause Off-Guard.',
    }),
  },
  prone: {
    name: 'Prone',
    scaling: false,
    build: () => ({
      attackBonus: -2,
      acBonus: -2, // off-guard component
      description: '-2 status penalty to attack rolls. Off-Guard. Can only Crawl or Stand.',
    }),
  },
  fleeing: {
    name: 'Fleeing',
    scaling: false,
    build: () => ({
      noAttack: true,
      description: 'Must spend each action trying to flee. Cannot use actions that would move them closer to the source.',
    }),
  },
  grabbed: {
    name: 'Grabbed',
    scaling: false,
    build: () => ({
      acBonus: -2, // off-guard
      description: 'Off-Guard. Cannot move away from the grabber without a successful Escape.',
    }),
  },
  restrained: {
    name: 'Restrained',
    scaling: false,
    build: () => ({
      acBonus: -2, // off-guard
      description: 'Off-Guard. Cannot move, attack, or manipulate objects without a successful Escape.',
    }),
  },
  blinded: {
    name: 'Blinded',
    scaling: false,
    build: () => ({
      skillBonus: -4,
      description: 'Cannot see. -4 to Perception-based checks. All normal terrain is difficult.',
    }),
  },
  slowed: {
    name: 'Slowed',
    scaling: true,
    build: (value) => ({
      description: `Lose ${value} action${value === 1 ? '' : 's'} at the start of each turn.`,
    }),
  },

  // ── Positive conditions ─────────────────────────────────────────────────
  quickened: {
    name: 'Quickened',
    scaling: false,
    build: () => ({
      description: 'Gains 1 extra action each turn.',
    }),
  },
  bless: {
    name: 'Bless',
    scaling: false,
    build: () => ({
      attackBonus: +1,
      description: '+1 status bonus to attack rolls (emanation aura).',
    }),
  },
  heroism: {
    name: 'Heroism',
    scaling: true, // 1/2/3 based on spell rank
    build: (value) => ({
      attackBonus: value,
      saveBonus: value,
      skillBonus: value,
      description: `+${value} status bonus to attack rolls, saves, Perception, and skill checks.`,
    }),
  },

  // ── Informational (display-only) ────────────────────────────────────────
  hidden: {
    name: 'Hidden',
    scaling: false,
    build: () => ({
      description: 'Attackers must succeed at a DC 11 flat check to target.',
    }),
  },
  concealed: {
    name: 'Concealed',
    scaling: false,
    build: () => ({
      description: 'Attackers must succeed at a DC 5 flat check to target.',
    }),
  },
  invisible: {
    name: 'Invisible',
    scaling: false,
    build: () => ({
      description: 'Undetected by all creatures without precise senses that detect the invisible.',
    }),
  },
};

// Look up a preset by name (case-insensitive, with some common aliases)
function getPreset(name) {
  if (!name) return null;
  const key = name.toLowerCase().trim().replace(/\s+/g, '-');
  // Handle common aliases
  const aliases = {
    'flat-footed': 'off-guard',
    'flatfooted': 'off-guard',
    offguard: 'off-guard',
  };
  const resolvedKey = aliases[key] ?? key;
  return PRESETS[resolvedKey] ? { key: resolvedKey, ...PRESETS[resolvedKey] } : null;
}

// Return all preset names for the autocomplete/help listing
function listPresets() {
  return Object.entries(PRESETS).map(([key, p]) => ({
    key,
    name: p.name,
    scaling: p.scaling,
  }));
}

module.exports = { getPreset, listPresets, PRESETS };