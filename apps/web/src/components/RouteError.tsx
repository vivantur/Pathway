import { useRouteError, useNavigate } from 'react-router-dom';

/**
 * Route-level error boundary. React Router renders this when a route element
 * (or loader) throws during render — instead of the whole app white-screening.
 * Deliberately generic: we do NOT surface the raw error message to the user
 * (it can leak backend/schema detail on public routes).
 */
export function RouteError() {
  const error = useRouteError();
  const navigate = useNavigate();
  // Log for the developer; never render raw error text to the user.
  if (error) console.error('Route error:', error);

  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <h1 className="font-display text-3xl text-gold">Something went wrong</h1>
      <p className="mt-3 text-sm text-silver/70">
        This page hit an unexpected error. Try reloading, or head back home.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md bg-gold px-4 py-2 font-medium text-ink transition-opacity hover:opacity-90"
        >
          Reload
        </button>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="rounded-md border border-gold/30 px-4 py-2 text-silver transition-colors hover:text-gold"
        >
          Go home
        </button>
      </div>
    </div>
  );
}
