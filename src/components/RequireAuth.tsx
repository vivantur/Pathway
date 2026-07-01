import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/features/auth/useAuth';
import { useRelink } from '@/features/auth/useRelink';
import { Spinner } from './ui/Spinner';

/** Gate a route behind a signed-in Supabase session. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Fire the self-relink RPC once per session (no-op after the first link).
  // The hook internally gates on `user`, so it's safe to call before the
  // early returns below — it just won't run while signed out / loading.
  useRelink();

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
