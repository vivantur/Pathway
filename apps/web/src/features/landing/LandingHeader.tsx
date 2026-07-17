import { Link } from 'react-router-dom';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { GlobalSearch } from '@/features/search/GlobalSearch';
import { useAuth } from '@/features/auth/useAuth';
import { Sigil } from './Sigil';

/** In-page section anchors — this header only ever renders on the landing route. */
const SECTIONS = [
  { href: '#forge', label: 'The Forge' },
  { href: '#table', label: 'At the Table' },
  { href: '#archives', label: 'The Archives' },
  { href: '#begin', label: 'Begin' },
];

export function LandingHeader() {
  const { user } = useAuth();

  return (
    <header className="relative z-[5] mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-3 px-6 py-[18px]">
      <Link to="/" className="flex items-center gap-3">
        <Sigil size={34} className="animate-sigilpulse" />
        <span className="font-display text-[21px] font-bold tracking-[0.14em] text-gold-soft">
          PATHWAY
        </span>
      </Link>

      <nav className="flex flex-wrap items-center justify-end gap-x-1 gap-y-2">
        {SECTIONS.map((s) => (
          <a
            key={s.href}
            href={s.href}
            className="whitespace-nowrap px-[9px] py-2 font-display text-[11.5px] font-semibold uppercase tracking-[0.08em] text-dim transition-colors hover:text-gold"
          >
            {s.label}
          </a>
        ))}

        <GlobalSearch variant="pill" />
        <ThemeToggle variant="landing" />

        <Link
          to={user ? '/vault' : '/login'}
          className="whitespace-nowrap rounded-md border border-line-strong px-[18px] py-[9px] font-display text-[13px] font-semibold tracking-[0.08em] text-gold-soft transition-colors hover:bg-gold/10"
        >
          {user ? 'MY VAULT' : 'SIGN IN'}
        </Link>
      </nav>
    </header>
  );
}
