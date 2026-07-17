import { Link } from 'react-router-dom';

type Chamber = {
  numeral: string;
  title: string;
  body: string;
  /** Present on shipped chambers; absent ones render as a "SOON" seal. */
  to?: string;
};

const CHAMBERS: Chamber[] = [
  {
    numeral: 'I',
    title: 'Character Forge',
    body: 'Guided creation with a beginner mode that teaches the rules as you choose. Every boost, feat and spell — calculated, explained, exportable.',
    to: '/vault/create',
  },
  {
    numeral: 'II',
    title: 'Character Vault',
    body: 'Portraits, tokens, banners, inventory, spellbooks, level history and an audit log. Import from Pathbuilder; export to PDF whenever you wish.',
    to: '/vault',
  },
  {
    numeral: 'III',
    title: 'Rules Library',
    body: 'A searchable archive of feats, spells, monsters, traits and conditions — Remaster and Legacy side by side, one ⌘K away from anywhere.',
    to: '/rules',
  },
  {
    numeral: 'IV',
    title: 'Campaign Chronicle',
    body: 'NPCs, journals, loot, quests and session recaps in one ledger — with permissions for multiple GMs and whole organizations.',
  },
  {
    numeral: 'V',
    title: 'Companions',
    body: 'Animal companions, familiars, eidolons and mounts — each with its own sheet, portrait and Discord-side sync.',
  },
  {
    numeral: 'VI',
    title: 'Homebrew Workshop',
    body: 'Craft classes, ancestries, items and monsters. Keep them private, share with your campaign, or publish to the whole community.',
  },
];

const CARD =
  'relative rounded-b-[10px] border border-line border-t-[3px] border-t-gold bg-surface p-7';

export function Archives() {
  return (
    <section
      id="archives"
      className="relative z-[1] scroll-mt-10 bg-[linear-gradient(180deg,transparent,rgb(var(--c-midnight-700)/.25)_20%,rgb(var(--c-midnight-700)/.25)_80%,transparent)] px-8 pb-[30px] pt-20"
    >
      <div className="mx-auto max-w-[1280px]">
        <div data-reveal className="mb-[52px] text-center">
          <p className="font-display text-xs font-semibold uppercase tracking-[0.34em] text-arcane">
            The Archives
          </p>
          <h2 className="mt-3.5 font-display text-[40px] font-bold text-gold-soft">
            Six chambers. One key.
          </h2>
          <p className="mx-auto mt-3.5 max-w-[540px] text-[19px] leading-[1.6] text-dim">
            Everything a player, GM, or whole West Marches server needs — under one sigil, never
            behind a paywall.
          </p>
        </div>

        <div className="grid gap-[22px] wide:grid-cols-3">
          {CHAMBERS.map((c) =>
            c.to ? (
              <Link
                key={c.numeral}
                to={c.to}
                data-reveal
                className={`${CARD} block transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-1 hover:border-line-strong hover:shadow-[0_0_40px_-10px_var(--glow)]`}
              >
                <ChamberBody chamber={c} />
              </Link>
            ) : (
              <div key={c.numeral} data-reveal className={`${CARD} opacity-85`}>
                <span className="absolute right-4 top-4 flex h-[52px] w-[52px] -rotate-12 items-center justify-center rounded-full border-[1.5px] border-line-strong font-display text-[10px] font-bold tracking-[0.2em] text-gold">
                  SOON
                </span>
                <ChamberBody chamber={c} />
              </div>
            ),
          )}
        </div>
      </div>
    </section>
  );
}

function ChamberBody({ chamber }: { chamber: Chamber }) {
  return (
    <>
      <p className="font-display text-[13px] tracking-[0.3em] text-arcane">{chamber.numeral}</p>
      <h3 className="mt-2.5 font-display text-[21px] font-bold text-gold-soft">{chamber.title}</h3>
      <p className="mt-2.5 text-[16.5px] leading-[1.6] text-dim">{chamber.body}</p>
    </>
  );
}
