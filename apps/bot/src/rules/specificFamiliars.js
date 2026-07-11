// Specific familiars — compact display data for the Discord embeds.
//
// ⚠️ MIRROR of @pathway/core's specificFamiliars.ts (see companionScaling.js
// for why the bot can't require core). This carries only what the embed shows:
// the required-ability count, the innate granted abilities, and the unique
// ability NAMES. Full unique-ability descriptions live in packages/core and on
// the website — the sheet footer points players there. If you add or rename a
// specific familiar in core, mirror it here.
//
// Generated from packages/core/src/specificFamiliars.ts; keep in sync.

const SPECIFIC_FAMILIARS = [
  { slug: 'aeon-wyrd', name: "Aeon Wyrd", required: 3, granted: ["construct","flier"], unique: ["Aeon Stone Reservoir","Can't Walk","Crystalline"], source: "Player Core 2" },
  { slug: 'calligraphy-wyrm', name: "Calligraphy Wyrm", required: 6, granted: ["darkvision","flier","manual dexterity","scent","skilled (arcana, society)","speech"], unique: ["Ink Spray","Stylus Claws"], source: "Rival Academies", rarity: 'uncommon', access: "Affiliation with Cobyslarni or the Pathfinder Society" },
  { slug: 'ceru', name: "Ceru", required: 4, granted: ["cantrip connection (guidance, mage hand)","darkvision","touch telepathy"], unique: ["Created Magic","Turn of Fate"], source: "Impossible Lands" },
  { slug: 'clockwork-familiar', name: "Clockwork Familiar", required: 3, granted: ["darkvision"], unique: ["Clockwork","Constructed","Electricity Vulnerability","Steam Screen","Toggle Standby Mode"], source: "Grand Bazaar", rarity: 'uncommon' },
  { slug: 'crawling-hand', name: "Crawling Hand", required: 5, granted: ["manual dexterity","spell delivery","valet"], unique: ["Lend a Hand","Undead"], source: "Book of the Dead" },
  { slug: 'cullitox-shardling', name: "Cullitox Shardling", required: 3, granted: ["burrower","elemental (earth only)","speech"], unique: ["Crystal Scent"], source: "Rage of Elements" },
  { slug: 'dweomercat-cub', name: "Dweomercat Cub", required: 4, granted: ["darkvision","scent","speech"], unique: ["Alter Dweomer","Detect Magic"], source: "PFS Guide" },
  { slug: 'elemental-scamp', name: "Elemental Scamp", required: 5, granted: ["elemental","flier","speech"], unique: ["Elemental Breath","Elemental Mobility","Scamp Elements"], source: "Rage of Elements" },
  { slug: 'elemental-wisp', name: "Elemental Wisp", required: 3, granted: ["accompanist","elemental","speech"], unique: ["Elemental Mobility","Innate Element","Resonance"], source: "Rage of Elements" },
  { slug: 'fey-dragonet', name: "Fey Dragonet", required: 5, granted: ["darkvision","flier","manual dexterity","speech","touch telepathy"], unique: ["Euphoric Breath"], source: "Player Core 2" },
  { slug: 'gennayn', name: "Gennayn", required: 5, granted: ["elemental","speech"], unique: ["Elemental Diplomat","Elemental Mobility","Little Wish"], source: "Rage of Elements" },
  { slug: 'golden-ermine', name: "Golden Ermine", required: 4, granted: ["climber","darkvision","touch telepathy","valet"], unique: ["Gold Scent","Twinkle Tail"], source: "High Seas", access: "You're from Hermea" },
  { slug: 'grindle-drake', name: "Grindle-Drake", required: 4, granted: ["darkvision","skilled (perception, survival)","touch telepathy"], unique: ["Forage","Sure and Steady"], source: "Shining Kingdoms", rarity: 'rare', access: "You're from the Five Kings Mountains" },
  { slug: 'homunculus', name: "Homunculus", required: 6, granted: ["construct","darkvision","manual dexterity","poison reservoir"], unique: ["Blood Link","Porter"], source: "Player Core 2" },
  { slug: 'house-drake', name: "House Drake", required: 6, granted: ["darkvision","flier","manual dexterity","speech"], unique: ["Breath Weapon","Silver Infusion","Tenacious Mind"], source: "Shadows at Sundown", rarity: 'uncommon' },
  { slug: 'imp', name: "Imp", required: 7, granted: ["darkvision","flier","manual dexterity","resistance (poison)","skilled (deception)","speech","touch telepathy"], unique: ["Fiendish Temptation","Imp Invisibility"], source: "Player Core 2" },
  { slug: 'kinnars', name: "Kinnars", required: 6, granted: ["darkvision","independent","lifelink","manual dexterity","speech"], unique: ["Dazzling Show","Soul Bond","Vina Song"], source: "Tian Xia Character Guide", rarity: 'uncommon' },
  { slug: 'lantern-wisp', name: "Lantern Wisp", required: 6, granted: ["construct","flier","kindling","resistance (fire and cold)","tough"], unique: ["Stunning Flare"], source: "Tian Xia Character Guide" },
  { slug: 'makhluk-wayang', name: "Makhluk Wayang", required: 8, granted: ["construct","manual dexterity","play dead","speech","tough","versatile form"], unique: ["Shadow Projection"], source: "Tian Xia Character Guide" },
  { slug: 'mockingfey', name: "Mockingfey", required: 4, granted: ["flier","independent","speech"], unique: ["Gibe"], source: "Rival Academies", rarity: 'uncommon' },
  { slug: 'mood-cloud', name: "Mood Cloud", required: 3, granted: ["elemental (air only)","flier"], unique: ["Emote"], source: "Rage of Elements" },
  { slug: 'nosoi', name: "Nosoi", required: 5, granted: ["darkvision","flier","manual dexterity","speech"], unique: ["Haunting Melody","Nosoi Resistance"], source: "Grand Bazaar" },
  { slug: 'old-friend', name: "Old Friend", required: 4, granted: ["flier"], unique: ["Anchored Incorporeality","Invisibility","Undead"], source: "Book of the Dead" },
  { slug: 'pipefox', name: "Pipefox", required: 5, granted: ["climber","darkvision","second opinion","skilled (one skill of your choice)","speech"], unique: ["Scholarly Linguist"], source: "Player Core 2" },
  { slug: 'polong', name: "Polong", required: 8, granted: ["flier","lifelink","skilled (society)","speech","spellcasting"], unique: ["Anchored Incorporeality","Polong Possession","Undead"], source: "Book of the Dead" },
  { slug: 'poppet', name: "Poppet", required: 1, granted: ["construct"], unique: ["Flammable"], source: "Player Core 2" },
  { slug: 'royal-gull', name: "Royal Gull", required: 2, granted: ["flier","speech"], unique: ["Fascinating Flutter"], source: "High Seas", access: "You're from Hermea" },
  { slug: 'shadow-familiar', name: "Shadow Familiar", required: 7, granted: ["darkvision","manual dexterity","master's form","resistance (cold and negative)","shadow step"], unique: ["Become Shadow","Slink In Shadows","Steal Shadow"], source: "Secrets of Magic", rarity: 'uncommon', access: "You're a shadowcaster" },
  { slug: 'shikigami', name: "Shikigami", required: 6, granted: ["construct","flier","kindling","play dead","tough","versatile form"], unique: ["Flatten","Mass-Produced","Seal-Bearer"], source: "Tian Xia Character Guide" },
  { slug: 'spellslime', name: "Spellslime", required: 4, granted: ["climber","darkvision","tough"], unique: ["Magic Scent","Ooze Defense","Slime Rejuvenation"], source: "Player Core 2", access: "You must be able to cast spells using spell slots" },
  { slug: 'spirit-guide', name: "Spirit Guide", required: 3, granted: ["independent","lifelink","speech"], unique: ["Bound to Mortal","Spiritual Recall"], source: "Gatewalkers", rarity: 'rare' },
  { slug: 'sweet-beast-chocolate-mouse', name: "Sweet Beast (Chocolate Mouse)", required: 3, granted: ["fast movement","scent"], unique: ["Sorcerous Sweets"], source: "Wake the Dead #3", rarity: 'uncommon' },
  { slug: 'sweet-beast-gingerbread-sparrow', name: "Sweet Beast (Gingerbread Sparrow)", required: 3, granted: ["flier","independent"], unique: ["Sorcerous Sweets"], source: "Wake the Dead #3", rarity: 'uncommon' },
  { slug: 'sweet-beast-hard-candy-beetle', name: "Sweet Beast (Hard Candy Beetle)", required: 3, granted: ["burrower","tremorsense"], unique: ["Sorcerous Sweets"], source: "Wake the Dead #3", rarity: 'uncommon' },
  { slug: 'talking-head', name: "Talking Head", required: 3, granted: ["cantrip connection","skilled (arcana, occultism, or one lore)","speech"], unique: ["Heads Will Roll","Undead"], source: "Book of the Dead" },
  { slug: 'tapir-sage', name: "Tapir Sage", required: 6, granted: ["darkvision","kinspeech","speech","toolbearer","valet"], unique: ["Pot of Tea"], source: "Tian Xia Character Guide", rarity: 'uncommon' },
  { slug: 'wildtwig', name: "Wildtwig", required: 6, granted: ["darkvision","plant","plant form","resistance (poison)","speech","tough"], unique: ["Fruity Ambrosia"], source: "High Seas", access: "You're from Hermea" },
];

function findSpecificFamiliar(slug) {
  if (!slug) return null;
  const s = String(slug).toLowerCase();
  return SPECIFIC_FAMILIARS.find((f) => f.slug === s) ?? null;
}

module.exports = { SPECIFIC_FAMILIARS, findSpecificFamiliar };
