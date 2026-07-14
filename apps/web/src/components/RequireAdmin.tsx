import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useIsAdmin } from '@/features/admin/useAdmin';
import { Spinner } from './ui/Spinner';

/**
 * Gate a route behind the admin flag. Must sit INSIDE <RequireAuth> (it assumes
 * a signed-in session). Authorization is really enforced by the server RPCs;
 * this just avoids rendering the admin UI to non-admins and 404s them instead.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { data: isAdmin, isLoading } = useIsAdmin();

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner label="Checking the archivist's ledger…" />
      </div>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
