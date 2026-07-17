import { Link } from 'react-router-dom';
import { GildedRule } from '@/components/ui/GildedRule';
import { links } from '@/lib/links';
import { Sigil } from './Sigil';

const NAVIGATE = [
  { to: '/', label: 'Home' },
  { to: '/about', label: 'About' },
  { to: '/roadmap', label: 'Roadmap' },
  { to: '/rules', label: 'Rules Library' },
  { to: '/vault', label: 'Character Vault' },
];

const linkClass = 'text-dim transition-colors hover:text-gold';

const legalLink =
  'text-arcane/70 underline decoration-arcane/30 underline-offset-2 hover:decoration-arcane/70';

export function LandingFooter() {
  return (
    <footer className="relative z-[1] border-t border-line bg-[linear-gradient(180deg,transparent,rgb(var(--c-midnight-950)/.4))]">
      <div className="mx-auto max-w-[1280px] px-8 pb-10 pt-[52px]">
        <div className="grid gap-10 wide:grid-cols-[1.3fr_1fr_1fr]">
          <div>
            <Link to="/" className="flex items-center gap-2.5">
              <Sigil size={26} variant="bare" />
              <span className="font-display text-[17px] font-bold tracking-[0.12em] text-gold-soft">
                PATHWAY
              </span>
            </Link>
            <p className="mt-3.5 max-w-[320px] text-[15.5px] leading-[1.6] text-faint">
              The Pathfinder Second Edition companion — a character forge, rules archive and
              campaign chronicle, twinned with a Discord bot.
            </p>
          </div>

          <nav aria-label="Footer">
            <p className="font-display text-xs uppercase tracking-[0.25em] text-gold">Navigate</p>
            <div className="mt-3.5 flex flex-col gap-[9px] text-[15px]">
              {NAVIGATE.map((n) => (
                <Link key={n.to} to={n.to} className={linkClass}>
                  {n.label}
                </Link>
              ))}
            </div>
          </nav>

          <div>
            <p className="font-display text-xs uppercase tracking-[0.25em] text-gold">Find us</p>
            <div className="mt-3.5 flex flex-col gap-[9px] text-[15px]">
              {links.communityDiscord && (
                <a href={links.communityDiscord} target="_blank" rel="noreferrer" className={linkClass}>
                  Pathway Discord
                </a>
              )}
              <a href={links.addBotToServer} target="_blank" rel="noreferrer" className={linkClass}>
                Add the bot to your server
              </a>
              <a href={links.github} target="_blank" rel="noreferrer" className={linkClass}>
                GitHub
              </a>
              <Link to="/contact" className={linkClass}>
                Contact
              </Link>
            </div>
          </div>
        </div>

        <GildedRule className="mb-[22px] mt-9" />

        {/* Legal block — carried over verbatim from the site footer. This is the
            licensing basis for the whole project; don't paraphrase it. */}
        <div className="mx-auto max-w-[760px] space-y-2 text-center text-[12.5px] leading-[1.7] text-faint">
          <p>
            Pathway is an independent fan project. It uses trademarks and/or copyrights owned by
            Paizo Inc., used under Paizo&apos;s{' '}
            <a href="https://paizo.com/community/communityuse" target="_blank" rel="noreferrer" className={legalLink}>
              Community Use Policy
            </a>
            . We are expressly prohibited from charging you to use or access this content. Pathway
            is not published, endorsed, or specifically approved by Paizo. For more information
            about Paizo Inc. and Paizo products, visit{' '}
            <a href="https://paizo.com" target="_blank" rel="noreferrer" className={legalLink}>
              paizo.com
            </a>
            .
          </p>
          <p>
            Pathfinder Second Edition Remaster rules content is used under the{' '}
            <a
              href="https://paizo.com/orclicense"
              target="_blank"
              rel="noreferrer"
              className={legalLink}
            >
              ORC License
            </a>
            . © {new Date().getFullYear()} Pathway.
          </p>
        </div>
      </div>
    </footer>
  );
}
