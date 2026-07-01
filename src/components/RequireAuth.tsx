import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/features/auth/useAuth';
import { Spinner } from './ui/Spinner';

/** Gate a route behind a signed-in Supabase session. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  // NOTE: auto-relink temporarily DISABLED (2026-07-01) while we investigate a
  // mis-merge — a relink pulled another user's character into the owner's
  // vault. Do not re-enable until the root cause (a users-row / discord_id
  // collision) is understood and the function is hardened. See
  // docs/sql/2026-07-01-relink-on-login.sql.

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner label="Consulting the archive…" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
