const COUNTER_PIPS = {
  diamond: { filled: '◆', empty: '◇' },
  circle:  { filled: '●', empty: '○' },
  square:  { filled: '■', empty: '□' },
  star:    { filled: '★', empty: '☆' },
  hex:     { filled: '⬢', empty: '⬡' },
};

const COUNTER_PIP_MAX = 25;

function renderCounterLine(key, ctr, { withHint = false } = {}) {
  const label = ctr.label || key;
  const max = Number(ctr.max ?? 0);
  const cur = Number(ctr.current ?? 0);
  const resetTag = ctr.reset === 'daily' ? ' *(resets on rest)*' : '';
  const style = COUNTER_PIPS[ctr.display] || COUNTER_PIPS.diamond;
  let pipsLine = '';

  if (max > 0 && max <= COUNTER_PIP_MAX) {
    const filled = style.filled.repeat(Math.max(0, Math.min(max, cur)));
    const empty = style.empty.repeat(Math.max(0, max - Math.max(0, Math.min(max, cur))));
    pipsLine = `\n${filled}${empty}`;
  }

  const hintLine = withHint ? `\n*\`{{counter.${key}}}\`*` : '';
  return `**${label}**: ${cur}/${max}${resetTag}${pipsLine}${hintLine}`;
}

module.exports = {
  renderCounterLine,
};
