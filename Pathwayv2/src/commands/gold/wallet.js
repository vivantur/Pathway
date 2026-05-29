const { EmbedBuilder } = require('discord.js');

const COPPER_VALUE = { cp: 1, sp: 10, gp: 100, pp: 1000 };

function walletToCopper(wallet) {
  return (wallet.cp ?? 0) + (wallet.sp ?? 0) * 10 + (wallet.gp ?? 0) * 100 + (wallet.pp ?? 0) * 1000;
}

function copperToWallet(total) {
  const pp = Math.floor(total / 1000);
  total %= 1000;
  const gp = Math.floor(total / 100);
  total %= 100;
  const sp = Math.floor(total / 10);
  total %= 10;
  return { pp, gp, sp, cp: total };
}

function formatWallet(wallet) {
  const parts = [];
  if (wallet.pp) parts.push(`${wallet.pp} pp`);
  if (wallet.gp) parts.push(`${wallet.gp} gp`);
  if (wallet.sp) parts.push(`${wallet.sp} sp`);
  if (wallet.cp || parts.length === 0) parts.push(`${wallet.cp ?? 0} cp`);
  return parts.join(', ');
}

function buildWalletEmbed(char, charEntry) {
  const wallet = charEntry.wallet ?? { pp: 0, gp: 0, sp: 0, cp: 0 };
  const totalGP = (walletToCopper(wallet) / 100).toFixed(2);
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`💰 ${char.name}'s Wallet`)
    .addFields(
      { name: '🟣 Platinum (pp)', value: `${wallet.pp ?? 0}`, inline: true },
      { name: '🟡 Gold (gp)', value: `${wallet.gp ?? 0}`, inline: true },
      { name: '⚪ Silver (sp)', value: `${wallet.sp ?? 0}`, inline: true },
      { name: '🟤 Copper (cp)', value: `${wallet.cp ?? 0}`, inline: true },
      { name: '💵 Total Value', value: `${totalGP} gp`, inline: true },
    )
    .setFooter({ text: 'Use /gold add, /gold spend, or /gold convert' });

  if (charEntry.art) embed.setThumbnail(charEntry.art);
  return embed;
}

module.exports = {
  COPPER_VALUE,
  walletToCopper,
  copperToWallet,
  formatWallet,
  buildWalletEmbed,
};
