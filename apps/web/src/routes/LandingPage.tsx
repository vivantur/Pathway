import { useRef } from 'react';
import { Archives } from '@/features/landing/Archives';
import { BeginPanel } from '@/features/landing/BeginPanel';
import { Hero } from '@/features/landing/Hero';
import { LandingFooter } from '@/features/landing/LandingFooter';
import { LandingHeader } from '@/features/landing/LandingHeader';
import { SyncShowcase } from '@/features/landing/SyncShowcase';
import { useReveals } from '@/features/landing/motion';
import { VaultQuote } from '@/features/landing/VaultQuote';

/**
 * The landing page — "Gilded Observatory".
 *
 * Unlike every other route this one is full-bleed and brings its own header and
 * footer: the star field, the gilded frame and the orbit rings have to span the
 * viewport, which `AppLayout`'s centered, padded `<main>` would crop. It is
 * mounted outside `AppLayout` in the router for exactly that reason.
 */
export function LandingPage() {
  const root = useRef<HTMLDivElement>(null);
  useReveals(root);

  return (
    <div ref={root} className="relative min-h-dvh overflow-hidden bg-page font-serif text-silver">
      <LandingHeader />
      <Hero />
      <SyncShowcase />
      <Archives />
      <VaultQuote />
      <BeginPanel />
      <LandingFooter />
    </div>
  );
}
