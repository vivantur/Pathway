import { Link } from 'react-router-dom';
import { GildedRule } from '@/components/ui/GildedRule';
import {
  BookIcon,
  ShieldIcon,
  ScrollIcon,
  UsersIcon,
  SparklesIcon,
  CompassIcon,
  DiscordIcon,
} from '@/components/ui/RuneIcon';
import { useAuth } from '@/features/auth/useAuth';
import { links } from '@/lib/links';

const audiences = [
  {
    title: 'For players',
    icon: ShieldIcon,
    body: 'Build characters with guided creation, beginner & learning modes, and tooltips that teach the rules as you go. Keep portraits, tokens, inventory, and spellbooks in one Vault.',
  },
  {
    title: 'For GMs',
    icon: ScrollIcon,
    body: 'Run campaigns from a single dashboard — NPCs, journals, loot, quests, session recaps. Pathway syncs to the Discord bot so play happens wherever your table lives.',
  },
  {
    title: 'For communities',
    icon: UsersIcon,
    body: 'Designed for West Marches and Discord-native servers. Multiple GMs, shared homebrew, organization-wide libraries, and roles for moderators and admins.',
  },
];

const pillars = [
  {
    title: 'Rules Library',
    icon: BookIcon,
    body: 'A searchable archive of feats, spells, monsters, traits, conditions, and source books — both Remaster and Legacy, side by side.',
  },
  {
    title: 'Character Vault',
    icon: ShieldIcon,
    body: 'Every character, with portraits, tokens, banners, inventory, spellbook, level history, and an audit log. Export to Pathbuilder or PDF anytime.',
  },
  {
    title: 'Companions',
    icon: SparklesIcon,
    body: 'Animal companions, familiars, eidolons, mounts, and custom companions — each with their own sheet and Discord-side sync.',
  },
  {
    title: 'Campaigns',
    icon: ScrollIcon,
    body: 'Players, NPCs, journals, loot, quests, session recaps, and shared homebrew. Permissions for multiple GMs and organizations.',
  },
  {
    title: 'Homebrew Workshop',
    icon: SparklesIcon,
    body: 'Craft classes, ancestries, items, monsters and more. Keep them private, share with a campaign, or publish to the community.',
  },
  {
    title: 'Discord-native',
    icon: DiscordIcon,
    body: 'The Pathway bot and the website are two interfaces for one backend. Edit on Discord, see it on the web — and vice versa.',
  },
];

export function LandingPage() {
  const { user } = useAuth();

  return (
    <div>
      {/* HERO */}
      <section className="mx-auto max-w-3xl text-center">
        <p className="font-display text-sm uppercase tracking-[0.3em] text-arcane/80">
          Pathfinder Second Edition
        </p>
        <h1 className="mt-4 font-display text-4xl leading-tight text-gold sm:text-5xl md:text-6xl">
          Open the archive.
          <br />
          Inscribe your legend.
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-silver/85">
          Pathway is the all-in-one platform for Pathfinder 2e — a character
          builder, rules library, campaign manager, and homebrew workshop that
          share one backend with the Pathway Discord bot.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            to={user ? '/vault' : '/login'}
            className="rounded-md bg-gold px-5 py-2.5 font-medium text-midnight-900 shadow-gilded transition-transform hover:-translate-y-0.5"
          >
            {user ? 'Open your Vault' : 'Enter Pathway'}
          </Link>
          <a
            href={links.addBotToServer}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-gold/30 px-5 py-2.5 text-silver/90 transition-colors hover:border-gold/60 hover:text-gold"
          >
            <DiscordIcon size={18} />
            Add the bot to your server
          </a>
        </div>
        <p className="mt-3 text-xs text-silver/40">
          Free to use · Both Remaster and Legacy rules · No credit card required
        </p>
      </section>

      <GildedRule className="mx-auto mt-16 max-w-2xl" />

      {/* AUDIENCES */}
      <section className="mt-12">
        <h2 className="text-center font-display text-2xl text-gold">
          Built for the whole table
        </h2>
        <div className="mt-8 grid gap-5 sm:grid-cols-3">
          {audiences.map((a) => {
            const Icon = a.icon;
            return (
              <article
                key={a.title}
                className="rounded-lg border border-gold/15 bg-midnight-700/40 p-6 transition-colors hover:border-gold/35"
              >
                <div className="flex items-center gap-3 text-gold">
                  <Icon size={22} />
                  <h3 className="font-display text-lg">{a.title}</h3>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-silver/75">{a.body}</p>
              </article>
            );
          })}
        </div>
      </section>

      {/* PILLARS */}
      <section className="mt-16">
        <h2 className="text-center font-display text-2xl text-gold">
          One platform, many tools
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-sm text-silver/70">
          Designed so a player can learn the rules, build a character, run a campaign, and
          publish homebrew without ever leaving the Pathway ecosystem.
        </p>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {pillars.map((p) => {
            const Icon = p.icon;
            return (
              <article
                key={p.title}
                className="rounded-lg border border-gold/15 bg-midnight-700/40 p-5 transition-colors hover:border-gold/35"
              >
                <Icon size={22} className="text-gold" />
                <h3 className="mt-3 font-display text-lg text-gold">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-silver/75">{p.body}</p>
              </article>
            );
          })}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto mt-20 max-w-2xl rounded-lg border border-gold/25 bg-midnight-700/60 p-8 text-center shadow-gilded">
        <CompassIcon size={32} className="mx-auto text-arcane" />
        <h2 className="mt-4 font-display text-2xl text-gold">Start your path</h2>
        <p className="mx-auto mt-3 max-w-md text-sm text-silver/80">
          Create a free account, link your Discord, and open your first character
          sheet. Bring the bot to your table whenever you&apos;re ready.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            to={user ? '/vault' : '/login'}
            className="rounded-md bg-gold px-5 py-2.5 font-medium text-midnight-900 shadow-gilded transition-transform hover:-translate-y-0.5"
          >
            {user ? 'Open your Vault' : 'Create an account'}
          </Link>
          <Link
            to="/roadmap"
            className="rounded-md border border-gold/30 px-5 py-2.5 text-silver/90 transition-colors hover:border-gold/60 hover:text-gold"
          >
            See the roadmap
          </Link>
        </div>
      </section>
    </div>
  );
}
