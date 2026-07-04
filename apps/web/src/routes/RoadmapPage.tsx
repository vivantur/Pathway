import { GildedRule } from '@/components/ui/GildedRule';

type Status = 'done' | 'in-progress' | 'next' | 'later';

/** A bullet is either plain text, or text with an explicit done/pending flag. */
type Bullet = string | { text: string; done: boolean };

const phases: Array<{
  id: string;
  title: string;
  status: Status;
  bullets: Bullet[];
}> = [
  {
    id: 'W0',
    title: 'Phase W0 — Foundations',
    status: 'done',
    bullets: [
      'Website live at www.pathwaypf2e.com on a custom domain with HTTPS',
      'Connected to Supabase with the safe (anon) key under row-level security',
      'Email and Discord sign-in working end-to-end',
      'The Vault reads your real characters through RLS',
    ],
  },
  {
    id: 'W1',
    title: 'Phase W1 — One identity for web and Discord',
    status: 'done',
    bullets: [
      'Sign in with Discord in one click',
      'Your first login automatically claims your existing bot characters',
      'Brand-new players get an account created for them on the spot',
      'One Pathway identity, whether you arrive from Discord or the web',
    ],
  },
  {
    id: 'W2',
    title: 'Phase W2 — Live sync with the bot',
    status: 'done',
    bullets: [
      'Open your character on the web and watch HP, XP, and hero points change in real time as the bot runs combat',
      'A "Live" indicator shows the connection; no more "refresh and hope"',
      'The website and the bot are two views of one backend',
    ],
  },
  {
    id: 'W3',
    title: 'Phase W3 — Character vault, sheet & builder',
    status: 'done',
    bullets: [
      { text: 'Import a character from Pathbuilder by ID', done: true },
      {
        text: 'Full sheet: Overview, Ancestry, Class, Abilities, Skills, Feats, Spells, Equipment, Journal',
        done: true,
      },
      { text: 'Spell and feat descriptions with full rules text', done: true },
      { text: 'Portrait uploads, update-from-Pathbuilder, delete, and public share links', done: true },
      { text: 'PDF character-sheet export and a light/dark, mobile-responsive layout', done: true },
      {
        text: 'In-browser editing of live state — HP, hero points, dying/wounded, XP, currency, focus points, and bio — live-synced to the bot',
        done: true,
      },
      { text: 'Guided step-by-step builder with Beginner Mode guidance and auto-calculation', done: true },
      { text: 'Build, level up, and edit characters straight into your vault — the bot reads them back', done: true },
      { text: 'Variant rules: Free Archetype, Automatic Bonus Progression, Ancestry Paragon, Gradual Boosts', done: true },
      { text: 'Level-accurate proficiency for saves, Perception, class DC, spell DC, and AC', done: true },
    ],
  },
  {
    id: 'W4',
    title: 'Phase W4 — Companions, inventory, notes',
    status: 'next',
    bullets: [
      { text: 'Inventory, currency, and notes shown on the sheet', done: true },
      { text: 'Companions tab showing build-imported companions', done: true },
      { text: 'Companion creator — animal companions, familiars, eidolons, mounts, and custom, each with their own sheet and bot sync', done: false },
      { text: 'Editable bags, downtime, and per-character notes', done: false },
      { text: 'All live-synced with the Discord bot', done: false },
    ],
  },
  {
    id: 'W5',
    title: 'Phase W5 — Rules library & homebrew workshop',
    status: 'in-progress',
    bullets: [
      { text: 'Searchable archive: feats, spells, items, conditions, ancestries, backgrounds', done: true },
      { text: 'Remaster preferred, Archive of Nethys links, full descriptions', done: true },
      { text: 'Monsters in the library with full stat blocks — art, saves, and attacks', done: true },
      { text: 'Traits reference', done: false },
      { text: 'Full-text search across descriptions', done: false },
      { text: 'Authoring tools for classes, ancestries, items, and monsters', done: false },
      { text: 'Publish private, to a campaign, an organization, or the public', done: false },
    ],
  },
  {
    id: 'W6',
    title: 'Phase W6 — Campaigns, organizations, encounters',
    status: 'later',
    bullets: [
      'Campaign dashboards: players, NPCs, journals, loot, quests, recaps',
      'Organizations for West Marches: multiple GMs, shared libraries, role-based permissions',
      "Encounter tracking that pairs with the bot's combat",
    ],
  },
  {
    id: 'W7',
    title: 'Phase W7+ — Marketplace, public API, offline',
    status: 'later',
    bullets: [
      'A marketplace for builds, adventures, encounter and monster packs',
      'Public API and plugin framework for Foundry, Roll20, Owlbear, and more',
      'Offline-ready character sheets with reconcile-on-reconnect',
    ],
  },
];

const statusMeta: Record<Status, { label: string; className: string }> = {
  done: {
    label: 'Done',
    className: 'border-emerald/40 bg-emerald/15 text-emerald-soft',
  },
  'in-progress': {
    label: 'In progress',
    className: 'border-arcane/40 bg-arcane/15 text-arcane-soft',
  },
  next: {
    label: 'Next',
    className: 'border-gold/40 bg-gold/15 text-gold-soft',
  },
  later: {
    label: 'Later',
    className: 'border-silver/20 bg-silver/5 text-silver/70',
  },
};

function BulletRow({ bullet }: { bullet: Bullet }) {
  const text = typeof bullet === 'string' ? bullet : bullet.text;
  const done = typeof bullet === 'string' ? undefined : bullet.done;

  return (
    <li className="flex gap-3">
      {done === undefined ? (
        <span className="mt-2 inline-block h-1.5 w-1.5 shrink-0 rotate-45 bg-gold/70" />
      ) : done ? (
        <span className="mt-0.5 shrink-0 font-display text-emerald-soft" aria-label="done">✓</span>
      ) : (
        <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full border border-silver/40" aria-label="planned" />
      )}
      <span className={done === false ? 'text-silver/55' : 'text-silver/80'}>{text}</span>
    </li>
  );
}

export function RoadmapPage() {
  return (
    <article className="mx-auto max-w-3xl">
      <header className="text-center">
        <p className="font-display text-sm uppercase tracking-[0.3em] text-arcane/80">
          Roadmap
        </p>
        <h1 className="mt-4 font-display text-4xl text-gold">The path ahead</h1>
        <p className="mx-auto mt-4 max-w-xl text-silver/80">
          Pathway is built in phases. Each one ends with a real, working capability —
          not a half-finished demo. Below is the public plan; the technical detail lives
          in the architecture documents alongside the source.
        </p>
      </header>

      <GildedRule className="my-10" />

      <ol className="space-y-6">
        {phases.map((phase) => (
          <li
            key={phase.id}
            className="rounded-lg border border-gold/15 bg-midnight-700/40 p-6"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="font-display text-xl text-gold">{phase.title}</h2>
              <span
                className={`rounded-full border px-3 py-0.5 text-xs uppercase tracking-wider ${statusMeta[phase.status].className}`}
              >
                {statusMeta[phase.status].label}
              </span>
            </div>
            <ul className="mt-4 space-y-2 text-sm leading-relaxed">
              {phase.bullets.map((b) => (
                <BulletRow key={typeof b === 'string' ? b : b.text} bullet={b} />
              ))}
            </ul>
          </li>
        ))}
      </ol>

      <section className="mx-auto mt-12 max-w-xl rounded-lg border border-arcane/25 bg-arcane/5 p-6 text-center">
        <p className="text-sm text-silver/80">
          This roadmap is a plan, not a promise. Phases are gates, not deadlines —
          we never rush, and we never ship a change that could compromise data.
        </p>
      </section>
    </article>
  );
}
