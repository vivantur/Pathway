import { Link } from 'react-router-dom';
import { GildedRule } from '@/components/ui/GildedRule';
import { useAuth } from '@/features/auth/useAuth';

const pillars = [
  { title: 'Character Builder', body: 'Guided creation with beginner & learning modes, automatic math, and manual overrides.' },
  { title: 'Character Vault', body: 'Portraits, tokens, inventory, spellbooks, level history — every character, safely kept.' },
  { title: 'Rules Library', body: 'A searchable Pathfinder 2e archive: feats, spells, monsters, traits, and conditions.' },
  { title: 'Campaigns & Organizations', body: 'Run tables and entire West Marches communities with shared content and permissions.' },
  { title: 'Homebrew Workshop', body: 'Craft classes, ancestries, items and more — and publish them to your community.' },
  { title: 'Live Discord Sync', body: 'The website and the Pathway bot are two interfaces for one backend. Play anywhere.' },
];

export function LandingPage() {
  const { user } = useAuth();

  return (
    <div>
      <section className="mx-auto max-w-3xl text-center">
        <p className="font-display text-sm uppercase tracking-[0.3em] text-arcane/80">
          Pathfinder Second Edition
        </p>
        <h1 className="mt-4 font-display text-4xl leading-tight text-gold sm:text-5xl">
          Open the archive.
          <br />
          Build your legend.
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-silver/85">
          Pathway is the definitive digital platform for Pathfinder 2e — a
          character builder, rules library, campaign manager, and homebrew
          workshop that share one backend with the Pathway Discord bot.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            to={user ? '/vault' : '/login'}
            className="rounded-md bg-gold px-5 py-2.5 font-medium text-midnight-900 shadow-gilded transition-transform hover:-translate-y-0.5"
          >
            {user ? 'Open your Vault' : 'Enter Pathway'}
          </Link>
          <a
            href="https://www.pathwaypf2e.com"
            className="rounded-md border border-gold/30 px-5 py-2.5 text-silver/85 transition-colors hover:border-gold/60 hover:text-gold"
          >
            Learn more
          </a>
        </div>
      </section>

      <GildedRule className="mx-auto mt-16 max-w-2xl" />

      <section className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {pillars.map((p) => (
          <article
            key={p.title}
            className="rounded-lg border border-gold/15 bg-midnight-700/40 p-5 transition-colors hover:border-gold/35"
          >
            <h3 className="font-display text-gold">{p.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-silver/75">{p.body}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
