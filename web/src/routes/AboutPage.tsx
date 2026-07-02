import { Link } from 'react-router-dom';
import { GildedRule } from '@/components/ui/GildedRule';
import { CompassIcon, SparklesIcon, BookIcon } from '@/components/ui/RuneIcon';

export function AboutPage() {
  return (
    <article className="mx-auto max-w-3xl">
      <header className="text-center">
        <p className="font-display text-sm uppercase tracking-[0.3em] text-arcane/80">
          About Pathway
        </p>
        <h1 className="mt-4 font-display text-4xl text-gold">A platform built around the table</h1>
        <p className="mx-auto mt-4 max-w-xl text-silver/80">
          Pathway is the single home we always wanted for Pathfinder Second Edition.
          A rulebook, a vault, a campaign manager, and a Discord-native bot — built
          for players, GMs, and entire communities.
        </p>
      </header>

      <GildedRule className="my-10" />

      <section className="space-y-4 leading-relaxed text-silver/85">
        <p>
          Running Pathfinder 2e well takes a stack of tools. A rules reference open in
          one tab. A character sheet open in another. A campaign manager somewhere
          else. A Discord bot for dice and combat. And the inevitable spreadsheet for
          everything those tools forgot.
        </p>
        <p>
          Pathway is the answer to that mess. One platform for the rules, the
          characters, the campaigns, the homebrew — and a Discord bot that&apos;s a
          first-class part of the same backend. Edit on the web, see it on Discord.
          Roll dice on Discord, watch the website update live. The bot and the website
          are not two products that talk to each other. They are <em>one</em> product
          with two faces.
        </p>
      </section>

      <section className="mt-12 grid gap-5 sm:grid-cols-3">
        <Pillar
          icon={<BookIcon size={22} className="text-gold" />}
          title="Faithful to the rules"
          body="Remaster first. Legacy supported. Sources, errata, and prerequisites tracked so a feat tells you exactly where it came from."
        />
        <Pillar
          icon={<SparklesIcon size={22} className="text-gold" />}
          title="Designed for immersion"
          body="An adventurer's grimoire — midnight blues, gold filigree, arcane runes. Fantasy is here to enhance usability, never to fight it."
        />
        <Pillar
          icon={<CompassIcon size={22} className="text-gold" />}
          title="Open by default"
          body="The website is open-source and built on web standards. The architecture is documented. The roadmap is public."
        />
      </section>

      <GildedRule className="my-12" />

      <section className="space-y-4 leading-relaxed text-silver/85">
        <h2 className="font-display text-2xl text-gold">A long-running project</h2>
        <p>
          Pathway is built to last. We sequence work in phases, write architecture
          documents before code, and treat every decision as something a future
          maintainer should be able to read and understand. The goal isn&apos;t a quick
          launch — it&apos;s a platform that&apos;s still here in a decade.
        </p>
        <p>
          If you want to follow along, the source for the website is on GitHub and the
          development phases are laid out in the{' '}
          <Link to="/roadmap" className="text-gold underline-offset-4 hover:underline">
            roadmap
          </Link>
          .
        </p>
      </section>

      <section className="mt-10 rounded-lg border border-arcane/25 bg-arcane/5 p-6 text-center">
        <p className="text-sm text-silver/85">
          Pathway is an independent fan project. Pathfinder and its logos are trademarks
          of Paizo Inc., used under the Community Use Policy. We&apos;re not affiliated
          with Paizo.
        </p>
      </section>
    </article>
  );
}

function Pillar({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-lg border border-gold/15 bg-midnight-700/40 p-5">
      {icon}
      <h3 className="mt-3 font-display text-gold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-silver/75">{body}</p>
    </div>
  );
}
