import { Link } from 'react-router-dom';
import { CompassIcon } from '@/components/ui/RuneIcon';
import { GildedRule } from '@/components/ui/GildedRule';

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <CompassIcon size={56} className="mx-auto text-gold/70 animate-rune-pulse" />
      <p className="mt-6 font-display text-6xl text-gold/80">404</p>
      <h1 className="mt-4 font-display text-xl text-silver">This page is uncharted.</h1>
      <p className="mt-2 text-sm text-silver/60">
        The path you sought isn&apos;t on any map we hold.
      </p>
      <GildedRule className="my-8" />
      <div className="flex flex-wrap justify-center gap-3">
        <Link
          to="/"
          className="rounded-md bg-gold px-5 py-2 font-medium text-midnight-900 transition-transform hover:-translate-y-0.5"
        >
          Return to the archive
        </Link>
        <Link
          to="/roadmap"
          className="rounded-md border border-gold/30 px-5 py-2 text-silver/90 transition-colors hover:border-gold/60 hover:text-gold"
        >
          See the roadmap
        </Link>
      </div>
    </div>
  );
}
