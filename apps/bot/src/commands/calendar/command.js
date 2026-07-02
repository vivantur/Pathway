const calendarCmd = require('../calendar-cmd');
const weatherEngine = require('../../rules/weather');

async function execute(interaction) {
  return calendarCmd.handleCalendar(interaction, weatherEngine);
}

module.exports = {
  name: 'calendar',
  execute,
};
