import type { ReactNode } from 'react';
import {
  acTotal,
  damageTypeLabel,
  totalGp,
  type Armor,
  type Money,
  type PathbuilderBuild,
  type Weapon,
} from '@/features/characters/pathbuilder';
import type { CharacterRow } from '@/features/characters/types';
import { mergeWeapons } from '@/features/characters/weapons';
import { Panel } from '../Sheet';
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
}: {
  character: CharacterRow;
  build: PathbuilderBuild;
}) {
  const weapons = mergeWeapons(build, character.overlay ?? null);
  const armor = build.armor ?? [];
  const inventory = build.equipment ?? [];
  const currency = character.currency ?? build.money ?? {};

  return (
    <div className="space-y-4">
      <WeaponsPanel weapons={weapons} />
      <ArmorPanel armor={armor} totalAc={acTotal(build)} />
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <CurrencyPanel currency={currency} />
        <InventoryPanel inventory={inventory} />
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
}: {
  armor: Armor[];
  totalAc: number | undefined;
}) {
  const worn = armor.filter((a) => a.worn);
  const carried = armor.filter((a) => !a.worn);

  return (
    <Panel title="Armor" icon={<ShieldIcon />}>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatBox label="AC" value={totalAc ?? '—'} />
        <StatBox
          label="Worn"
          value={worn[0] ? armorDisplayName(worn[0]) : 'None'}
        />
        <StatBox
          label="Proficiency"
          value={worn[0]?.prof ?? '—'}
        />
      </div>

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
                <ArmorRow key={`${a.name ?? 'armor'}-${i}`} armor={a} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function ArmorRow({ armor: a }: { armor: Armor }) {
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
        {a.worn ? (
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

function CurrencyPanel({ currency }: { currency: Money }) {
  const rows: Array<{ label: string; symbol: string; value: number | undefined }> = [
    { label: 'Platinum', symbol: 'pp', value: currency.pp },
    { label: 'Gold', symbol: 'gp', value: currency.gp },
    { label: 'Silver', symbol: 'sp', value: currency.sp },
    { label: 'Copper', symbol: 'cp', value: currency.cp },
  ];
  const total = totalGp(currency);
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
              {r.value != null ? r.value.toLocaleString() : '—'}
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
