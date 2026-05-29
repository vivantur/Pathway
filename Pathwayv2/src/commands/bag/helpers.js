const { EmbedBuilder } = require('discord.js');
const { itemDatabase } = require('../../reference/databases');

function getOrCreateBag(bags, userId) {
  if (!bags[userId]) {
    bags[userId] = { bagName: 'Bag 1', categories: {} };
  }
  return bags[userId];
}

// ── Bag entry helpers ─────────────────────────────────────────────────────────
// Entries may be either legacy strings ("Healing Potion") or objects ({ name, qty }).
// All read/write paths below tolerate both, and writes always produce the object form.
function normalizeBagEntry(entry) {
  if (typeof entry === 'string') return { name: entry, qty: 1 };
  if (entry && typeof entry === 'object' && entry.name) {
    return { name: String(entry.name), qty: Math.max(1, Number(entry.qty) || 1) };
  }
  return null;
}

// Convert a bulk_normalized string to "light units" (1 L = 1, 1 Bulk = 10, negligible = 0).
// Returns null if we can't parse it (e.g. parser artifacts), so we can skip it cleanly.
function bulkToLightUnits(bulkNormalized) {
  if (bulkNormalized == null) return 0; // treat missing as negligible
  const s = String(bulkNormalized).trim().toLowerCase();
  if (s === '' || s === '—' || s === '-' || s === 'negligible' || s === '0') return 0;
  if (s === 'l' || s === 'light') return 1;
  const n = parseFloat(s);
  if (Number.isFinite(n)) return Math.round(n * 10);
  return null; // unparseable (likely a parser artifact like campaign names)
}

// Format a light-unit total back into PF2e bulk notation: "3 Bulk, 2 L" / "5 L" / "—".
function formatBulk(lightUnits) {
  if (!lightUnits) return '—';
  const bulk = Math.floor(lightUnits / 10);
  const light = lightUnits % 10;
  const parts = [];
  if (bulk > 0)  parts.push(`${bulk} Bulk`);
  if (light > 0) parts.push(`${light} L`);
  return parts.join(', ');
}

// Format a copper-piece total into PF2e coinage (pp/gp/sp/cp), only showing nonzero denominations.
function formatCp(cp) {
  if (!cp) return '0 gp';
  const pp = Math.floor(cp / 1000);
  const gp = Math.floor((cp % 1000) / 100);
  const sp = Math.floor((cp % 100) / 10);
  const cpLeft = cp % 10;
  const parts = [];
  if (pp) parts.push(`${pp} pp`);
  if (gp) parts.push(`${gp} gp`);
  if (sp) parts.push(`${sp} sp`);
  if (cpLeft) parts.push(`${cpLeft} cp`);
  return parts.join(', ') || '0 gp';
}

// Look up an item in itemDatabase by name (case-insensitive exact match, then lookup_name).
// Returns null for homebrew / unrecognized items so the caller can skip them in totals.
function lookupItemData(name) {
  if (!name || !Array.isArray(itemDatabase) || itemDatabase.length === 0) return null;
  const q = String(name).toLowerCase().trim();
  return itemDatabase.find(i => i.name.toLowerCase() === q)
      || itemDatabase.find(i => (i.lookup_name ?? '').toLowerCase() === q)
      || null;
}

// PF2e encumbrance: encumbered at 5 + Str mod, max at 10 + Str mod (in Bulk, i.e. ×10 light-units).
function computeBulkLimits(character) {
  const str = character?.abilities?.str;
  if (typeof str !== 'number') return null;
  const strMod = Math.floor((str - 10) / 2);
  return {
    strMod,
    encumberedLu: (5 + strMod) * 10,
    maxLu:        (10 + strMod) * 10,
  };
}

function buildBagEmbed(userBag, character = null) {
  const embed = new EmbedBuilder()
    .setTitle(`🎒 ${userBag.bagName}`)
    .setColor(0x9B59B6)
    .setFooter({ text: '/bag add • /bag remove • /bag removecategory • /bag rename • /bag clear' });

  const cats = Object.entries(userBag.categories ?? {});

  if (cats.length === 0) {
    embed.setDescription('*Your bag is empty. Use `/bag add <category> <item>` to get started!*');
    return embed;
  }

  let totalLu = 0;
  let totalCp = 0;
  let unknownBulkCount = 0;

  for (const [cat, items] of cats) {
    const lines = [];
    for (const raw of items) {
      const entry = normalizeBagEntry(raw);
      if (!entry) continue;
      const data = lookupItemData(entry.name);
      const qtyPrefix = entry.qty > 1 ? `${entry.qty}× ` : '';

      if (data) {
        // Hydrate live from itemDatabase
        const lu = bulkToLightUnits(data.bulk_normalized);
        if (lu == null) unknownBulkCount += entry.qty;
        else            totalLu += lu * entry.qty;

        if (typeof data.price_cp === 'number') totalCp += data.price_cp * entry.qty;

        const bulkStr = data.bulk_raw ? ` *(${data.bulk_raw})*` : '';
        const priceStr = data.price_raw ? ` — ${data.price_raw}` : '';
        lines.push(`${qtyPrefix}**${data.name}**${bulkStr}${priceStr}`);
      } else {
        // Homebrew / unknown — display as-is, don't contribute to totals
        lines.push(`${qtyPrefix}${entry.name} *(homebrew)*`);
      }
    }
    const value = lines.length > 0 ? lines.join('\n') : '*Empty*';
    embed.addFields({ name: `**${cat}**`, value: value.slice(0, 1024), inline: false });
  }

  // Summary footer fields: Bulk (with encumbrance if character provided) and Total Value
  const limits = computeBulkLimits(character);
  let bulkField = formatBulk(totalLu);
  if (limits) {
    const status = totalLu > limits.maxLu ? ' 🚫 **Overloaded**'
                : totalLu > limits.encumberedLu ? ' ⚠️ *Encumbered*'
                : '';
    bulkField += `  /  ${formatBulk(limits.encumberedLu)} encumbered  /  ${formatBulk(limits.maxLu)} max${status}`;
  }
  if (unknownBulkCount > 0) bulkField += `\n*(${unknownBulkCount} item${unknownBulkCount === 1 ? '' : 's'} with unknown bulk not counted)*`;

  embed.addFields(
    { name: '⚖️ Total Bulk',  value: bulkField,            inline: false },
    { name: '💰 Total Value', value: formatCp(totalCp),    inline: true  },
  );

  return embed;
}

module.exports = {
  getOrCreateBag,
  normalizeBagEntry,
  bulkToLightUnits,
  formatBulk,
  formatCp,
  lookupItemData,
  computeBulkLimits,
  buildBagEmbed,
};
