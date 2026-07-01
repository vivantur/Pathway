import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '@/features/auth/useAuth';

const navClass = ({ isActive }: { isActive: boolean }) =>
  [
    'rounded-md px-3 py-1.5 text-sm transition-colors',
    isActive ? 'text-gold' : 'text-silver/70 hover:text-silver',
  ].join(' ');

export function Header() {
  const { user, signOut } = useAuth();

  return (
    <header className="border-b border-gold/15 bg-midnight-900/70 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link to="/" className="flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="h-7 w-7 animate-rune-pulse" />
          <span className="font-display text-lg tracking-wide text-gold">Pathway</span>
        </Link>

        <nav className="flex items-center gap-1">
          <NavLink to="/" end className={navClass}>
            Home
          </NavLink>
          <NavLink to="/about" className={navClass}>
            About
          </NavLink>
          <NavLink to="/roadmap" className={navClass}>
            Roadmap
          </NavLink>
          <NavLink to="/rules" className={navClass}>
            Rules
          </NavLink>
          <NavLink to="/vault" className={navClass}>
            Vault
          </NavLink>
          {user ? (
            <button
              type="button"
              onClick={() => void signOut()}
              className="ml-2 rounded-md border border-gold/25 px-3 py-1.5 text-sm text-silver/80 transition-colors hover:border-gold/50 hover:text-gold"
            >
              Sign out
            </button>
          ) : (
            <NavLink
              to="/login"
              className="ml-2 rounded-md border border-gold/25 px-3 py-1.5 text-sm text-gold transition-colors hover:border-gold/60"
            >
              Sign in
            </NavLink>
          )}
        </nav>
      </div>
    </header>
  );
}
