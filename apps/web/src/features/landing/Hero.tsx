import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { CornerBrackets } from '@/components/ui/CornerBrackets';
import { DiscordIcon } from '@/components/ui/RuneIcon';
import { useAuth } from '@/features/auth/useAuth';
import { links } from '@/lib/links';
import { useParallax } from './motion';

/** Tiled star layers. Two sizes at different scroll rates give the field depth. */
const STARS_NEAR =
  'radial-gradient(1.6px 1.6px at 22px 34px, rgba(255,255,255,.9), transparent),' +
  'radial-gradient(1px 1px at 180px 120px, rgba(201,209,224,.7), transparent),' +
  'radial-gradient(1.2px 1.2px at 340px 60px, rgba(139,233,242,.8), transparent),' +
  'radial-gradient(1px 1px at 420px 210px, rgba(232,207,126,.8), transparent),' +
  'radial-gradient(1.4px 1.4px at 120px 300px, rgba(255,255,255,.6), transparent)';

const STARS_FAR =
  'radial-gradient(1px 1px at 60px 80px, rgba(255,255,255,.5), transparent),' +
  'radial-gradient(1px 1px at 300px 200px, rgba(139,233,242,.5), transparent),' +
  'radial-gradient(1.2px 1.2px at 520px 100px, rgba(232,207,126,.6), transparent),' +
  'radial-gradient(1px 1px at 640px 320px, rgba(201,209,224,.5), transparent)';

/** Rising embers: [left, bottom, size, color, duration, delay]. */
const EMBERS = [
  { left: '18%', bottom: '8%', size: 4, gold: true, duration: '9s', delay: '0s' },
  { left: '38%', bottom: '4%', size: 3, gold: false, duration: '12s', delay: '3s' },
  { left: '61%', bottom: '6%', size: 4, gold: true, duration: '10s', delay: '5s' },
  { left: '80%', bottom: '10%', size: 3, gold: false, duration: '11s', delay: '1.5s' },
  { left: '50%', bottom: '2%', size: 3, gold: true, duration: '13s', delay: '7s' },
];

/** Fixed twinkling stars: [left, top, size, color, duration, delay]. */
const TWINKLES = [
  { left: '14%', top: '18%', size: 5, color: 'rgb(var(--c-gold-soft))', duration: '3.4s', delay: '0s' },
  { left: '84%', top: '14%', size: 4, color: 'rgb(var(--c-arcane-soft))', duration: '4.2s', delay: '1s' },
  { left: '74%', top: '58%', size: 4, color: '#fff', duration: '2.8s', delay: '.6s' },
  { left: '22%', top: '64%', size: 3, color: 'rgb(var(--c-gold-soft))', duration: '3.9s', delay: '1.8s' },
];

export function Hero() {
  const { user } = useAuth();
  const near = useRef<HTMLDivElement>(null);
  const far = useRef<HTMLDivElement>(null);
  useParallax(near, far);

  return (
    <section className="relative z-[1] px-10 pb-[140px] pt-[104px] text-center">
      {/* Gilded double-hairline frame */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-[26px] inset-x-8 z-[2] border border-line-strong outline outline-1 outline-offset-[5px] outline-line"
      >
        <CornerBrackets size={26} thickness={2} inset={-1} color="rgb(var(--c-gold))" />
      </div>

      {/* Star field (parallax) */}
      <div
        ref={near}
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -inset-y-20 opacity-[var(--stars-op)]"
        style={{ backgroundImage: STARS_NEAR, backgroundSize: '480px 380px' }}
      />
      <div
        ref={far}
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -inset-y-20 opacity-[var(--stars-op)]"
        style={{ backgroundImage: STARS_FAR, backgroundSize: '760px 520px' }}
      />

      {/* Radial wash behind the headline */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-hero-radial" />

      <OrbitRings />

      {/* Embers */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {EMBERS.map((e, i) => (
          <span
            key={i}
            className="absolute rounded-full"
            style={{
              left: e.left,
              bottom: e.bottom,
              width: e.size,
              height: e.size,
              background: e.gold ? 'rgb(var(--c-gold-soft))' : 'rgb(var(--c-arcane-soft))',
              animation: `ember ${e.duration} ease-out ${e.delay} infinite`,
            }}
          />
        ))}
      </div>

      {/* Twinkling stars */}
      {TWINKLES.map((t, i) => (
        <div
          key={i}
          aria-hidden
          className="absolute rounded-full opacity-[var(--stars-op)]"
          style={{
            left: t.left,
            top: t.top,
            width: t.size,
            height: t.size,
            background: t.color,
            animation: `twinkle ${t.duration} ease-in-out ${t.delay} infinite`,
          }}
        />
      ))}

      {/* Eyebrow */}
      <div className="relative inline-flex items-center gap-3.5 font-display text-[13px] font-semibold uppercase tracking-[0.38em] text-arcane">
        <span
          aria-hidden
          className="h-px w-14"
          style={{ background: 'linear-gradient(90deg,transparent,rgb(var(--c-arcane)))' }}
        />
        Pathfinder Second Edition
        <span
          aria-hidden
          className="h-px w-14"
          style={{ background: 'linear-gradient(90deg,rgb(var(--c-arcane)),transparent)' }}
        />
      </div>

      <h1 className="relative mx-auto mt-[34px] max-w-[900px] bg-h1-grad bg-clip-text font-display text-[clamp(44px,7.4vw,76px)] font-extrabold leading-[1.08] tracking-[0.01em] text-transparent [filter:drop-shadow(0_4px_30px_var(--glow))] [text-wrap:balance]">
        FORGE YOUR HERO.
        <br />
        CHRONICLE YOUR LEGEND.
      </h1>

      <p className="relative mx-auto mt-[30px] max-w-[620px] text-[22px] leading-[1.6] text-dim">
        Pathway is the companion your table has been waiting for — a character forge, a living
        rules archive, and a campaign chronicle,{' '}
        <em className="text-gold-soft">twinned with a Discord bot</em> that rolls, tracks, and
        remembers alongside you.
      </p>

      <div className="relative mt-11 flex flex-wrap justify-center gap-4">
        <Link to={user ? '/vault' : '/login'} className={PRIMARY_CTA}>
          {user ? 'OPEN YOUR VAULT' : 'ENTER PATHWAY'}
        </Link>
        <a
          href={links.addBotToServer}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2.5 rounded-md border border-line-strong px-[30px] py-4 font-display text-[15px] font-semibold tracking-[0.1em] text-silver transition-transform duration-150 hover:-translate-y-0.5 hover:border-gold hover:text-gold-soft"
        >
          <DiscordIcon size={18} />
          ADD TO DISCORD
        </a>
      </div>

      <p className="relative mt-[26px] text-[15px] italic text-faint">
        Free forever · Remaster &amp; Legacy rules · built under Paizo&apos;s Community Use Policy
      </p>
    </section>
  );
}

/** Shared by the hero and the "Begin your path" panel. */
export const PRIMARY_CTA =
  'inline-flex items-center gap-2.5 rounded-md bg-[linear-gradient(180deg,rgb(var(--c-gold-soft)),rgb(var(--c-gold))_60%,rgb(var(--c-gold-deep)))] px-[34px] py-4 font-display text-[15px] font-bold tracking-[0.1em] text-ink shadow-[0_0_0_1px_rgba(232,207,126,.5)_inset,0_14px_46px_-10px_var(--glow)] transition-transform duration-150 hover:-translate-y-0.5 hover:shadow-[0_0_0_1px_rgba(232,207,126,.7)_inset,0_18px_60px_-8px_var(--glow)]';

function OrbitRings() {
  const node =
    'absolute h-2 w-2 rotate-45 bg-gold shadow-[0_0_10px_var(--glow)]';
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute left-1/2 top-[54%] h-[840px] w-[840px] -translate-x-1/2 -translate-y-1/2"
    >
      <div className="absolute inset-0 animate-orbit rounded-full border border-line">
        <span className={`${node} -top-1 left-1/2 -ml-1`} />
        <span className={`${node} -left-1 top-1/2 -mt-1`} />
        <span className={`${node} -right-1 top-1/2 -mt-1`} />
      </div>
      <div className="absolute inset-[90px] animate-orbit-rev rounded-full border border-dashed border-arcane/20" />
      <div className="absolute inset-[190px] rounded-full border border-line shadow-[inset_0_0_120px_rgba(57,214,232,.05)]" />
    </div>
  );
}
