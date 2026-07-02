const combatV2Render = require('../../rules/combatV2/render');

async function updateCombatV2Summary(channel, encounter, { gmView = false } = {}) {
  if (!encounter) return null;
  const { embed, page, totalPages } = combatV2Render.renderEncounter(encounter, { gmView });
  const components = combatV2Render.pageButtons(channel.id, page, totalPages);
  const payload = { embeds: [embed], components };

  if (encounter.summaryMessageId) {
    try {
      const existing = await channel.messages.fetch(encounter.summaryMessageId);
      await existing.edit(payload);
      return existing;
    } catch {}
  }

  const msg = await channel.send(payload);
  encounter.summaryMessageId = msg.id;
  try {
    await msg.pin();
  } catch (err) {
    console.warn('Could not pin combat v2 summary message:', err.message);
  }
  return msg;
}

async function clearCombatV2Summary(channel, encounter) {
  if (!encounter?.summaryMessageId) return;
  try {
    const msg = await channel.messages.fetch(encounter.summaryMessageId);
    try { await msg.unpin(); } catch {}
  } catch {}
}

module.exports = {
  updateCombatV2Summary,
  clearCombatV2Summary,
};
