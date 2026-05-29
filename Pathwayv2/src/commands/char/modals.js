const characterState = require('../../state/characters');

const { computeCharMaxHp, MAX_CHARACTERS_PER_USER } = characterState;

function loadCharacters() {
  return characterState.getAll();
}

async function saveCharacters(data) {
  await characterState.saveAll(data);
}

function handles(interaction) {
  const id = interaction.customId ?? '';
  return id === 'char_create_modal'
    || id.startsWith('char_edit_modal:')
    || id.startsWith('char_identity_modal:')
    || id.startsWith('char_misc_modal:');
}

function createBlankCharacterData({ name, className, ancestry, heritage, level }) {
  const lvl = Math.max(1, Math.min(20, Number.parseInt(level, 10) || 1));
  const characterName = String(name ?? '').trim();
  return {
    name: characterName,
    class: String(className ?? '').trim() || 'Adventurer',
    dualClass: null,
    level: lvl,
    ancestry: String(ancestry ?? '').trim() || 'Unknown',
    heritage: String(heritage ?? '').trim() || '',
    background: '',
    alignment: 'N',
    gender: '',
    age: '',
    deity: '',
    size: 0,
    keyability: '',
    languages: ['Common'],
    attributes: {
      ancestryhp: 8,
      classhp: 8,
      bonushp: 0,
      bonushpPerLevel: 0,
      speed: 25,
      speedBonus: 0,
    },
    abilities: {
      str: 10,
      dex: 10,
      con: 10,
      int: 10,
      wis: 10,
      cha: 10,
      breakdown: { ancestryFree: [], ancestryBoosts: [], ancestryFlaws: [], backgroundBoosts: [], classBoosts: [], mapLevelledBoosts: {} },
    },
    proficiencies: {
      classDC: 0,
      perception: 0,
      fortitude: 0,
      reflex: 0,
      will: 0,
      heavy: 0, medium: 0, light: 0, unarmored: 0,
      advanced: 0, martial: 0, simple: 0, unarmed: 0,
      castingArcane: 0, castingDivine: 0, castingOccult: 0, castingPrimal: 0,
      acrobatics: 0, arcana: 0, athletics: 0, crafting: 0,
      deception: 0, diplomacy: 0, intimidation: 0, medicine: 0,
      nature: 0, occultism: 0, performance: 0, religion: 0,
      society: 0, stealth: 0, survival: 0, thievery: 0,
    },
    acTotal: { acTotal: 10, acProfBonus: 0, acAbilityBonus: 0, acItemBonus: 0, acValue: 10 },
    lores: [],
    weapons: [],
    feats: [],
    specials: [],
    equipment: [],
    money: { cp: 0, sp: 0, gp: 0, pp: 0 },
    spellCasters: [],
    focus: {},
    specificProficiencies: {},
    armor: [],
    formula: [],
    pets: [],
    senses: '',
    _pathwayCreated: true,
  };
}

async function saveCreatedCharacter(userId, char) {
  if (!char?.name) return { error: 'Character name is required.' };
  const characters = loadCharacters();
  if (!characters[userId]) characters[userId] = {};
  const key = char.name.toLowerCase().replace(/\s+/g, '-');
  if (characters[userId][key]) return { error: `You already have a character named **${char.name}**. Use a different name or remove the old one first.` };
  const count = Object.keys(characters[userId]).filter(k => !k.startsWith('_')).length;
  if (count >= MAX_CHARACTERS_PER_USER) {
    return { error: `You've reached the ${MAX_CHARACTERS_PER_USER}-character limit. Remove one with \`/char remove\` before adding another.` };
  }
  const entry = {
    name: char.name,
    data: char,
    art: null,
    senses: null,
    edits: {},
    saved: new Date().toISOString(),
  };
  characters[userId][key] = entry;
  if (!characters[userId]._activeChar) characters[userId]._activeChar = key;
  await saveCharacters(characters);
  return { ok: true, key, name: char.name, level: char.level, maxHp: computeCharMaxHp(entry) };
}

async function handle(interaction) {
  try {
    if (interaction.customId === 'char_create_modal') {
              await interaction.deferReply({ ephemeral: true });
              const name = interaction.fields.getTextInputValue('name').trim();
              const className = interaction.fields.getTextInputValue('class').trim();
              const ancestry = interaction.fields.getTextInputValue('ancestry').trim();
              const heritage = interaction.fields.getTextInputValue('heritage').trim();
              const levelRaw = interaction.fields.getTextInputValue('level').trim() || '1';
    
              if (!name) return interaction.editReply('❌ Character name is required.');
              const level = Number.parseInt(levelRaw, 10);
              if (!Number.isFinite(level) || level < 1 || level > 20) {
                return interaction.editReply(`❌ Level must be a whole number from 1 to 20. Got "${levelRaw}".`);
              }
    
              const char = createBlankCharacterData({ name, className, ancestry, heritage, level });
              const saved = await saveCreatedCharacter(interaction.user.id, char);
              if (saved.error) return interaction.editReply(`❌ ${saved.error}`);
              return interaction.editReply(
                `✅ **${saved.name}** created as a blank level ${saved.level} character.\n` +
                `Use \`/sheet name:${saved.name}\` to view it, then fill in details with \`/char ability\`, \`/char stat\`, \`/char skill\`, \`/char weapon\`, \`/char item\`, and \`/char edit\`.`
              );
            }
    
    if (interaction.customId.startsWith('char_edit_modal:')) {
              await interaction.deferReply({ ephemeral: true });
              const charKey = interaction.customId.slice('char_edit_modal:'.length);
    
              const characters = loadCharacters();
              const userChars = characters[interaction.user.id] ?? {};
              const charEntry = userChars[charKey];
              if (!charEntry) {
                return interaction.editReply('❌ Character not found. Did you delete them while the popup was open?');
              }
    
              const background = interaction.fields.getTextInputValue('background').trim();
              const deity      = interaction.fields.getTextInputValue('deity').trim();
              const langRaw    = interaction.fields.getTextInputValue('languages').trim();
              const sensesRaw  = interaction.fields.getTextInputValue('senses').trim();
    
              if (!charEntry.edits) charEntry.edits = {};
              // Only set overrides when the user actually typed something; empty
              // strings clear the override so the original JSON value shows again.
              if (background) charEntry.edits.background = background;
              else delete charEntry.edits.background;
              if (deity) charEntry.edits.deity = deity;
              else delete charEntry.edits.deity;
              if (langRaw) charEntry.edits.languages = langRaw.split(/,\s*/).map(s => s.trim()).filter(Boolean);
              else delete charEntry.edits.languages;
              if (sensesRaw) charEntry.edits.senses = sensesRaw.split(/,\s*/).map(s => s.trim()).filter(Boolean);
              else delete charEntry.edits.senses;
    
              await saveCharacters(characters);
              return interaction.editReply(`✅ Updated **${charEntry.name}**. Use \`/sheet\` to see the changes.`);
            }
    
    if (interaction.customId.startsWith('char_identity_modal:')) {
              await interaction.deferReply({ ephemeral: true });
              const charKey = interaction.customId.slice('char_identity_modal:'.length);
              const characters = loadCharacters();
              const charEntry = (characters[interaction.user.id] ?? {})[charKey];
              if (!charEntry) return interaction.editReply('❌ Character not found.');
    
              if (!charEntry.edits) charEntry.edits = {};
              if (!charEntry.edits.identity) charEntry.edits.identity = {};
              const id = charEntry.edits.identity;
    
              const setOrClear = (fieldId, target) => {
                const raw = interaction.fields.getTextInputValue(fieldId).trim();
                if (raw) id[target] = raw;
                else delete id[target];
              };
              setOrClear('class', 'class');
              setOrClear('subclass', 'subclass');
              setOrClear('ancestry', 'ancestry');
              setOrClear('heritage', 'heritage');
              // Level is an integer
              const lvlRaw = interaction.fields.getTextInputValue('level').trim();
              if (lvlRaw) {
                const n = parseInt(lvlRaw, 10);
                if (Number.isFinite(n) && n >= 1 && n <= 20) id.level = n;
                else return interaction.editReply(`❌ Level must be a whole number 1-20. Got "${lvlRaw}".`);
              } else {
                delete id.level;
              }
    
              await saveCharacters(characters);
              return interaction.editReply(`✅ Updated identity for **${charEntry.name}**. Use \`/sheet\` to see it.`);
            }
    
    if (interaction.customId.startsWith('char_misc_modal:')) {
              await interaction.deferReply({ ephemeral: true });
              const charKey = interaction.customId.slice('char_misc_modal:'.length);
              const characters = loadCharacters();
              const charEntry = (characters[interaction.user.id] ?? {})[charKey];
              if (!charEntry) return interaction.editReply('❌ Character not found.');
    
              if (!charEntry.edits) charEntry.edits = {};
              if (!charEntry.edits.misc) charEntry.edits.misc = {};
              const m = charEntry.edits.misc;
    
              const setOrClear = (fieldId, target) => {
                const raw = interaction.fields.getTextInputValue(fieldId).trim();
                if (raw) m[target] = raw;
                else delete m[target];
              };
              setOrClear('gender', 'gender');
              setOrClear('age', 'age');
              setOrClear('alignment', 'alignment');
              setOrClear('keyability', 'keyability');
              // Size: accept number or friendly name
              const sizeRaw = interaction.fields.getTextInputValue('size').trim().toLowerCase();
              if (sizeRaw) {
                const sizeMap = { tiny: -2, small: -1, medium: 0, large: 1, huge: 2, gargantuan: 3 };
                if (sizeRaw in sizeMap) {
                  m.size = sizeMap[sizeRaw];
                } else {
                  const n = parseInt(sizeRaw, 10);
                  if (Number.isFinite(n) && n >= -2 && n <= 3) m.size = n;
                  else return interaction.editReply(`❌ Size must be a number (-2 to 3) or a name (Tiny/Small/Medium/Large/Huge/Gargantuan). Got "${sizeRaw}".`);
                }
              } else {
                delete m.size;
              }
    
              await saveCharacters(characters);
              return interaction.editReply(`✅ Updated misc details for **${charEntry.name}**. Use \`/sheet\` to see it.`);
            }
  } catch (err) {
    console.error('Modal submit error:', err);
    try { await interaction.editReply('? Something went wrong saving your edits. Try again.'); } catch {}
  }
}

module.exports = {
  handles,
  handle,
};
