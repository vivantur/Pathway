const characterState = require('../../state/characters');
const {
  COPPER_VALUE,
  walletToCopper,
  copperToWallet,
  formatWallet,
  buildWalletEmbed,
} = require('./wallet');

async function saveCharacters(characters) {
  await characterState.saveAll(characters);
}

function optionCoins(interaction) {
  return {
    pp: interaction.options.getInteger('pp') ?? 0,
    gp: interaction.options.getInteger('gp') ?? 0,
    sp: interaction.options.getInteger('sp') ?? 0,
    cp: interaction.options.getInteger('cp') ?? 0,
  };
}

function isZeroWallet(wallet) {
  return wallet.pp === 0 && wallet.gp === 0 && wallet.sp === 0 && wallet.cp === 0;
}

async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();
  const characters = characterState.getAll();
  const { error, charKey, char: charEntry } = characterState.resolveChar(
    interaction.user.id,
    interaction.options.getString('character'),
    characters
  );

  if (error) return interaction.reply({ content: error, ephemeral: true });

  const char = charEntry.data;
  if (!charEntry.wallet) charEntry.wallet = { pp: 0, gp: 0, sp: 0, cp: 0 };
  const wallet = charEntry.wallet;

  if (subcommand === 'view') return interaction.reply({ embeds: [buildWalletEmbed(char, charEntry)] });

  if (subcommand === 'add') {
    const coins = optionCoins(interaction);
    if (isZeroWallet(coins)) return interaction.reply({ content: '❌ Specify at least one currency amount.', ephemeral: true });

    wallet.pp = (wallet.pp ?? 0) + coins.pp;
    wallet.gp = (wallet.gp ?? 0) + coins.gp;
    wallet.sp = (wallet.sp ?? 0) + coins.sp;
    wallet.cp = (wallet.cp ?? 0) + coins.cp;
    charEntry.wallet = wallet;
    characters[interaction.user.id][charKey] = charEntry;
    await saveCharacters(characters);

    return interaction.reply({
      embeds: [buildWalletEmbed(char, charEntry).setTitle(`💰 ${char.name}'s Wallet - Added ${formatWallet(coins)}`)],
    });
  }

  if (subcommand === 'spend') {
    const coins = optionCoins(interaction);
    if (isZeroWallet(coins)) return interaction.reply({ content: '❌ Specify at least one currency amount.', ephemeral: true });

    const currentTotal = walletToCopper(wallet);
    const spendTotal = coins.pp * 1000 + coins.gp * 100 + coins.sp * 10 + coins.cp;
    if (spendTotal > currentTotal) {
      return interaction.reply({
        content: `❌ **${char.name}** can't afford that! They only have **${formatWallet(wallet)}**.`,
        ephemeral: true,
      });
    }

    charEntry.wallet = copperToWallet(currentTotal - spendTotal);
    characters[interaction.user.id][charKey] = charEntry;
    await saveCharacters(characters);

    return interaction.reply({
      embeds: [buildWalletEmbed(char, charEntry).setTitle(`💸 ${char.name}'s Wallet - Spent ${formatWallet(coins)}`)],
    });
  }

  if (subcommand === 'convert') {
    const from = interaction.options.getString('from');
    const to = interaction.options.getString('to');
    const amount = interaction.options.getInteger('amount');
    if (from === to) return interaction.reply({ content: `❌ Can't convert ${from} to ${from}!`, ephemeral: true });

    const fromValue = COPPER_VALUE[from];
    const toValue = COPPER_VALUE[to];
    const totalCopperToConvert = amount * fromValue;
    if ((wallet[from] ?? 0) < amount) {
      return interaction.reply({ content: `❌ **${char.name}** only has **${wallet[from] ?? 0} ${from}**.`, ephemeral: true });
    }
    if (fromValue < toValue && totalCopperToConvert < toValue) {
      return interaction.reply({ content: `❌ ${amount} ${from} isn't worth even 1 ${to}.`, ephemeral: true });
    }

    const converted = Math.floor(totalCopperToConvert / toValue);
    const remainder = totalCopperToConvert % toValue;
    wallet[from] = (wallet[from] ?? 0) - amount;
    wallet[to] = (wallet[to] ?? 0) + converted;
    wallet.cp = (wallet.cp ?? 0) + remainder;
    charEntry.wallet = wallet;
    characters[interaction.user.id][charKey] = charEntry;
    await saveCharacters(characters);

    const remainderNote = remainder > 0 ? ` (+${remainder} cp remainder)` : '';
    return interaction.reply({
      embeds: [buildWalletEmbed(char, charEntry)
        .setTitle(`🔄 ${char.name}'s Wallet - Converted`)
        .setDescription(`Converted **${amount} ${from}** -> **${converted} ${to}**${remainderNote}`)],
    });
  }

  if (subcommand === 'set') {
    charEntry.wallet = {
      pp: Math.max(0, interaction.options.getInteger('pp') ?? wallet.pp ?? 0),
      gp: Math.max(0, interaction.options.getInteger('gp') ?? wallet.gp ?? 0),
      sp: Math.max(0, interaction.options.getInteger('sp') ?? wallet.sp ?? 0),
      cp: Math.max(0, interaction.options.getInteger('cp') ?? wallet.cp ?? 0),
    };
    characters[interaction.user.id][charKey] = charEntry;
    await saveCharacters(characters);
    return interaction.reply({ embeds: [buildWalletEmbed(char, charEntry).setTitle(`✏️ ${char.name}'s Wallet - Updated`)] });
  }

  return interaction.reply({ content: '❌ Unknown subcommand.', ephemeral: true });
}

module.exports = {
  name: 'gold',
  execute,
};
