import { Link } from 'react-router-dom';
import { GildedRule } from '@/components/ui/GildedRule';
import { GithubIcon, DiscordIcon, MailIcon } from '@/components/ui/RuneIcon';
import { links } from '@/lib/links';

const footerNav = [
  { to: '/', label: 'Home' },
  { to: '/about', label: 'About' },
  { to: '/roadmap', label: 'Roadmap' },
  { to: '/vault', label: 'Vault' },
];

export function Footer() {
  return (
    <footer className="mt-16 border-t border-gold/15 bg-midnight-900/70">
      <div className="mx-auto w-full max-w-6xl px-4 py-10">
        <div className="grid gap-10 sm:grid-cols-3">
          <div>
            <Link to="/" className="flex items-center gap-2.5">
              <img src="/favicon.svg" alt="" className="h-7 w-7" />
              <span className="font-display text-lg tracking-wide text-gold">Pathway</span>
            </Link>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-silver/60">
              The definitive digital platform for Pathfinder Second Edition — a
              character vault, rules library, and Discord-native ecosystem.
            </p>
          </div>

          <nav aria-label="Footer">
            <h3 className="font-display text-sm uppercase tracking-[0.2em] text-gold/80">
              Navigate
            </h3>
            <ul className="mt-3 space-y-1.5 text-sm">
              {footerNav.map((item) => (
                <li key={item.to}>
                  <Link to={item.to} className="text-silver/70 transition-colors hover:text-gold">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <h3 className="font-display text-sm uppercase tracking-[0.2em] text-gold/80">
              Find us
            </h3>
            <ul className="mt-3 space-y-2 text-sm">
              {links.communityDiscord ? (
                <li>
                  <a
                    href={links.communityDiscord}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 text-silver/70 transition-colors hover:text-gold"
                  >
                    <DiscordIcon size={16} /> Pathway Discord
                  </a>
                </li>
              ) : null}
              <li>
                <a
                  href={links.addBotToServer}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 text-silver/70 transition-colors hover:text-gold"
                >
                  <DiscordIcon size={16} /> Add the bot to your server
                </a>
              </li>
              <li>
                <a
                  href={links.github}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 text-silver/70 transition-colors hover:text-gold"
                >
                  <GithubIcon size={16} /> GitHub
                </a>
              </li>
              <li>
                <a
                  href={links.contactEmail}
                  className="inline-flex items-center gap-2 text-silver/70 transition-colors hover:text-gold"
                >
                  <MailIcon size={16} /> Contact
                </a>
              </li>
            </ul>
          </div>
        </div>

        <GildedRule className="my-8" />

        <p className="text-center text-xs text-silver/40">
          Pathway is an independent fan project. Pathfinder and its logos are trademarks
          of Paizo Inc. Used under the Community Use Policy. © {new Date().getFullYear()} Pathway.
        </p>
      </div>
    </footer>
  );
}
