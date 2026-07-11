// @pathway/core — Specific familiars (Player Core 2 pg. 170 + expansions).
//
// RULES SOURCE (non-negotiable per CLAUDE.md): implemented from the rules text
// in docs/rules-sources/specific-familiars.md, supplied by the project owner.
// "Any character can gain a specific familiar so long as they already have a
// familiar with at least the required number of abilities listed in the
// specific familiar's stat block. … The granted abilities entry lists normal
// familiar and master abilities that familiar has. The familiar also gains
// unique abilities listed below the granted abilities entry. … you can never
// swap out any of these granted or unique abilities. If your familiar gains
// more abilities than the required number of abilities, you can use the
// remaining abilities to select additional familiar and master abilities as
// normal."

export interface SpecificFamiliarAbility {
  name: string;
  /** Action cost as printed, e.g. "1a", "2a", "R" (reaction); absent = passive. */
  actions?: string;
  description: string;
}

export interface SpecificFamiliar {
  slug: string;
  name: string;
  /** Creature traits as printed (construct, dragon, undead, …). */
  traits: string[];
  rarity?: 'uncommon' | 'rare' | 'unique';
  access?: string;
  /** Minimum number of familiar abilities needed to adopt this familiar. */
  requiredAbilities: number;
  /**
   * Granted familiar/master abilities, as printed (may carry qualifiers like
   * "skilled (arcana, society)"). Innate — they can never be swapped out.
   * Use `grantedAbilitySlug` to map an entry onto FAMILIAR_ABILITIES.
   */
  grantedAbilities: string[];
  uniqueAbilities: SpecificFamiliarAbility[];
  source: string;
}

/**
 * Best-effort mapping from a granted-ability entry ("manual dexterity",
 * "skilled (arcana, society)") to a FAMILIAR_ABILITIES slug ("manual-dexterity",
 * "skilled"). Qualifiers in parentheses are dropped.
 */
export function grantedAbilitySlug(entry: string): string {
  return entry
    .replace(/\(.*?\)/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const SPECIFIC_FAMILIARS: SpecificFamiliar[] = [
  {
    slug: 'aeon-wyrd',
    name: 'Aeon Wyrd',
    traits: ['construct'],
    requiredAbilities: 3,
    grantedAbilities: ['construct', 'flier'],
    uniqueAbilities: [
      { name: 'Aeon Stone Reservoir', description: "Can house any aeon stone as its nucleus: you gain the stone's benefits without investing it, plus its resonant power. Doesn't interfere with an invested wayfinder." },
      { name: "Can't Walk", description: 'It has no land Speed.' },
      { name: 'Crystalline', description: 'Weakness to sonic equal to your level.' },
    ],
    source: 'Player Core 2',
  },
  {
    slug: 'calligraphy-wyrm',
    name: 'Calligraphy Wyrm',
    traits: ['dragon'],
    rarity: 'uncommon',
    access: 'Affiliation with Cobyslarni or the Pathfinder Society',
    requiredAbilities: 6,
    grantedAbilities: ['darkvision', 'flier', 'manual dexterity', 'scent', 'skilled (arcana, society)', 'speech'],
    uniqueAbilities: [
      { name: 'Ink Spray', actions: '1a', description: "Once per 10 minutes: splatters ink in a 10-foot cone; Reflex save vs your spell or class DC (higher). Failure: if invisible, concealed instead, for 1 minute (crit failure: 10 minutes, plus blinded 1 round or until wiped with an Interact)." },
      { name: 'Stylus Claws', description: 'Stylus-shaped claws filled with natural ink; it can write without purchased ink.' },
    ],
    source: 'Rival Academies',
  },
  {
    slug: 'ceru',
    name: 'Ceru',
    traits: ['beast'],
    requiredAbilities: 4,
    grantedAbilities: ['cantrip connection (guidance, mage hand)', 'darkvision', 'touch telepathy'],
    uniqueAbilities: [
      { name: 'Created Magic', description: 'Grants mage hand and guidance via cantrip connection; replace off-list cantrips with ones from your spell list.' },
      { name: 'Turn of Fate', actions: '2a', description: "Once per day, range 30 feet: shift one target's next attack roll, save, or skill check. Bad fortune: Will save vs your class/spell DC — failure: roll twice, take the worse (misfortune); crit failure: for the next three attempts. Good fortune: roll twice, take the better. Immune 1 day after." },
    ],
    source: 'Impossible Lands',
  },
  {
    slug: 'clockwork-familiar',
    name: 'Clockwork Familiar',
    traits: ['clockwork', 'construct'],
    rarity: 'uncommon',
    requiredAbilities: 3,
    grantedAbilities: ['darkvision'],
    uniqueAbilities: [
      { name: 'Clockwork', description: 'Must be wound (1 minute) for 24 hours of operation; enemies can Disable a Device (standard DC for your level) to drain 1 hour (2 on a crit). Winding anytime restores to 24 hours.' },
      { name: 'Constructed', description: 'Immune to bleed, death effects, disease, doomed, drained, fatigued, healing, necromancy, nonlethal attacks, paralyzed, poison, sickened, unconscious. HP recovered only via Repair; destroyed at 0 HP.' },
      { name: 'Electricity Vulnerability', description: 'Weakness to electricity equal to your level.' },
      { name: 'Steam Screen', actions: '1a', description: 'Once per minute (costs 1 hour of operational time): +1 circumstance to its Intimidation; its square grants concealment (unusable to Hide/Sneak) for 1 round.' },
      { name: 'Toggle Standby Mode', actions: '2a', description: "Standby: operational time doesn't drain; senses at –2 Perception; can't act until Commanded out." },
    ],
    source: 'Grand Bazaar',
  },
  {
    slug: 'crawling-hand',
    name: 'Crawling Hand',
    traits: ['undead'],
    requiredAbilities: 5,
    grantedAbilities: ['manual dexterity', 'spell delivery', 'valet'],
    uniqueAbilities: [
      { name: 'Lend a Hand', description: 'Gains 1 reaction per turn usable only to Aid an attack roll by an ally sharing its space; the Aid automatically succeeds.' },
      { name: 'Undead', description: 'Negative healing; immune to death effects, disease, poison, unconscious. Destroyed at 0 HP.' },
    ],
    source: 'Book of the Dead',
  },
  {
    slug: 'cullitox-shardling',
    name: 'Cullitox Shardling',
    traits: ['earth', 'elemental'],
    requiredAbilities: 3,
    grantedAbilities: ['burrower', 'elemental (earth only)', 'speech'],
    uniqueAbilities: [
      { name: 'Crystal Scent', description: 'Senses crystals or gems within 60 feet as if using scent.' },
    ],
    source: 'Rage of Elements',
  },
  {
    slug: 'dweomercat-cub',
    name: 'Dweomercat Cub',
    traits: ['beast'],
    requiredAbilities: 4,
    grantedAbilities: ['darkvision', 'scent', 'speech'],
    uniqueAbilities: [
      { name: 'Alter Dweomer', actions: '1a', description: 'Once per 10 minutes, after being targeted by or caught in a spell: gains an effect by the school (abjuration +1 AC; conjuration 5-ft fog burst; divination +1 skills; enchantment +1 saves; evocation 1d6 force per 2 levels to the caster, basic Reflex vs your class/spell DC; illusion invisibility; necromancy temp HP = your level; transmutation +1 attacks) for 1d4 rounds.' },
      { name: 'Detect Magic', description: 'Casts 1st-level detect magic as an arcane innate spell.' },
    ],
    source: 'PFS Guide',
  },
  {
    slug: 'elemental-scamp',
    name: 'Elemental Scamp',
    traits: ['elemental'],
    requiredAbilities: 5,
    grantedAbilities: ['elemental', 'flier', 'speech'],
    uniqueAbilities: [
      { name: 'Elemental Breath', actions: '2a', description: 'Once per hour: 10-foot cone, 1d6 damage per 2 levels you have, basic Reflex vs your class/spell DC. Damage type by element.' },
      { name: 'Elemental Mobility', description: 'Air: flier; earth: burrower; fire: jet; metal: levitator; water: amphibious; wood: climber.' },
      { name: 'Scamp Elements', description: 'Element fixed at selection: air slashing; earth bludgeoning; fire fire; metal slashing; water acid; wood (plant + wood) poison.' },
    ],
    source: 'Rage of Elements',
  },
  {
    slug: 'elemental-wisp',
    name: 'Elemental Wisp',
    traits: ['elemental'],
    requiredAbilities: 3,
    grantedAbilities: ['accompanist', 'elemental', 'speech'],
    uniqueAbilities: [
      { name: 'Elemental Mobility', description: 'Air: flier; earth: burrower; fire: jet; metal: levitator; water: amphibious; wood: climber.' },
      { name: 'Innate Element', description: 'Element fixed when you gain the familiar.' },
      { name: 'Resonance', description: "Aura, 30 feet: creatures gain +1 status to damage rolls for alchemical/magical effects sharing the wisp's elemental trait (wood also covers plant)." },
    ],
    source: 'Rage of Elements',
  },
  {
    slug: 'fey-dragonet',
    name: 'Fey Dragonet',
    traits: ['dragon'],
    requiredAbilities: 5,
    grantedAbilities: ['darkvision', 'flier', 'manual dexterity', 'speech', 'touch telepathy'],
    uniqueAbilities: [
      { name: 'Euphoric Breath', actions: '2a', description: 'Once per hour (arcane, poison): 10-foot cone; Fortitude vs your class/spell DC; failure: stupefied 2 and slowed 1 for 1d4 rounds (crit failure: 1 minute).' },
    ],
    source: 'Player Core 2',
  },
  {
    slug: 'gennayn',
    name: 'Gennayn',
    traits: ['elemental'],
    requiredAbilities: 5,
    grantedAbilities: ['elemental', 'speech'],
    uniqueAbilities: [
      { name: 'Elemental Diplomat', description: 'Its Diplomacy modifier is your level + your key spellcasting attribute; +1 circumstance vs elementals, shared with you in the same space.' },
      { name: 'Elemental Mobility', description: 'Air: flier; earth: burrower; fire: jet; metal: levitator; water: amphibious; wood: climber.' },
      { name: 'Little Wish', actions: 'R', description: 'Once per day (fortune): a creature within 60 feet rerolls a saving throw or skill check.' },
    ],
    source: 'Rage of Elements',
  },
  {
    slug: 'golden-ermine',
    name: 'Golden Ermine',
    traits: ['beast'],
    access: "You're from Hermea",
    requiredAbilities: 4,
    grantedAbilities: ['climber', 'darkvision', 'touch telepathy', 'valet'],
    uniqueAbilities: [
      { name: 'Gold Scent', description: 'Imprecise 30-foot sense that smells objects made of gold.' },
      { name: 'Twinkle Tail', actions: '1a', description: 'Once per day (concentrate, fortune): a willing target within 30 feet rolls its next attack roll or save twice and takes the higher (chosen before rolling; fades after 1 minute).' },
    ],
    source: 'High Seas',
  },
  {
    slug: 'grindle-drake',
    name: 'Grindle-Drake',
    traits: [],
    rarity: 'rare',
    access: "You're from the Five Kings Mountains",
    requiredAbilities: 4,
    grantedAbilities: ['darkvision', 'skilled (perception, survival)', 'touch telepathy'],
    uniqueAbilities: [
      { name: 'Forage', actions: '2a', description: 'Once per 10 minutes (concentrate, manipulate): recovers HP equal to half your level.' },
      { name: 'Sure and Steady', actions: '2a', description: 'With all six legs on ground/stone (concentrate, detection, primal): learns whether the surface in a 10-foot emanation is enchanted, hollow, treacherous, or otherwise not as it appears, shared via touch telepathy.' },
    ],
    source: 'Shining Kingdoms',
  },
  {
    slug: 'homunculus',
    name: 'Homunculus',
    traits: ['construct'],
    requiredAbilities: 6,
    grantedAbilities: ['construct', 'darkvision', 'manual dexterity', 'poison reservoir'],
    uniqueAbilities: [
      { name: 'Blood Link', description: "Telepathic link at 1,500 feet (mental), sharing knowledge and everything it hears. If you're unconscious and dying it acts as if Commanded. If destroyed, you take 2d10 mental damage." },
      { name: 'Porter', description: 'Choose item delivery or valet.' },
    ],
    source: 'Player Core 2',
  },
  {
    slug: 'house-drake',
    name: 'House Drake',
    traits: ['dragon'],
    rarity: 'uncommon',
    requiredAbilities: 6,
    grantedAbilities: ['darkvision', 'flier', 'manual dexterity', 'speech'],
    uniqueAbilities: [
      { name: 'Breath Weapon', actions: '1a', description: '10-foot cone of silver mist (arcane, conjuration, mental); Will vs your class/spell DC; failure: stupefied 2 for 1 round. Locks Breath Weapon/Silver Infusion for 1d4 rounds.' },
      { name: 'Silver Infusion', actions: '2a', description: 'One of your weapons counts as silver until the start of your next turn (shares the 1d4-round lockout).' },
      { name: 'Tenacious Mind', description: 'Once per day, if the drake took no actions last round: Ferocious Will (reaction) — on your successful save vs a magical mental effect, its source takes 2d6 mental (basic Will vs your class/spell DC; failure also slowed 1).' },
    ],
    source: 'Shadows at Sundown',
  },
  {
    slug: 'imp',
    name: 'Imp',
    traits: ['fiend', 'unholy'],
    requiredAbilities: 7,
    grantedAbilities: ['darkvision', 'flier', 'manual dexterity', 'resistance (poison)', 'skilled (deception)', 'speech', 'touch telepathy'],
    uniqueAbilities: [
      { name: 'Fiendish Temptation', actions: '1a', description: "Once per day (concentrate, divine, fortune, unholy): offers a non-fiend within 15 feet a 1-hour boon — once, roll an attack or save twice and take the higher. If the creature dies during the boon, the imp decides where its soul goes (blocked from raise/resurrection short of wish)." },
      { name: 'Imp Invisibility', description: 'Once per hour, casts invisibility on itself as a divine innate spell.' },
    ],
    source: 'Player Core 2',
  },
  {
    slug: 'kinnars',
    name: 'Kinnars',
    traits: ['celestial'],
    rarity: 'uncommon',
    requiredAbilities: 6,
    grantedAbilities: ['darkvision', 'independent', 'lifelink', 'manual dexterity', 'speech'],
    uniqueAbilities: [
      { name: 'Dazzling Show', actions: '2a', description: 'Once per minute: 30-foot emanation; Will vs your class/spell DC or dazzled 2 rounds.' },
      { name: 'Soul Bond', description: 'The pair counts as a single creature; vs mental effects with a save, roll twice and take the higher (fortune).' },
      { name: 'Vina Song', actions: '2a', description: 'Once per hour: 30-foot emanation; Will or fascinated 1 round, sustainable each round for further saves. A success or broken fascination grants 24-hour immunity.' },
    ],
    source: 'Tian Xia Character Guide',
  },
  {
    slug: 'lantern-wisp',
    name: 'Lantern Wisp',
    traits: ['construct'],
    requiredAbilities: 6,
    grantedAbilities: ['construct', 'flier', 'kindling', 'resistance (fire and cold)', 'tough'],
    uniqueAbilities: [
      { name: 'Stunning Flare', actions: '1a', description: 'Once per 10 minutes: 15-foot emanation; Fortitude vs your class/spell DC or blinded 1 round, then dazzled 2 rounds.' },
    ],
    source: 'Tian Xia Character Guide',
  },
  {
    slug: 'makhluk-wayang',
    name: 'Makhluk Wayang',
    traits: ['construct'],
    requiredAbilities: 8,
    grantedAbilities: ['construct', 'manual dexterity', 'play dead', 'speech', 'tough', 'versatile form'],
    uniqueAbilities: [
      { name: 'Shadow Projection', actions: '1a', description: 'Projects a larger silhouette: reach 10 feet for non-hostile Interact actions until the end of your turn.' },
    ],
    source: 'Tian Xia Character Guide',
  },
  {
    slug: 'mockingfey',
    name: 'Mockingfey',
    traits: ['fey'],
    rarity: 'uncommon',
    requiredAbilities: 4,
    grantedAbilities: ['flier', 'independent', 'speech'],
    uniqueAbilities: [
      { name: 'Gibe', actions: '1a', description: 'Once per round (concentrate, illusion, mental, occult, visual): mocks a creature within 60 feet; Will vs your class/spell DC; failure: off-guard until the start of your next turn (crit failure: until the end of it). Immune 1 minute after.' },
    ],
    source: 'Rival Academies',
  },
  {
    slug: 'mood-cloud',
    name: 'Mood Cloud',
    traits: ['air', 'elemental'],
    requiredAbilities: 3,
    grantedAbilities: ['elemental (air only)', 'flier'],
    uniqueAbilities: [
      { name: 'Emote', actions: '1a', description: "Once per round: prepares to Aid you on Deception, Diplomacy, or Intimidation (by expression), gaining a reaction only for that Aid; auto-success (crit if you're a master)." },
    ],
    source: 'Rage of Elements',
  },
  {
    slug: 'nosoi',
    name: 'Nosoi',
    traits: ['monitor', 'psychopomp'],
    requiredAbilities: 5,
    grantedAbilities: ['darkvision', 'flier', 'manual dexterity', 'speech'],
    uniqueAbilities: [
      { name: 'Haunting Melody', actions: '2a', description: 'Once per hour (auditory, concentrate, divine, enchantment, incapacitation, mental): 60-foot emanation; Will vs your class/spell DC or fascinated 1 round, sustainable. Affects mindless undead; psychopomps immune; success/broken = immune 24 hours.' },
      { name: 'Nosoi Resistance', description: 'Resistance to negative and poison equal to half your level.' },
    ],
    source: 'Grand Bazaar',
  },
  {
    slug: 'old-friend',
    name: 'Old Friend',
    traits: ['incorporeal', 'spirit', 'undead'],
    requiredAbilities: 4,
    grantedAbilities: ['flier'],
    uniqueAbilities: [
      { name: 'Anchored Incorporeality', description: 'Incorporeal but bound within 60 feet (line of effect) of an anchor item; no resistance-to-all or precision immunity. The anchor is transferable via a 1-week ritual.' },
      { name: 'Invisibility', description: 'Once per hour, casts 2nd-level invisibility on itself as a divine innate spell.' },
      { name: 'Undead', description: 'Negative healing; immune to death effects, disease, poison, unconscious. Destroyed at 0 HP.' },
    ],
    source: 'Book of the Dead',
  },
  {
    slug: 'pipefox',
    name: 'Pipefox',
    traits: ['beast'],
    requiredAbilities: 5,
    grantedAbilities: ['climber', 'darkvision', 'second opinion', 'skilled (one skill of your choice)', 'speech'],
    uniqueAbilities: [
      { name: 'Scholarly Linguist', description: "Speaks and understands all languages you know, plus one common language you don't." },
    ],
    source: 'Player Core 2',
  },
  {
    slug: 'polong',
    name: 'Polong',
    traits: ['incorporeal', 'undead'],
    requiredAbilities: 8,
    grantedAbilities: ['flier', 'lifelink', 'skilled (society)', 'speech', 'spellcasting'],
    uniqueAbilities: [
      { name: 'Anchored Incorporeality', description: "As Old Friend, but the anchor must be a bottle. It dies if the bottle is destroyed or it isn't fed its master's blood daily." },
      { name: 'Polong Possession', actions: '2a', description: 'Adjacent corporeal creature (incapacitation, mental, necromancy, occult, possession): Will vs your class/spell DC; failure: merged for 1 minute (crit failure: 24 hours), observing through its senses; target is drained 1. Ignores anchor range while possessing.' },
      { name: 'Undead', description: 'Negative healing; immune to death effects, disease, poison, unconscious. Destroyed at 0 HP.' },
    ],
    source: 'Book of the Dead',
  },
  {
    slug: 'poppet',
    name: 'Poppet',
    traits: ['construct'],
    requiredAbilities: 1,
    grantedAbilities: ['construct'],
    uniqueAbilities: [
      { name: 'Flammable', description: 'Weakness to fire equal to your level. You can spend one familiar ability to remove the weakness for the day.' },
    ],
    source: 'Player Core 2',
  },
  {
    slug: 'royal-gull',
    name: 'Royal Gull',
    traits: ['beast'],
    access: "You're from Hermea",
    requiredAbilities: 2,
    grantedAbilities: ['flier', 'speech'],
    uniqueAbilities: [
      { name: 'Fascinating Flutter', actions: '2a', description: 'Once per hour (illusion, manipulate, visual): 10-foot cone of iridescent dust; Will vs your class/spell DC; failure: dazzled 1 round (crit failure: 1 minute).' },
    ],
    source: 'High Seas',
  },
  {
    slug: 'shadow-familiar',
    name: 'Shadow Familiar',
    traits: ['shadow'],
    rarity: 'uncommon',
    access: "You're a shadowcaster",
    requiredAbilities: 7,
    grantedAbilities: ['darkvision', 'manual dexterity', "master's form", 'resistance (cold and negative)', 'shadow step'],
    uniqueAbilities: [
      { name: 'Become Shadow', actions: '1a', description: "Barely tangible shadow: resistance to all damage except force equal to half your level; can't take physical-form actions; slips through 2-inch gaps (1-inch Squeezing). Toggleable." },
      { name: 'Slink In Shadows', description: "Can Hide or end its Sneak in a creature's or object's shadow." },
      { name: 'Steal Shadow', actions: '1a', description: 'Once per 10 minutes (necromancy): melee attack at your spell attack modifier; on a hit, the target is enfeebled 1 and loses its shadow for 24 hours.' },
    ],
    source: 'Secrets of Magic',
  },
  {
    slug: 'shikigami',
    name: 'Shikigami',
    traits: ['construct'],
    requiredAbilities: 6,
    grantedAbilities: ['construct', 'flier', 'kindling', 'play dead', 'tough', 'versatile form'],
    uniqueAbilities: [
      { name: 'Flatten', description: 'Fits through paper-width gaps without Squeezing.' },
      { name: 'Mass-Produced', description: 'If it dies, rebind its spirit to another paper doll at your next daily preparations.' },
      { name: 'Seal-Bearer', description: "Daily, inscribe an element seal (air/earth/fire/metal/water/wood); its kindling ability applies to that element's trait instead of only fire." },
    ],
    source: 'Tian Xia Character Guide',
  },
  {
    slug: 'spellslime',
    name: 'Spellslime',
    traits: ['ooze'],
    requiredAbilities: 4,
    access: 'You must be able to cast spells using spell slots',
    grantedAbilities: ['climber', 'darkvision', 'tough'],
    uniqueAbilities: [
      { name: 'Magic Scent', description: 'Imprecise 30-foot sense that smells magic of your own tradition.' },
      { name: 'Ooze Defense', description: 'Immune to critical hits and precision damage, but its AC is only 10 + your level.' },
      { name: 'Slime Rejuvenation', description: 'Focused rejuvenation at 2 HP per level when you Refocus.' },
    ],
    source: 'Player Core 2',
  },
  {
    slug: 'spirit-guide',
    name: 'Spirit Guide',
    traits: ['beast', 'spirit'],
    rarity: 'rare',
    requiredAbilities: 3,
    grantedAbilities: ['independent', 'lifelink', 'speech'],
    uniqueAbilities: [
      { name: 'Bound to Mortal', description: '+10 Hit Points, and a jaws (1d6 piercing, brawling) or claws (1d4 slashing, agile, brawling) unarmed attack at your normal melee attack bonus (chosen when gained).' },
      { name: 'Spiritual Recall', actions: 'R', description: 'Once per day (magical, occult), when an attack would reduce it to 0 HP: it survives at 1 HP and becomes incorporeal until the end of your next turn.' },
    ],
    source: 'Gatewalkers',
  },
  {
    slug: 'sweet-beast-chocolate-mouse',
    name: 'Sweet Beast (Chocolate Mouse)',
    traits: ['beast'],
    rarity: 'uncommon',
    requiredAbilities: 3,
    grantedAbilities: ['fast movement', 'scent'],
    uniqueAbilities: [
      { name: 'Sorcerous Sweets', description: 'During daily preparations, turns a small object into a candy (arcane, consumable, transmutation). Eating it (Interact) grants +1 item bonus to Deception, Diplomacy, and Performance for 1 hour (+2 at level 9, +3 at 17). Lasts until your next daily preparations.' },
    ],
    source: 'Wake the Dead #3',
  },
  {
    slug: 'sweet-beast-gingerbread-sparrow',
    name: 'Sweet Beast (Gingerbread Sparrow)',
    traits: ['beast'],
    rarity: 'uncommon',
    requiredAbilities: 3,
    grantedAbilities: ['flier', 'independent'],
    uniqueAbilities: [
      { name: 'Sorcerous Sweets', description: 'As the chocolate mouse.' },
    ],
    source: 'Wake the Dead #3',
  },
  {
    slug: 'sweet-beast-hard-candy-beetle',
    name: 'Sweet Beast (Hard Candy Beetle)',
    traits: ['beast'],
    rarity: 'uncommon',
    requiredAbilities: 3,
    grantedAbilities: ['burrower', 'tremorsense'],
    uniqueAbilities: [
      { name: 'Sorcerous Sweets', description: 'As the chocolate mouse.' },
    ],
    source: 'Wake the Dead #3',
  },
  {
    slug: 'talking-head',
    name: 'Talking Head',
    traits: ['undead'],
    requiredAbilities: 3,
    grantedAbilities: ['cantrip connection', 'skilled (arcana, occultism, or one lore)', 'speech'],
    uniqueAbilities: [
      { name: 'Heads Will Roll', description: 'Without flier it can only roll along the ground at Speed 15 feet. A creature can kick or throw it 30 feet as a single action (never as an attack).' },
      { name: 'Undead', description: 'Negative healing; immune to death effects, disease, poison, unconscious. Destroyed at 0 HP.' },
    ],
    source: 'Book of the Dead',
  },
  {
    slug: 'tapir-sage',
    name: 'Tapir Sage',
    traits: ['beast'],
    rarity: 'uncommon',
    requiredAbilities: 6,
    grantedAbilities: ['darkvision', 'kinspeech', 'speech', 'toolbearer', 'valet'],
    uniqueAbilities: [
      { name: 'Pot of Tea', description: 'Once per day, brews for 10 uninterrupted minutes; serves three infusions in order (2 cups each: an adjacent ally + itself), good for 1 hour. First (2a): heal 1d8 × half your level (min 1d8) + +4 circumstance vs the next disease/poison save in 24 hours. Second (2a): heal 1d4 × half your level + +2 circumstance. Third (2a): temp HP equal to your level for 1 hour.' },
    ],
    source: 'Tian Xia Character Guide',
  },
  {
    slug: 'wildtwig',
    name: 'Wildtwig',
    traits: ['beast'],
    access: "You're from Hermea",
    requiredAbilities: 6,
    grantedAbilities: ['darkvision', 'plant', 'plant form', 'resistance (poison)', 'speech', 'tough'],
    uniqueAbilities: [
      { name: 'Fruity Ambrosia', description: "Its horn-grown peach (fresh 8 hours once picked; healing) grants the eater temp HP equal to their level for 1 hour (Interact). A second fruit within an hour instead sickens 1 for 10 minutes. Regrowing takes 10 focused minutes." },
    ],
    source: 'High Seas',
  },
];

export function findSpecificFamiliar(slug: string | null | undefined): SpecificFamiliar | undefined {
  if (!slug) return undefined;
  const s = slug.toLowerCase();
  return SPECIFIC_FAMILIARS.find((f) => f.slug === s);
}
