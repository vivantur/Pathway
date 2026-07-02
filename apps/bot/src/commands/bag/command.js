const bagState = require('../../state/bags');
const characterState = require('../../state/characters');
const {
  getOrCreateBag,
  normalizeBagEntry,
  lookupItemData,
  buildBagEmbed,
} = require('./helpers');

const MAX_BAG_CATEGORIES = 20;
const MAX_BAG_ITEMS_PER_CATEGORY = 50;

async function saveBags(bags) {
  await bagState.saveAll(bags);
}

function resolveCharacterBag(interaction, bags) {
  const userId = interaction.user.id;
  const characters = characterState.getAll();
  const nameArg = interaction.options.getString('character');
  const resolved = characterState.resolveChar(userId, nameArg, characters);
  if (resolved.error) return { error: resolved.error };

  const { charKey, char: charEntry } = resolved;
  const character = charEntry.data ?? charEntry;
  const characterName = character?.name ?? charEntry.name ?? 'Character';
  const bagKey = bagState.makeBagKey(userId, charKey);
  return {
    charKey,
    character,
    characterName,
    bagKey,
    userBag: getOrCreateBag(bags, bagKey, characterName),
  };
}

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const bags = bagState.getAll();
  const resolvedBag = resolveCharacterBag(interaction, bags);
  if (resolvedBag.error) return interaction.reply({ content: resolvedBag.error, ephemeral: true });

  const { character, characterName, userBag } = resolvedBag;

  if (sub === 'view') {
    return interaction.reply({ embeds: [buildBagEmbed(userBag, character)] });
  }

  if (sub === 'rename') {
    const newName = interaction.options.getString('name');
    userBag.bagName = newName;
    await saveBags(bags);
    return interaction.reply({ content: `✅ **${characterName}**'s bag renamed to **${newName}**!`, ephemeral: true });
  }

  if (sub === 'add') {
    const category = interaction.options.getString('category').trim();
    const itemInput = interaction.options.getString('item').trim();
    const qty = Math.max(1, interaction.options.getInteger('qty') ?? 1);
    const data = lookupItemData(itemInput);
    const displayName = data?.name ?? itemInput;

    const isNewCategory = !userBag.categories[category];
    if (isNewCategory && Object.keys(userBag.categories).length >= MAX_BAG_CATEGORIES) {
      return interaction.reply({
        content: `❌ You've reached the ${MAX_BAG_CATEGORIES}-category limit. Remove a category with \`/bag removecategory\` first.`,
        ephemeral: true,
      });
    }

    if (!userBag.categories[category]) userBag.categories[category] = [];
    if (userBag.categories[category].length >= MAX_BAG_ITEMS_PER_CATEGORY) {
      return interaction.reply({
        content: `❌ **${category}** is full (max ${MAX_BAG_ITEMS_PER_CATEGORY} items). Remove something first.`,
        ephemeral: true,
      });
    }

    const bucket = userBag.categories[category];
    const existingIdx = bucket.findIndex(raw => {
      const entry = normalizeBagEntry(raw);
      return entry && entry.name.toLowerCase() === displayName.toLowerCase();
    });

    if (existingIdx !== -1) {
      const existing = normalizeBagEntry(bucket[existingIdx]);
      bucket[existingIdx] = { name: existing.name, qty: existing.qty + qty };
    } else {
      bucket.push({ name: displayName, qty });
    }

    await saveBags(bags);

    const tag = data ? '' : ' *(homebrew)*';
    const qtyLabel = qty > 1 ? ` x${qty}` : '';
    return interaction.reply({
      content: `✅ Added **${displayName}**${qtyLabel}${tag} to **${characterName}**'s **${category}** bag category!`,
      ephemeral: true,
    });
  }

  if (sub === 'remove') {
    const category = interaction.options.getString('category').trim();
    const itemInput = interaction.options.getString('item').trim();
    const qty = interaction.options.getInteger('qty') ?? null;
    if (!userBag.categories[category]) {
      return interaction.reply({ content: `❌ Category **"${category}"** doesn't exist in **${characterName}**'s bag.`, ephemeral: true });
    }

    const bucket = userBag.categories[category];
    const idx = bucket.findIndex(raw => {
      const entry = normalizeBagEntry(raw);
      return entry && entry.name.toLowerCase() === itemInput.toLowerCase();
    });
    if (idx === -1) {
      return interaction.reply({ content: `❌ **${itemInput}** not found in **${characterName}**'s **${category}** category.`, ephemeral: true });
    }

    const existing = normalizeBagEntry(bucket[idx]);
    if (qty == null || qty >= existing.qty) {
      bucket.splice(idx, 1);
    } else {
      bucket[idx] = { name: existing.name, qty: existing.qty - qty };
    }

    if (bucket.length === 0) delete userBag.categories[category];
    await saveBags(bags);

    const removedQty = qty == null ? existing.qty : Math.min(qty, existing.qty);
    const qtyLabel = removedQty > 1 ? ` x${removedQty}` : '';
    return interaction.reply({
      content: `✅ Removed **${existing.name}**${qtyLabel} from **${characterName}**'s **${category}** category!`,
      ephemeral: true,
    });
  }

  if (sub === 'removecategory') {
    const category = interaction.options.getString('category').trim();
    if (!userBag.categories[category]) {
      return interaction.reply({ content: `❌ Category **"${category}"** doesn't exist in **${characterName}**'s bag.`, ephemeral: true });
    }
    delete userBag.categories[category];
    await saveBags(bags);
    return interaction.reply({ content: `🗑️ Removed category **${category}** from **${characterName}**'s bag.`, ephemeral: true });
  }

  if (sub === 'clear') {
    userBag.categories = {};
    await saveBags(bags);
    return interaction.reply({ content: `🗑️ **${characterName}**'s bag has been cleared!`, ephemeral: true });
  }

  return interaction.reply({ content: '❌ Unknown subcommand.', ephemeral: true });
}

module.exports = {
  name: 'bag',
  execute,
};
