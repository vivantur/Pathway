const encounters = require('../encounters');
const weatherCmd = require('../weather-cmd');

async function execute(interaction) {
  return weatherCmd.handleWeather(interaction, encounters);
}

module.exports = {
  name: 'weather',
  execute,
};
