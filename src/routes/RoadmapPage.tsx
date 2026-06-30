import { GildedRule } from '@/components/ui/GildedRule';

type Status = 'done' | 'in-progress' | 'next' | 'later';

const phases: Array<{
  id: string;
  title: string;
  status: Status;
  bullets: string[];
}> = [
  {
    id: 'W0',
    title: 'Phase W0 — Foundations',
    status: 'in-progress',
    bullets: [
      'Website live at www.pathwaypf2e.com on a custom domain with HTTPS',
      'Connected to Supabase with the safe (anon) key under row-level security',
      'Email magic-link sign-in working end-to-end',
      'Vault scaffolded, ready to show characters once the data is in place',
    ],
  },
  {
    id: 'W1',
    title: 'Phase W1 — One identity for web and Discord',
    status: 'next',
    bullets: [
      'Sign in with Discord, in one click',
      'Link an existing web account to a Discord identity',
      'A single Pathway account, however you reach it',
    ],
  },
  {
    id: 'W2',
    title: 'Phase W2 — Live sync with the bot',
    status: 'later',
    bullets: [
      'Open your character on the web; see HP and XP change in real time as the bot runs combat',
      'Edit on the web, see the bot use the new values instantly',
      'No more "refresh and hope" — the website and the bot agree on every value',
    ],
  },
  {
    id: 'W3',
    title: 'Phase W3 — Character builder & vault',
    status: 'later',
    bullets: [
      'Guided creation with Beginner and Learning modes',
      'Tooltips that teach as you build; automatic calculations with manual overrides',
      'Portraits, tokens, banners; Pathbuilder JSON and PDF export',
      'Variant rules: Free Archetype, ABP, Ancestry Paragon, Gradual Boosts',
    ],
  },
  {
    id: 'W4',
    title: 'Phase W4 — Companions, inventory, notes',
    status: 'later',
    bullets: [
      'Animal companions, familiars, eidolons, mounts, and custom companions',
      'Bags, inventory, downtime, and per-character notes',
      'All live-synced with the Discord bot',
    ],
  },
  {
    id: 'W5',
    title: 'Phase W5 — Rules library & homebrew workshop',
    status: 'later',
    bullets: [
      'A searchable Pathfinder 2e archive: feats, spells, monsters, traits, conditions',
      'Authoring tools for classes, ancestries, items, monsters, and more',
      'Publish private, to a campaign, an organization, or the public',
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
            <ul className="mt-4 space-y-2 text-sm leading-relaxed text-silver/80">
              {phase.bullets.map((b) => (
                <li key={b} className="flex gap-3">
                  <span className="mt-2 inline-block h-1.5 w-1.5 shrink-0 rotate-45 bg-gold/70" />
                  <span>{b}</span>
                </li>
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
