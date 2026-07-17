import { Sigil } from './Sigil';

export function VaultQuote() {
  return (
    <section id="forge" className="relative z-[1] scroll-mt-10 px-10 py-[110px] text-center">
      <div data-reveal>
        <Sigil size={44} variant="outer" className="mx-auto animate-sigilpulse" />
        <p className="mx-auto mt-[26px] max-w-[760px] text-[30px] italic leading-[1.5] text-silver [text-wrap:balance]">
          &ldquo;The dice remember nothing.{' '}
          <span className="text-gold-soft">The archive remembers everything</span> — every crit,
          every recap, every hero who walked the path.&rdquo;
        </p>
        <p className="mt-[18px] font-display text-xs uppercase tracking-[0.3em] text-faint">
          — inscription over the vault door
        </p>
      </div>
    </section>
  );
}
