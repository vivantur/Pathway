const { rollAdvanced } = require('../rules/advancedRoll');

function rollDiceExpression(raw) {
  const result = rollAdvanced(raw, {}, null);
  if (result.error) return { error: result.error };

  const first = result.iterations?.[0];
  if (!first) return { error: 'Empty evaluation.' };

  return {
    total: first.total,
    breakdown: first.breakdown,
  };
}

module.exports = {
  rollDiceExpression,
};
