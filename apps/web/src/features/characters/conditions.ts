/**
 * PF2e (Remaster) condition reference for the sheet's conditions tracker.
 *
 * Dying and Wounded are intentionally excluded — they have their own dedicated
 * columns (bot-synced) and steppers. Everything here is tracked in the
 * web-owned `overlay.web_edits.conditions` slot. `valued` conditions carry a
 * numeric value (Frightened 2); the rest are simple on/off.
 */
export interface ConditionDef {
  name: string;
  valued: boolean;
  summary: string;
}

export const PF2E_CONDITIONS: ConditionDef[] = [
  { name: 'Blinded', valued: false, summary: "Can't see; critically fail Perception checks relying on sight; off-guard." },
  { name: 'Clumsy', valued: true, summary: 'Penalty to Dexterity-based checks and AC equal to the value.' },
  { name: 'Concealed', valued: false, summary: 'Attackers must succeed at a DC 5 flat check to target you.' },
  { name: 'Confused', valued: false, summary: 'Attack randomly; off-guard; treat everyone as an enemy.' },
  { name: 'Controlled', valued: false, summary: 'Another creature dictates your actions.' },
  { name: 'Dazzled', valued: false, summary: 'All creatures are concealed to you.' },
  { name: 'Deafened', valued: false, summary: "Can't hear; critically fail Perception checks relying on hearing." },
  { name: 'Doomed', valued: true, summary: 'Your dying value needed to die is reduced by the doomed value.' },
  { name: 'Drained', valued: true, summary: 'Penalty to Constitution checks/DCs; lose HP equal to level × value.' },
  { name: 'Encumbered', valued: false, summary: 'Clumsy 1 and −10 ft Speed from carrying too much.' },
  { name: 'Enfeebled', valued: true, summary: 'Penalty to Strength-based checks and damage equal to the value.' },
  { name: 'Fascinated', valued: false, summary: '−2 to Perception and skill checks; can’t use concentrate actions unrelated to the subject.' },
  { name: 'Fatigued', valued: false, summary: '−1 to AC and saves; can’t use exploration activities while traveling.' },
  { name: 'Fleeing', valued: false, summary: 'Must spend each turn fleeing from the source.' },
  { name: 'Frightened', valued: true, summary: 'Status penalty to all checks and DCs equal to the value; decreases by 1 each turn.' },
  { name: 'Grabbed', valued: false, summary: 'Immobilized and off-guard; must check to Manipulate.' },
  { name: 'Hidden', valued: false, summary: 'Foes know your location but must succeed at a DC 11 flat check to target you.' },
  { name: 'Immobilized', valued: false, summary: "Can't move." },
  { name: 'Invisible', valued: false, summary: 'Undetected by others; they must Seek and succeed at a flat check.' },
  { name: 'Off-Guard', valued: false, summary: '−2 circumstance penalty to AC.' },
  { name: 'Paralyzed', valued: false, summary: 'Off-guard; can’t act except Recall Knowledge and purely mental actions.' },
  { name: 'Petrified', valued: false, summary: 'Turned to stone; unconscious and unaware.' },
  { name: 'Prone', valued: false, summary: 'Off-guard; −2 to attacks; must Crawl or Stand to move.' },
  { name: 'Quickened', valued: false, summary: 'Gain 1 extra action at the start of your turn.' },
  { name: 'Restrained', valued: false, summary: 'Immobilized and off-guard; can only use mental/one-handed actions.' },
  { name: 'Sickened', valued: true, summary: 'Status penalty to all checks and DCs equal to the value; can’t willingly ingest.' },
  { name: 'Slowed', valued: true, summary: 'Lose actions equal to the value at the start of your turn.' },
  { name: 'Stunned', valued: true, summary: 'Lose that many actions this turn (reduces slowed for the turn).' },
  { name: 'Stupefied', valued: true, summary: 'Penalty to mental checks/DCs; flat check to Cast a Spell.' },
  { name: 'Unconscious', valued: false, summary: 'Asleep or knocked out; off-guard, blinded, prone.' },
  { name: 'Undetected', valued: false, summary: 'Foes don’t know where you are; must guess and roll a flat check.' },
];

const BY_NAME = new Map(PF2E_CONDITIONS.map((c) => [c.name.toLowerCase(), c]));

export function conditionDef(name: string): ConditionDef | undefined {
  return BY_NAME.get(name.toLowerCase());
}

/** Is this a valued condition? Unknown names are treated as boolean. */
export function isValuedCondition(name: string): boolean {
  return conditionDef(name)?.valued ?? false;
}
