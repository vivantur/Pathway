import { Link } from 'react-router-dom';
import { CornerBrackets } from '@/components/ui/CornerBrackets';
import { useAuth } from '@/features/auth/useAuth';
import { PRIMARY_CTA } from './Hero';

const STEPS = [
  { n: '1', title: 'Create an account', blurb: 'Free, no card, thirty seconds.' },
  { n: '2', title: 'Link your Discord', blurb: 'One click binds web and table.' },
  { n: '3', title: 'Forge a hero', blurb: 'Or import from Pathbuilder.' },
  // The last step is the bot's — marked in arcane rather than gold, and pulsing.
  { n: '4', title: 'Roll initiative', blurb: 'The bot takes it from here.', arcane: true },
];

export function BeginPanel() {
  const { user } = useAuth();

  return (
    <section id="begin" className="relative z-[1] mx-auto max-w-[1080px] scroll-mt-10 px-8 pb-[110px] pt-5">
      <div
        data-reveal
        className="relative overflow-hidden rounded-[14px] border border-line-strong bg-surface px-8 py-14 shadow-card wide:px-[60px]"
      >
        <CornerBrackets size={20} thickness={2} inset={12} color="var(--line-strong)" />

        <h2 className="text-center font-display text-4xl font-bold text-gold-soft">
          Begin your path
        </h2>

        <div className="relative mt-11 grid grid-cols-2 gap-y-8 wide:grid-cols-4 wide:gap-y-0">
          {/* The hairline the step markers sit on. Only meaningful once the
              steps are a single row, so it's hidden while they're 2×2. */}
          <div
            aria-hidden
            className="absolute left-[12%] right-[12%] top-[21px] hidden h-px bg-[linear-gradient(90deg,transparent,var(--line-strong)_15%,var(--line-strong)_85%,transparent)] wide:block"
          />
          {STEPS.map((s) => (
            <div key={s.n} className="relative px-3.5 text-center">
              <span
                className={`inline-flex h-[42px] w-[42px] items-center justify-center rounded-full border-[1.5px] bg-page font-display font-bold ${
                  s.arcane
                    ? 'animate-sigilpulse border-arcane text-arcane-soft'
                    : 'border-gold text-gold-soft'
                }`}
              >
                {s.n}
              </span>
              <p className="mt-3 font-display text-[15px] font-semibold text-silver">{s.title}</p>
              <p className="mt-1.5 text-[14.5px] leading-[1.5] text-faint">{s.blurb}</p>
            </div>
          ))}
        </div>

        <div className="mt-[46px] flex flex-wrap justify-center gap-4">
          <Link to={user ? '/vault' : '/login'} className={PRIMARY_CTA}>
            {user ? 'OPEN YOUR VAULT' : 'CREATE FREE ACCOUNT'}
          </Link>
          <Link
            to="/roadmap"
            className="inline-flex items-center gap-2.5 rounded-md border border-line-strong px-[30px] py-4 font-display text-[15px] font-semibold tracking-[0.1em] text-silver transition-transform duration-150 hover:-translate-y-0.5 hover:border-gold hover:text-gold-soft"
          >
            SEE THE ROADMAP
          </Link>
        </div>
      </div>
    </section>
  );
}
