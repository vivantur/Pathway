import { useState } from 'react';
import { rollExpression, formatBreakdown, type RollResult } from '@/features/characters/dice';
import { CornerAccents } from './Sheet';
import { DiceIcon } from './icons';

const QUICK_DICE = [4, 6, 8, 10, 12, 20, 100];

/**
 * Self-contained dice roller for Table Mode. Quick buttons roll a single die;
 * the formula input handles full expressions (`2d6+3`, `1d8+1d6`, `d20-1`).
 * A single d20 highlights natural 20 / natural 1. History is session-local.
 */
export function DiceRoller() {
  const [formula, setFormula] = useState('');
  const [history, setHistory] = useState<RollResult[]>([]);
  const [error, setError] = useState(false);

  const roll = (expr: string) => {
    const res = rollExpression(expr);
    if (!res) {
      setError(true);
      return;
    }
    setError(false);
    setHistory((prev) => [res, ...prev].slice(0, 8));
  };

  const rollFormula = () => {
    if (formula.trim()) roll(formula);
  };

  const latest = history[0];

  return (
    <section className="relative rounded-md border border-gold/20 bg-midnight-900/60 p-3">
      <CornerAccents />
      <h3 className="mb-2 flex items-center gap-1.5 text-[0.65rem] uppercase tracking-widest text-gold/80">
        <span className="text-sm text-gold">
          <DiceIcon />
        </span>
        Dice
      </h3>

      <div className="grid grid-cols-4 gap-1">
        {QUICK_DICE.map((sides) => (
          <button
            key={sides}
            type="button"
            onClick={() => roll(`1d${sides}`)}
            className="rounded border border-gold/20 bg-midnight-900/50 py-1 text-xs font-display text-silver/80 transition-colors hover:border-gold/50 hover:text-gold"
          >
            d{sides}
          </button>
        ))}
      </div>

      <div className="mt-2 flex gap-1">
        <input
          type="text"
          value={formula}
          onChange={(e) => {
            setFormula(e.target.value);
            setError(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') rollFormula();
          }}
          placeholder="2d6+3"
          className={`w-full rounded border bg-midnight-800/80 px-2 py-1 text-sm text-silver focus:outline-none ${
            error ? 'border-red-400/60' : 'border-gold/30 focus:border-gold/60'
          }`}
        />
        <button
          type="button"
          onClick={rollFormula}
          className="shrink-0 rounded border border-gold/40 bg-gold/10 px-2 text-xs font-display uppercase tracking-widest text-gold hover:bg-gold/20"
        >
          Roll
        </button>
      </div>
      {error && (
        <p className="mt-1 text-[0.6rem] text-red-300">Couldn’t read that — try like “2d6+3”.</p>
      )}

      {latest && (
        <div className="mt-3 rounded border border-gold/25 bg-midnight-900/70 p-2 text-center">
          <div
            className={`font-display text-3xl tabular-nums ${
              latest.nat20 ? 'text-emerald-soft' : latest.nat1 ? 'text-red-300' : 'text-gold'
            }`}
          >
            {latest.total}
          </div>
          <div className="mt-0.5 text-[0.6rem] text-silver/60">
            {latest.expression} → {formatBreakdown(latest)}
          </div>
          {latest.nat20 && (
            <div className="text-[0.6rem] uppercase tracking-widest text-emerald-soft">
              Natural 20!
            </div>
          )}
          {latest.nat1 && (
            <div className="text-[0.6rem] uppercase tracking-widest text-red-300">Natural 1</div>
          )}
        </div>
      )}

      {history.length > 1 && (
        <ul className="mt-2 space-y-0.5">
          {history.slice(1).map((r, i) => (
            <li
              key={i}
              className="flex items-baseline justify-between gap-2 text-[0.65rem] text-silver/50"
            >
              <span className="truncate">{r.expression}</span>
              <span className="font-display tabular-nums text-silver/70">{r.total}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
