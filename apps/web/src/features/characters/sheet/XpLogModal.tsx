import { useState } from 'react';
import { useXpLog, useXpLogMutations } from '@/features/characters/useXpLog';
import type { XpLogRow } from '@/features/characters/xpLog';

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
};
const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
const inputCls =
  'rounded border border-gold/25 bg-midnight-950/60 px-2 py-1.5 text-sm text-silver focus:border-gold/60 focus:outline-none';

/**
 * The XP log editor — opened by clicking the (now read-only) XP field on the
 * sheet. Reads/writes the shared `character_xp_log` table, so entries added or
 * edited here show up on the Discord bot's `/xp` history, and each change keeps
 * the character's XP total in sync.
 */
export function XpLogModal({
  charKey,
  currentXp,
  onClose,
}: {
  charKey: string;
  currentXp: number;
  onClose: () => void;
}) {
  const { data: entries = [], isLoading, isError } = useXpLog(charKey);
  const { add, edit, remove } = useXpLogMutations(charKey);

  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editReason, setEditReason] = useState('');

  const submitAdd = () => {
    const n = Number(amount);
    if (!amount.trim() || Number.isNaN(n) || n === 0) return;
    add.mutate(
      { amount: n, reason: reason.trim() || null },
      {
        onSuccess: () => {
          setAmount('');
          setReason('');
        },
      },
    );
  };

  const startEdit = (e: XpLogRow) => {
    setEditingId(e.id);
    setEditAmount(String(e.amount));
    setEditReason(e.reason ?? '');
  };
  const submitEdit = (entry: XpLogRow) => {
    const n = Number(editAmount);
    if (Number.isNaN(n)) return;
    edit.mutate(
      { entry, amount: n, reason: editReason.trim() || null },
      { onSuccess: () => setEditingId(null) },
    );
  };

  const busy = add.isPending || edit.isPending || remove.isPending;
  const err = (add.error ?? edit.error ?? remove.error) as Error | undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-midnight-950/80 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="my-8 w-full max-w-lg rounded-lg border border-gold/40 bg-midnight-900 p-5 shadow-gilded"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="font-display text-lg text-gold">XP Log</h3>
          <div className="text-sm text-silver/70">
            Total <span className="font-display tabular-nums text-gold">{currentXp.toLocaleString()}</span>
            <span className="text-silver/40"> / 1,000</span>
          </div>
        </div>

        {/* Add a new entry */}
        <div className="mb-4 grid grid-cols-[6rem_1fr_auto] gap-2">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitAdd()}
            placeholder="±XP"
            className={`${inputCls} tabular-nums`}
            aria-label="XP amount"
          />
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitAdd()}
            placeholder="Reason (optional)"
            className={inputCls}
            aria-label="Reason"
          />
          <button
            type="button"
            onClick={submitAdd}
            disabled={busy || !amount.trim() || Number(amount) === 0}
            className="rounded border border-gold/40 bg-gold/10 px-3 text-sm font-display uppercase tracking-widest text-gold hover:bg-gold/20 disabled:opacity-50"
          >
            Add
          </button>
        </div>

        {err && <p className="mb-2 text-xs text-red-300">Couldn’t save: {err.message}</p>}
        {isError && (
          <p className="mb-2 text-xs text-red-300">Couldn’t load the XP log.</p>
        )}

        {/* Entries, newest first */}
        <div className="max-h-[50vh] space-y-2 overflow-y-auto">
          {isLoading ? (
            <p className="py-3 text-center text-sm text-silver/50">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="py-3 text-center text-sm text-silver/50">No XP entries yet.</p>
          ) : (
            entries.map((e) =>
              editingId === e.id ? (
                <div key={e.id} className="grid grid-cols-[6rem_1fr_auto_auto] gap-2 rounded border border-gold/25 bg-midnight-950/40 p-2">
                  <input
                    type="number"
                    value={editAmount}
                    onChange={(ev) => setEditAmount(ev.target.value)}
                    className={`${inputCls} tabular-nums`}
                  />
                  <input value={editReason} onChange={(ev) => setEditReason(ev.target.value)} className={inputCls} />
                  <button type="button" onClick={() => submitEdit(e)} disabled={busy} className="rounded border border-emerald/40 px-2 text-xs text-emerald-soft hover:bg-emerald/10 disabled:opacity-50">Save</button>
                  <button type="button" onClick={() => setEditingId(null)} className="rounded border border-gold/20 px-2 text-xs text-silver/70 hover:bg-midnight-800/60">Cancel</button>
                </div>
              ) : (
                <div key={e.id} className="flex items-center justify-between gap-3 rounded border border-gold/10 bg-midnight-950/40 px-3 py-2">
                  <div className="min-w-0">
                    <span className={`font-display tabular-nums ${e.amount >= 0 ? 'text-emerald-soft' : 'text-red-300'}`}>
                      {signed(e.amount)} XP
                    </span>
                    {e.reason && <span className="text-silver/70"> — {e.reason}</span>}
                    <div className="text-[0.65rem] text-silver/45">
                      {fmtDate(e.created_at)} · {e.old_xp} → {e.new_xp}
                      {e.entry_type !== 'award' ? ` · ${e.entry_type}` : ''}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 text-xs">
                    <button type="button" onClick={() => startEdit(e)} className="rounded border border-gold/25 px-2 py-0.5 text-gold/80 hover:bg-gold/10">Edit</button>
                    <button type="button" onClick={() => remove.mutate(e)} disabled={busy} className="rounded border border-red-400/30 px-2 py-0.5 text-red-300/80 hover:bg-red-500/10 disabled:opacity-50">Delete</button>
                  </div>
                </div>
              ),
            )
          )}
        </div>

        <div className="mt-4 flex justify-between">
          <p className="text-[0.65rem] italic text-silver/45">
            Editing the log adjusts your XP total. Changes sync to the Discord bot.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gold/30 px-4 py-1.5 text-sm text-silver/80 hover:bg-midnight-800/60"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
