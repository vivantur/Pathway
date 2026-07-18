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
//
// Some effects have extra fields beyond modifiers:
//   kind: 'persistent-damage' | 'condition'  (default: 'condition')
//   dice: '1d6'               (for persistent damage)
//   damageType: 'fire'        (for persistent damage)
//   dc: 15                    (for persistent damage: DC of the flat check to end)

// Helper: a penalty equal to -value
const neg = v => -Math.abs(v);

const PRESETS = {
  // ── Negative conditions ─────────────────────────────────────────────────
  frightened: {
    name: 'Frightened',
    scaling: true,
    // No damageBonus: the rule is "a status penalty to all your checks and DCs",
    // and a damage roll is neither a check nor a DC.
    build: (value) => ({
      attackBonus: neg(value),
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
      attackBonus: neg(value),
      saveBonus: neg(value),
      skillBonus: neg(value),
      description: `Status penalty of ${neg(value)} to Intelligence/Wisdom/Charisma-based checks and spell DCs.`,
    }),
  },
  sickened: {
    name: 'Sickened',
    scaling: true,
    // No damageBonus — same reason as Frightened: checks and DCs only.
    build: (value) => ({
      attackBonus: neg(value),
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
      saveBonus: neg(value),
      description: `Status penalty of ${neg(value)} to Constitution-based rolls and Fortitude. Also reduces max HP by ${value}×level (apply manually).`,
    }),
  },
  'off-guard': {
    name: 'Off-Guard',
    scaling: false,
    build: () => ({
      acBonus: -2,
      description: '-2 circumstance penalty to AC. Flanked, prone, and certain conditions cause Off-Guard.',
    }),
  },
  prone: {
    name: 'Prone',
    scaling: false,
    build: () => ({
      attackBonus: -2,
      acBonus: -2,
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
      acBonus: -2,
      description: 'Off-Guard. Cannot move away from the grabber without a successful Escape.',
    }),
  },
  restrained: {
    name: 'Restrained',
    scaling: false,
    build: () => ({
      acBonus: -2,
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
  unconscious: {
    name: 'Unconscious',
    scaling: false,
    build: () => ({
      acBonus: -4,
      saveBonus: -4,
      skillBonus: -4,
      noAttack: true,
      description: 'Asleep or knocked out. Cannot act. -4 status penalty to AC, Perception, and Reflex saves. Blinded and Off-Guard. Falls prone, drops items.',
    }),
  },
  slowed: {
    name: 'Slowed',
    scaling: true,
    build: (value) => ({
      description: `Lose ${value} action${value === 1 ? '' : 's'} at the start of each turn.`,
    }),
  },
  stunned: {
    name: 'Stunned',
    scaling: true,
    build: (value) => ({
      description: `Lose ${value} action${value === 1 ? '' : 's'} this turn. After actions are lost, reduce stunned by the same amount. (If stunned has a duration, ignore that and just track the value.)`,
    }),
  },

  // ── Dying / Wounded / Doomed (managed automatically) ────────────────────
  // Dying, Wounded, and Doomed are PF2e conditions that the bot now manages
  // automatically through combatAutomation.applyDamage / applyHealing /
  // rollRecoveryCheck. We still expose them as presets so GMs can inspect
  // or manually adjust them via /init effect.
  dying: {
    name: 'Dying',
    scaling: true,
    build: (value) => ({
      description: `Unconscious and at 0 HP. Dying ${value}. Rolls a DC ${10 + value} recovery flat check at start of turn. Reaches Dying 4 (or 4 - doomed value) = dead.`,
    }),
  },
  wounded: {
    name: 'Wounded',
    scaling: true,
    build: (value) => ({
      description: `Previously brought to 0 HP. When brought to 0 HP again, start at Dying ${1 + value} instead of Dying 1. Failed recovery checks also add ${value} to dying.`,
    }),
  },
  doomed: {
    name: 'Doomed',
    scaling: true,
    build: (value) => ({
      description: `Death is closer. Maximum dying value reduced by ${value} — you die at Dying ${Math.max(1, 4 - value)} instead of Dying 4. Decreases by 1 per full night's rest. Apply with: /init dying-set name:X (use the dying subcommand to track).`,
    }),
  },

  // ── Persistent damage (new) ──────────────────────────────────────────────
  // These are special: they have a `kind: 'persistent-damage'` flag and are
  // rolled at end of turn by combatAutomation.tickPersistentDamage.
  // Use /init effect name:persistent-fire value:1 to apply 1d6 fire per turn.
  // The value parameter is treated as number of d6s (so value=2 → 2d6).
  'persistent-fire': {
    name: 'Persistent damage (fire)',
    scaling: true,
    build: (value) => ({
      kind: 'persistent-damage',
      dice: `${value}d6`,
      damageType: 'fire',
      dc: 15,
      description: `Takes ${value}d6 fire damage at end of each turn. DC 15 flat check to end.`,
    }),
  },
  'persistent-bleed': {
    name: 'Persistent damage (bleed)',
    scaling: true,
    build: (value) => ({
      kind: 'persistent-damage',
      dice: `${value}d6`,
      damageType: 'bleed',
      dc: 15,
      description: `Takes ${value}d6 bleed damage at end of each turn. DC 15 flat check to end.`,
    }),
  },
  'persistent-acid': {
    name: 'Persistent damage (acid)',
    scaling: true,
    build: (value) => ({
      kind: 'persistent-damage',
      dice: `${value}d6`,
      damageType: 'acid',
      dc: 15,
      description: `Takes ${value}d6 acid damage at end of each turn. DC 15 flat check to end.`,
    }),
  },
  'persistent-electricity': {
    name: 'Persistent damage (electricity)',
    scaling: true,
    build: (value) => ({
      kind: 'persistent-damage',
      dice: `${value}d6`,
      damageType: 'electricity',
      dc: 15,
      description: `Takes ${value}d6 electricity damage at end of each turn. DC 15 flat check to end.`,
    }),
  },
  'persistent-cold': {
    name: 'Persistent damage (cold)',
    scaling: true,
    build: (value) => ({
      kind: 'persistent-damage',
      dice: `${value}d6`,
      damageType: 'cold',
      dc: 15,
      description: `Takes ${value}d6 cold damage at end of each turn. DC 15 flat check to end.`,
    }),
  },
  'persistent-poison': {
    name: 'Persistent damage (poison)',
    scaling: true,
    build: (value) => ({
      kind: 'persistent-damage',
      dice: `${value}d6`,
      damageType: 'poison',
      dc: 15,
      description: `Takes ${value}d6 poison damage at end of each turn. DC 15 flat check to end.`,
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
    scaling: true,
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
    'persistent-damage': 'persistent-fire',
    'bleeding': 'persistent-bleed',
    'burning': 'persistent-fire',
    'on-fire': 'persistent-fire',
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