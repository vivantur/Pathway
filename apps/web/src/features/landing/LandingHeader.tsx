import { Link } from 'react-router-dom';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { GlobalSearch } from '@/features/search/GlobalSearch';
import { useAuth } from '@/features/auth/useAuth';
import { Sigil } from './Sigil';

/**
 * Nav items are a mix: `to` navigates to a route, `href` jumps to a section of
 * this page. The Forge and The Archives point at the real tools they name; the
 * other two stay in-page (this header only renders on the landing route).
 */
const NAV: Array<{ label: string; to?: string; href?: string }> = [
  { label: 'The Forge', to: '/vault/create' },
  { label: 'At the Table', href: '#table' },
  { label: 'The Archives', to: '/rules' },
  { label: 'Begin', href: '#begin' },
];

const navClass =
  'whitespace-nowrap px-[9px] py-2 font-display text-[11.5px] font-semibold uppercase tracking-[0.08em] text-dim transition-colors hover:text-gold';

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
        {NAV.map((item) =>
          item.to ? (
            <Link key={item.label} to={item.to} className={navClass}>
              {item.label}
            </Link>
          ) : (
            <a key={item.label} href={item.href} className={navClass}>
              {item.label}
            </a>
          ),
        )}

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
