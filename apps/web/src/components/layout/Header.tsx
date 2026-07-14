import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '@/features/auth/useAuth';
import { useIsAdmin } from '@/features/admin/useAdmin';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { GlobalSearch } from '@/features/search/GlobalSearch';

const NAV_LINKS = [
  { to: '/', label: 'Home', end: true },
  { to: '/about', label: 'About' },
  { to: '/roadmap', label: 'Roadmap' },
  { to: '/rules', label: 'Rules' },
  { to: '/vault', label: 'Vault' },
];

const ADMIN_LINK = { to: '/admin', label: 'Admin', end: false };

const navClass = ({ isActive }: { isActive: boolean }) =>
  [
    'rounded-md px-3 py-1.5 text-sm transition-colors',
    isActive ? 'text-gold' : 'text-silver/70 hover:text-silver',
  ].join(' ');

export function Header() {
  const { user, signOut } = useAuth();
  const { data: isAdmin } = useIsAdmin();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // The Admin link only appears for flagged admins (the route + server RPCs
  // enforce access regardless; this just keeps the nav clean for everyone else).
  const navLinks = isAdmin ? [...NAV_LINKS, ADMIN_LINK] : NAV_LINKS;

  // Close the mobile menu on any route change (covers navigations that don't
  // go through a link's onClick, e.g. redirects).
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const close = () => setOpen(false);

  return (
    <header className="border-b border-gold/15 bg-midnight-900/70 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link to="/" className="flex items-center gap-2.5" onClick={close}>
          <img src="/favicon.svg" alt="" className="h-7 w-7 animate-rune-pulse" />
          <span className="font-display text-lg tracking-wide text-gold">Pathway</span>
        </Link>

        {/* Site-wide search — single instance, visible on all breakpoints */}
        <GlobalSearch />

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 md:flex">
          {navLinks.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={navClass}>
              {l.label}
            </NavLink>
          ))}
          <ThemeToggle />
          <AuthButton user={user} onSignOut={signOut} />
        </nav>

        {/* Mobile controls */}
        <div className="flex items-center gap-2 md:hidden">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? 'Close menu' : 'Open menu'}
            className="rounded-md border border-gold/25 p-2 text-silver/80 transition-colors hover:border-gold/50 hover:text-gold"
          >
            {open ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
                <path d="M3 6h18M3 12h18M3 18h18" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile dropdown panel */}
      {open && (
        <nav className="border-t border-gold/15 bg-midnight-900/95 md:hidden">
          <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-3">
            {navLinks.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                onClick={close}
                className={({ isActive }) =>
                  [
                    'rounded-md px-3 py-2.5 text-base transition-colors',
                    isActive ? 'bg-midnight-800/60 text-gold' : 'text-silver/80 hover:bg-midnight-800/40 hover:text-gold',
                  ].join(' ')
                }
              >
                {l.label}
              </NavLink>
            ))}
            <div className="mt-2 border-t border-gold/10 pt-3">
              <AuthButton user={user} onSignOut={signOut} onNavigate={close} fullWidth />
            </div>
          </div>
        </nav>
      )}
    </header>
  );
}

function AuthButton({
  user,
  onSignOut,
  onNavigate,
  fullWidth,
}: {
  user: ReturnType<typeof useAuth>['user'];
  onSignOut: () => void | Promise<void>;
  onNavigate?: () => void;
  fullWidth?: boolean;
}) {
  const width = fullWidth ? 'w-full text-center' : '';
  if (user) {
    return (
      <button
        type="button"
        onClick={() => {
          onNavigate?.();
          void onSignOut();
        }}
        className={`ml-2 rounded-md border border-gold/25 px-3 py-1.5 text-sm text-silver/80 transition-colors hover:border-gold/50 hover:text-gold ${width}`}
      >
        Sign out
      </button>
    );
  }
  return (
    <NavLink
      to="/login"
      onClick={onNavigate}
      className={`ml-2 rounded-md border border-gold/25 px-3 py-1.5 text-sm text-gold transition-colors hover:border-gold/60 ${width}`}
    >
      Sign in
    </NavLink>
  );
}
