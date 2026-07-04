import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  acTotal,
  damageTypeLabel,
  totalGp,
  type Armor,
  type Money,
  type PathbuilderBuild,
  type Weapon,
} from '@/features/characters/pathbuilder';
import type { BagItem, CharacterRow } from '@/features/characters/types';
import { mergeWeapons } from '@/features/characters/weapons';
import { searchItemsForPicker, type ItemPickResult } from '@/features/characters/api';
import { useCharacterBag } from '@/features/characters/useCharacterBag';
import { useUpdateCharacterBag } from '@/features/characters/useUpdateCharacterBag';
import { Panel, type EditControls } from '../Sheet';
import {
  CoinsIcon,
  PouchIcon,
  ShieldIcon,
  SwordIcon,
} from '../icons';

/**
 * Equipment tab — a comprehensive weapons / armor / inventory / currency
 * deep-dive. All data is already in `pathbuilder_data` (weapons/armor/
 * equipment/money) plus the live `currency` column and overlay-side weapons;
 * this view rearranges it for combat use.
 */
export function EquipmentTab({
  character,
  build,
  edit,
}: {
  character: CharacterRow;
  build: PathbuilderBuild;
  edit: EditControls;
}) {
  const weapons = mergeWeapons(build, character.overlay ?? null);
  const armor = build.armor ?? [];
  const inventory = build.equipment ?? [];
  const currency = character.currency ?? build.money ?? {};

  return (
    <div className="space-y-4">
      <WeaponsPanel weapons={weapons} />
      <ArmorPanel
        armor={armor}
        totalAc={acTotal(build)}
        itemBonus={build.acTotal?.acItemBonus}
      />
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <CurrencyPanel currency={currency} edit={edit} />
        <InventoryPanel inventory={inventory} />
      </div>
      <BagsPanel charKey={character.char_key} canEdit={edit.enabled} />
    </div>
  );
}

// ---------------------------------------------------------------
// Bags — the bot's loot inventory (bags + bag_items), editable + live-synced
// ---------------------------------------------------------------

function BagsPanel({ charKey, canEdit }: { charKey: string; canEdit: boolean }) {
  const { data, isLoading } = useCharacterBag(charKey);
  const { addItem, setQuantity, removeItem, isAdding } = useUpdateCharacterBag(charKey);

  const items = useMemo(() => data?.items ?? [], [data]);
  const byCategory = useMemo(() => {
    const map = new Map<string, BagItem[]>();
    for (const it of items) {
      const cat = it.category || 'General';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(it);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);
  const categories = useMemo(() => byCategory.map(([c]) => c), [byCategory]);

  // Hide entirely for viewers when the bag is empty.
  if (!canEdit && !isLoading && items.length === 0) return null;

  return (
    <Panel title={`Bags${items.length ? ` (${items.length})` : ''}`} icon={<PouchIcon />}>
      {isLoading ? (
        <p className="text-sm text-silver/40">Loading bag…</p>
      ) : (
        <>
          {items.length === 0 ? (
            <p className="text-sm text-silver/40">
              {canEdit ? 'Nothing in the bag yet — add loot below. It syncs with the bot.' : 'Empty.'}
            </p>
          ) : (
            <div className="space-y-3">
              {byCategory.map(([cat, catItems]) => (
                <div key={cat}>
                  <div className="mb-1 text-[0.6rem] font-display uppercase tracking-widest text-gold/70">
                    {cat}
                  </div>
                  <ul className="space-y-1">
                    {catItems.map((it) => (
                      <li key={it.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate text-silver/90">{it.displayName}</span>
                        {canEdit ? (
                          <span className="flex shrink-0 items-center gap-1.5">
                            <StepBtn label="−" onClick={() => setQuantity(it.id, it.quantity - 1)} />
                            <span className="w-6 text-center tabular-nums text-silver/80">{it.quantity}</span>
                            <StepBtn label="+" onClick={() => setQuantity(it.id, it.quantity + 1)} />
                            <button
                              type="button"
                              onClick={() => removeItem(it.id)}
                              className="ml-1 text-[0.6rem] uppercase tracking-widest text-red-300/80 hover:text-red-300"
                            >
                              Remove
                            </button>
                          </span>
                        ) : (
                          <span className="shrink-0 tabular-nums text-silver/60">×{it.quantity}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {canEdit && (
            <AddBagItemForm categories={categories} disabled={isAdding} onAdd={addItem} />
          )}
        </>
      )}
    </Panel>
  );
}

function StepBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-5 w-5 items-center justify-center rounded border border-gold/30 bg-midnight-800/70 font-display text-sm text-gold/90 transition-colors hover:border-gold/60"
    >
      {label}
    </button>
  );
}

/** Add-to-bag form: item name (with archive search), category, quantity. */
function AddBagItemForm({
  categories,
  disabled,
  onAdd,
}: {
  categories: string[];
  disabled: boolean;
  onAdd: (input: { category: string; name: string; itemId?: string | number | null; quantity: number }) => void;
}) {
  const [name, setName] = useState('');
  const [itemId, setItemId] = useState<string | number | null>(null);
  const [category, setCategory] = useState('General');
  const [qty, setQty] = useState('1');
  const [results, setResults] = useState<ItemPickResult[]>([]);
  const [open, setOpen] = useState(false);

  // Debounced archive search — clears the linked item id when the text is
  // edited so a hand-typed item is stored as a custom entry, not mis-linked.
  useEffect(() => {
    const q = name.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let active = true;
    const t = setTimeout(() => {
      searchItemsForPicker(q)
        .then((r) => active && setResults(r))
        .catch(() => active && setResults([]));
    }, 200);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [name]);

  const submit = () => {
    const n = name.trim();
    if (!n) return;
    onAdd({ category, name: n, itemId, quantity: Math.max(1, Number(qty) || 1) });
    setName('');
    setItemId(null);
    setResults([]);
    setOpen(false);
  };

  return (
    <div className="mt-4 border-t border-gold/15 pt-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="relative min-w-0 flex-1">
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setItemId(null);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Item name (searches the archive)…"
            className="w-full rounded border border-gold/30 bg-midnight-800/80 px-2 py-1 text-sm text-silver focus:border-gold/60 focus:outline-none"
          />
          {open && results.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded border border-gold/30 bg-midnight-900 shadow-lg">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setName(r.name);
                      setItemId(r.id);
                      setOpen(false);
                    }}
                    className="block w-full px-2 py-1 text-left text-sm text-silver/85 hover:bg-gold/10"
                  >
                    {r.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <input
          list="bag-category-options"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Category"
          className="w-28 rounded border border-gold/30 bg-midnight-800/80 px-2 py-1 text-sm text-silver focus:border-gold/60 focus:outline-none"
        />
        <datalist id="bag-category-options">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <input
          type="number"
          min={1}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="w-16 rounded border border-gold/30 bg-midnight-800/80 px-2 py-1 text-sm text-silver focus:border-gold/60 focus:outline-none"
        />
        <button
          type="button"
          disabled={disabled || !name.trim()}
          onClick={submit}
          className="rounded border border-gold/40 bg-gold/10 px-3 py-1 text-xs uppercase tracking-widest text-gold hover:bg-gold/20 disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------

function WeaponsPanel({ weapons }: { weapons: Weapon[] }) {
  if (weapons.length === 0) {
    return (
      <Panel title="Weapons" icon={<SwordIcon />}>
        <p className="py-4 text-center text-sm text-silver/50">No weapons carried.</p>
      </Panel>
    );
  }
  return (
    <Panel title={`Weapons (${weapons.length})`} icon={<SwordIcon />}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gold/25 text-[0.6rem] uppercase tracking-widest text-gold/80">
              <th className="py-1.5 pl-2 pr-3">Weapon</th>
              <th className="py-1.5 pr-3 text-center">Attack</th>
              <th className="py-1.5 pr-3">Damage</th>
              <th className="py-1.5 pr-3">Traits</th>
              <th className="py-1.5 pr-2 text-right">Prof</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gold/10">
            {weapons.map((w, i) => (
              <WeaponRow key={`${w.name ?? 'weapon'}-${i}`} weapon={w} />
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function WeaponRow({ weapon: w }: { weapon: Weapon }) {
  const runes = (w.runes ?? []).filter((r) => typeof r === 'string' && r.trim().length > 0);
  // Overlay-side weapons stash traits under an untyped `traits` field on the
  // merged shape; guard the untyped read here so both sources render cleanly.
  const overlayTraits = (w as unknown as { traits?: string[] }).traits;
  const traits: string[] = overlayTraits ?? runes;
  const label = weaponDisplayName(w);
  return (
    <tr className="align-top">
      <td className="py-2 pl-2 pr-3">
        <div className="font-display text-silver">{label}</div>
        {(w.mat || w.grade) && (
          <div className="mt-0.5 text-[0.65rem] uppercase tracking-widest text-silver/50">
            {[w.mat, w.grade].filter(Boolean).join(' · ')}
          </div>
        )}
        {runes.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {runes.map((r) => (
              <TinyChip key={r}>{r}</TinyChip>
            ))}
          </div>
        )}
      </td>
      <td className="py-2 pr-3 text-center font-display tabular-nums text-arcane">
        {w.attack != null ? fmtSigned(w.attack) : '—'}
      </td>
      <td className="py-2 pr-3 font-display text-silver">
        {formatDamage(w)}
      </td>
      <td className="py-2 pr-3">
        {traits.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {traits.slice(0, 5).map((t) => (
              <TinyChip key={t}>{t}</TinyChip>
            ))}
          </div>
        ) : (
          <span className="text-xs text-silver/40">—</span>
        )}
      </td>
      <td className="py-2 pr-2 text-right text-xs uppercase tracking-wider text-silver/60">
        {w.prof ?? '—'}
      </td>
    </tr>
  );
}

function weaponDisplayName(w: Weapon): string {
  const parts: string[] = [];
  if (typeof w.pot === 'number' && w.pot > 0) parts.push(`+${w.pot}`);
  const base = w.display || w.name || 'Weapon';
  parts.push(base);
  return parts.join(' ');
}

function formatDamage(w: Weapon): string {
  const die = w.die?.startsWith('d') ? `1${w.die}` : (w.die ?? '');
  const bonus =
    typeof w.damageBonus === 'number' && w.damageBonus !== 0
      ? w.damageBonus > 0
        ? `+${w.damageBonus}`
        : `${w.damageBonus}`
      : '';
  const dmgType = damageTypeLabel(w.damageType);
  return `${die}${bonus}${dmgType ? ` ${dmgType}` : ''}`.trim() || '—';
}

// ---------------------------------------------------------------
// Armor
// ---------------------------------------------------------------

function ArmorPanel({
  armor,
  totalAc,
  itemBonus,
}: {
  armor: Armor[];
  totalAc: number | undefined;
  itemBonus: number | undefined;
}) {
  const worn = resolveWornArmor(armor);
  const wornSet = new Set(worn);
  const carried = armor.filter((a) => !wornSet.has(a));

  // Pathbuilder can export a character with `armor: null` while still baking
  // the armor's +N into acItemBonus (happens when the armor section of the
  // build wasn't filled in but the AC total was calculated). In that case
  // the character IS mechanically wearing armor — we just don't know which
  // piece. Surface it as a placeholder rather than pretending they're
  // unarmored.
  const armorEntryMissing = worn.length === 0 && (itemBonus ?? 0) > 0;

  const wornSummary = worn[0]
    ? armorDisplayName(worn[0])
    : armorEntryMissing
      ? `Armor (+${itemBonus})`
      : 'None';

  return (
    <Panel title="Armor" icon={<ShieldIcon />}>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatBox label="AC" value={totalAc ?? '—'} />
        <StatBox label="Worn" value={wornSummary} />
        <StatBox label="Proficiency" value={worn[0]?.prof ?? '—'} />
      </div>

      {armorEntryMissing && (
        <div className="mb-4 rounded border border-arcane/30 bg-arcane/5 p-3 text-xs text-silver/80">
          <div className="mb-1 font-display text-[0.65rem] uppercase tracking-widest text-arcane">
            Armor details missing from Pathbuilder export
          </div>
          <p className="leading-relaxed">
            The AC math includes a{' '}
            <span className="text-arcane">+{itemBonus}</span> armor bonus, so
            this character <em>is</em> wearing armor — but the Pathbuilder JSON
            has no entry naming which piece. Re-export from Pathbuilder (with
            an armor selected) and re-import into the bot to fill this in.
          </p>
        </div>
      )}

      {armor.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gold/25 text-[0.6rem] uppercase tracking-widest text-gold/80">
                <th className="py-1.5 pl-2 pr-3">Piece</th>
                <th className="py-1.5 pr-3">Runes / Material</th>
                <th className="py-1.5 pr-3">Prof</th>
                <th className="py-1.5 pr-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gold/10">
              {[...worn, ...carried].map((a, i) => (
                <ArmorRow key={`${a.name ?? 'armor'}-${i}`} armor={a} isWorn={wornSet.has(a)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/**
 * "What is the character actually wearing?"
 *
 * Pathbuilder's `worn` field is inconsistently populated — sometimes a real
 * boolean, sometimes the string "true"/"false", sometimes missing entirely
 * (Pathbuilder assumes "if it's in your build, you're wearing it"). Fall
 * through:
 *   1. Any armor with a truthy `worn` (real true OR string "true") wins.
 *   2. Otherwise, the first non-Unarmored entry is treated as worn (most
 *      characters only list the armor they wear).
 *   3. If every entry looks Unarmored, or the array is empty, no worn armor.
 *
 * "Unarmored" is matched against BOTH `name` and `display` because some
 * Pathbuilder exports leave one of the two blank.
 */
function resolveWornArmor(armor: Armor[]): Armor[] {
  const explicit = armor.filter(isWornTruthy);
  if (explicit.length > 0) return explicit;
  const meaningful = armor.filter((a) => !isUnarmored(a));
  return meaningful.length > 0 ? [meaningful[0]] : [];
}

function isWornTruthy(a: Armor): boolean {
  const w = a.worn as unknown;
  if (w === true) return true;
  if (typeof w === 'string' && w.trim().toLowerCase() === 'true') return true;
  if (typeof w === 'number' && w > 0) return true;
  return false;
}

function isUnarmored(a: Armor): boolean {
  const name = (a.name ?? '').trim().toLowerCase();
  const display = (a.display ?? '').trim().toLowerCase();
  return name === 'unarmored' || display === 'unarmored';
}

function ArmorRow({ armor: a, isWorn }: { armor: Armor; isWorn: boolean }) {
  const runes = (a.runes ?? []).filter((r) => typeof r === 'string' && r.trim().length > 0);
  return (
    <tr className="align-top">
      <td className="py-2 pl-2 pr-3">
        <div className="font-display text-silver">{armorDisplayName(a)}</div>
        {a.res && (
          <div className="mt-0.5 text-[0.65rem] uppercase tracking-widest text-silver/50">
            Resilient {a.res}
          </div>
        )}
      </td>
      <td className="py-2 pr-3">
        <div className="flex flex-wrap items-center gap-1">
          {a.mat && <TinyChip>{a.mat}</TinyChip>}
          {a.grade && <TinyChip>{a.grade}</TinyChip>}
          {runes.map((r) => (
            <TinyChip key={r}>{r}</TinyChip>
          ))}
          {!a.mat && !a.grade && runes.length === 0 && (
            <span className="text-xs text-silver/40">—</span>
          )}
        </div>
      </td>
      <td className="py-2 pr-3 text-xs uppercase tracking-wider text-silver/60">
        {a.prof ?? '—'}
      </td>
      <td className="py-2 pr-2 text-right">
        {isWorn ? (
          <span className="rounded border border-emerald/40 bg-emerald/10 px-1.5 py-0.5 text-[0.6rem] font-display uppercase tracking-widest text-emerald-soft">
            Worn
          </span>
        ) : (
          <span className="text-xs text-silver/40">Stowed</span>
        )}
      </td>
    </tr>
  );
}

function armorDisplayName(a: Armor): string {
  const parts: string[] = [];
  if (typeof a.pot === 'number' && a.pot > 0) parts.push(`+${a.pot}`);
  parts.push(a.display || a.name || 'Armor');
  return parts.join(' ');
}

// ---------------------------------------------------------------
// Currency
// ---------------------------------------------------------------

type Denom = 'pp' | 'gp' | 'sp' | 'cp';

function CurrencyPanel({ currency, edit }: { currency: Money; edit: EditControls }) {
  const rows: Array<{ label: string; symbol: Denom }> = [
    { label: 'Platinum', symbol: 'pp' },
    { label: 'Gold', symbol: 'gp' },
    { label: 'Silver', symbol: 'sp' },
    { label: 'Copper', symbol: 'cp' },
  ];
  const total = totalGp(currency);

  // A jsonb write replaces the whole object, so seed from the currently
  // displayed purse (which may be the Pathbuilder `money` fallback on first
  // edit) and override just the one denomination that changed.
  const setDenom = (symbol: Denom, value: number) => {
    const next: Money = {
      pp: currency.pp ?? 0,
      gp: currency.gp ?? 0,
      sp: currency.sp ?? 0,
      cp: currency.cp ?? 0,
    };
    next[symbol] = Math.max(0, Math.floor(value));
    edit.update({ currency: next });
  };

  return (
    <Panel title="Currency" icon={<CoinsIcon />}>
      <dl className="space-y-1.5">
        {rows.map((r) => (
          <div
            key={r.symbol}
            className="flex items-center justify-between rounded border border-gold/15 bg-midnight-900/40 px-3 py-2"
          >
            <dt className="flex items-center gap-2">
              <span className="w-6 text-center font-display text-gold">{r.symbol}</span>
              <span className="text-sm text-silver/80">{r.label}</span>
            </dt>
            <dd className="font-display text-lg tabular-nums text-silver">
              <CoinValue
                value={currency[r.symbol]}
                editable={edit.enabled}
                onSet={(v) => setDenom(r.symbol, v)}
              />
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex items-baseline justify-between border-t border-gold/15 pt-3">
        <span className="text-[0.65rem] uppercase tracking-widest text-gold/70">
          Total (gp)
        </span>
        <span className="font-display text-xl tabular-nums text-gold">
          {total.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </span>
      </div>
    </Panel>
  );
}

/** One coin amount: static text, or click-to-edit number input when editable. */
function CoinValue({
  value,
  editable,
  onSet,
}: {
  value: number | undefined;
  editable: boolean;
  onSet: (value: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  if (!editable) {
    return <>{value != null ? value.toLocaleString() : '—'}</>;
  }

  if (editing) {
    const commit = () => {
      const n = Number(draft);
      if (!Number.isNaN(n)) onSet(n);
      setEditing(false);
    };
    return (
      <input
        autoFocus
        type="number"
        min={0}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(false);
        }}
        className="w-20 rounded border border-gold/40 bg-midnight-800 px-1 text-right font-display text-lg text-silver focus:outline-none"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(String(value ?? 0));
        setEditing(true);
      }}
      className="font-display tabular-nums text-silver hover:text-gold"
      title="Click to edit"
    >
      {value != null ? value.toLocaleString() : '0'}
    </button>
  );
}

// ---------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------

function InventoryPanel({
  inventory,
}: {
  inventory: Array<[string, number]>;
}) {
  if (inventory.length === 0) {
    return (
      <Panel title="Inventory" icon={<PouchIcon />}>
        <p className="py-4 text-center text-sm text-silver/50">Nothing carried.</p>
      </Panel>
    );
  }

  const sorted = [...inventory]
    .filter(([name]) => typeof name === 'string' && name.trim().length > 0)
    .sort((a, b) => a[0].localeCompare(b[0]));

  const totalQty = sorted.reduce((n, [, q]) => n + (q ?? 1), 0);

  return (
    <Panel title={`Inventory (${sorted.length} · ${totalQty} items)`} icon={<PouchIcon />}>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gold/25 text-[0.6rem] uppercase tracking-widest text-gold/80">
              <th className="py-1.5 pl-2 pr-3">Item</th>
              <th className="py-1.5 pr-2 text-right">Qty</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gold/10">
            {sorted.map(([name, qty]) => (
              <tr key={name} className="align-top">
                <td className="py-1.5 pl-2 pr-3 text-silver/85">{name}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-silver/80">
                  {qty > 1 ? `×${qty}` : '1'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------

function StatBox({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded border border-gold/20 bg-midnight-900/50 p-3 text-center">
      <div className="text-[0.6rem] uppercase tracking-widest text-silver/50">{label}</div>
      <div className="mt-1 font-display text-lg text-gold">{value}</div>
    </div>
  );
}

function TinyChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded border border-gold/20 bg-midnight-900/60 px-1.5 py-0.5 text-[0.6rem] uppercase tracking-widest text-silver/70">
      {children}
    </span>
  );
}

function fmtSigned(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}
