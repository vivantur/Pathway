import { useMemo, useState } from 'react';
import { getDataset, findItem, type Item } from '@/features/builder/data';
import { OPT } from '@/features/builder/options/config';
import { opt } from '../rules';
import { useBuilder } from '../store';

type Category = 'All' | 'Weapons' | 'Armor' | 'Shields' | 'Gear';
const CATEGORIES: Category[] = ['All', 'Weapons', 'Armor', 'Shields', 'Gear'];

function inCategory(item: Item, cat: Category): boolean {
  if (cat === 'All') return true;
  if (cat === 'Weapons') return item.kind === 'weapon';
  if (cat === 'Armor') return item.kind === 'armor';
  if (cat === 'Shields') return item.kind === 'shield';
  return item.kind === 'gear';
}

const price = (gp: number) => (gp === 0 ? 'free' : `${gp} gp`);

function itemStats(item: Item): string {
  switch (item.kind) {
    case 'weapon':
      return `${item.category} · 1${item.damageDie} ${item.damageType} · ${
        item.ranged ? `ranged ${item.range} ft` : 'melee'
      }`;
    case 'armor':
      return `${item.category} · +${item.acBonus} AC · Dex cap ${item.dexCap ?? '—'} · Str ${item.strength}`;
    case 'shield':
      return `+${item.acBonus} AC when raised · Hardness ${item.hardness}`;
    case 'gear':
      return item.description;
  }
}

const canEquip = (item: Item) =>
  item.kind === 'weapon' || item.kind === 'armor' || item.kind === 'shield';

export function EquipmentStep() {
  const state = useBuilder((s) => s.state);
  const { addItem, removeItem, setItemQty, toggleEquip, setItemRunes, setMoney } = useBuilder();
  const [cat, setCat] = useState<Category>('All');
  const [query, setQuery] = useState('');
  // With Automatic Bonus Progression on, fundamental runes don't exist.
  const abpOn = opt(state, OPT.automaticBonusProgression);

  const items = getDataset().items;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (i) => inCategory(i, cat) && (!q || i.name.toLowerCase().includes(q)),
    );
  }, [items, cat, query]);

  const buy = (item: Item) => {
    // Block unaffordable purchases: setMoney clamps at 0, so without this an
    // overspend would grant the item "free" and a later sell would refund from
    // the clamped baseline — minting gp from nothing.
    if (state.money < item.price) return;
    addItem(item.id);
    setMoney(state.money - item.price);
  };
  const sell = (itemId: string, qty: number) => {
    const item = findItem(itemId);
    removeItem(itemId);
    if (item) setMoney(state.money + item.price * qty);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h3 className="mb-1 font-display text-xl text-gold-400">Equipment</h3>
          <p className="max-w-xl font-ui text-sm text-parchment/70">
            Buy gear to spend your gold, then <span className="text-gold-400">equip</span> armor and
            weapons — equipped items update your AC, attacks, and speed on the right.
          </p>
        </div>
        <label className="flex items-center gap-2 font-ui text-sm text-parchment/70">
          Gold
          <input
            type="number"
            className="w-24 rounded-lg border border-gold-500/25 bg-midnight-950/50 px-3 py-2 font-display text-gold-400 focus:border-gold-400/60 focus:outline-none"
            value={Number.isInteger(state.money) ? state.money : state.money.toFixed(2)}
            onChange={(e) => setMoney(Number(e.target.value))}
          />
          gp
        </label>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Shop */}
        <section className="panel flex flex-col gap-3 p-5">
          <h4 className="font-display text-lg text-gold-400">Shop</h4>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search items…"
            className="rounded-lg border border-gold-500/25 bg-midnight-950/50 px-3 py-2 font-ui text-sm text-parchment placeholder:text-parchment/40 focus:border-gold-400/60 focus:outline-none"
          />
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCat(c)}
                className="rounded-full border px-3 py-1 font-ui text-xs transition"
                style={{
                  borderColor: cat === c ? 'rgba(232,200,119,0.7)' : 'rgba(212,175,55,0.2)',
                  background: cat === c ? 'rgba(212,175,55,0.15)' : 'transparent',
                  color: cat === c ? '#e8c877' : 'rgba(239,230,208,0.6)',
                }}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto pr-1">
            {filtered.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-gold-500/15 bg-midnight-800/50 p-3"
              >
                <div className="min-w-0">
                  <div className="font-display text-parchment">{item.name}</div>
                  <div className="truncate font-ui text-xs text-parchment/60">{itemStats(item)}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="font-ui text-xs text-gold-400">{price(item.price)}</span>
                  <button type="button" className="btn py-1 text-xs" onClick={() => buy(item)}>
                    Buy
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Inventory */}
        <section className="panel flex flex-col gap-3 p-5">
          <h4 className="font-display text-lg text-gold-400">Your Inventory</h4>
          {state.inventory.length === 0 ? (
            <p className="font-ui text-sm text-parchment/50">
              Nothing yet — buy something from the shop.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {state.inventory.map((entry) => {
                const item = findItem(entry.itemId);
                if (!item) return null;
                const showRunes =
                  entry.equipped && (item.kind === 'weapon' || item.kind === 'armor') && !abpOn;
                return (
                  <div
                    key={entry.itemId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gold-500/15 bg-midnight-800/50 p-3"
                  >
                    <div className="min-w-0">
                      <div className="font-display text-parchment">{item.name}</div>
                      <div className="truncate font-ui text-xs text-parchment/60">{itemStats(item)}</div>
                      {showRunes && (
                        <div className="mt-1 flex flex-wrap items-center gap-2 font-ui text-[11px] text-parchment/60">
                          <label className="flex items-center gap-1">
                            Potency
                            <select
                              value={entry.runes?.potency ?? 0}
                              onChange={(e) => setItemRunes(entry.itemId, { potency: Number(e.target.value) })}
                              className="rounded border border-gold-500/25 bg-midnight-950/60 px-1 py-0.5 text-parchment"
                            >
                              {[0, 1, 2, 3].map((n) => (
                                <option key={n} value={n}>{n === 0 ? '—' : `+${n}`}</option>
                              ))}
                            </select>
                          </label>
                          {item.kind === 'weapon' ? (
                            <label className="flex items-center gap-1">
                              Striking
                              <select
                                value={entry.runes?.striking ?? 0}
                                onChange={(e) => setItemRunes(entry.itemId, { striking: Number(e.target.value) })}
                                className="rounded border border-gold-500/25 bg-midnight-950/60 px-1 py-0.5 text-parchment"
                              >
                                <option value={0}>—</option>
                                <option value={1}>Striking</option>
                                <option value={2}>Greater</option>
                                <option value={3}>Major</option>
                              </select>
                            </label>
                          ) : (
                            <label className="flex items-center gap-1">
                              Resilient
                              <select
                                value={entry.runes?.resilient ?? 0}
                                onChange={(e) => setItemRunes(entry.itemId, { resilient: Number(e.target.value) })}
                                className="rounded border border-gold-500/25 bg-midnight-950/60 px-1 py-0.5 text-parchment"
                              >
                                <option value={0}>—</option>
                                <option value={1}>Resilient</option>
                                <option value={2}>Greater</option>
                                <option value={3}>Major</option>
                              </select>
                            </label>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        className="btn px-2 py-1 text-xs"
                        onClick={() => setItemQty(entry.itemId, entry.qty - 1)}
                      >
                        −
                      </button>
                      <span className="w-6 text-center font-ui text-sm text-parchment">{entry.qty}</span>
                      <button
                        type="button"
                        className="btn px-2 py-1 text-xs"
                        onClick={() => setItemQty(entry.itemId, entry.qty + 1)}
                      >
                        +
                      </button>
                      {canEquip(item) && (
                        <button
                          type="button"
                          className="btn px-2 py-1 text-xs"
                          data-selected={entry.equipped}
                          style={
                            entry.equipped
                              ? { borderColor: 'rgba(232,200,119,0.7)', background: 'rgba(212,175,55,0.2)', color: '#e8c877' }
                              : undefined
                          }
                          onClick={() => toggleEquip(entry.itemId)}
                        >
                          {entry.equipped ? 'Equipped' : 'Equip'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn px-2 py-1 text-xs hover:border-red-400/60 hover:text-red-300"
                        onClick={() => sell(entry.itemId, entry.qty)}
                        title="Remove and refund its price"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
