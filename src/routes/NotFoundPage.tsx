import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <p className="font-display text-6xl text-gold/80">404</p>
      <h1 className="mt-4 font-display text-xl text-silver">This page is uncharted.</h1>
      <p className="mt-2 text-sm text-silver/60">
        The path you sought isn&apos;t on any map we hold.
      </p>
      <Link
        to="/"
        className="mt-6 inline-block rounded-md border border-gold/30 px-4 py-2 text-gold transition-colors hover:border-gold/60"
      >
        Return to the archive
      </Link>
    </div>
  );
}
