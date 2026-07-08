// Weather effects apply to combatants through the combat v2 store, which
// exposes the same getEncounter/addEffect interface the legacy store had.
const combatV2State = require('../../rules/combatV2/state');
const weatherCmd = require('../weather-cmd');

async function execute(interaction) {
  return weatherCmd.handleWeather(interaction, combatV2State);
}

module.exports = {
  name: 'weather',
  execute,
};
