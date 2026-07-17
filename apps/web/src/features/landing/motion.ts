import { useEffect, type RefObject } from 'react';

/** Whether the reader has asked the OS to reduce motion. */
function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/**
 * Fade-and-rise scroll reveals for every `[data-reveal]` element inside `root`.
 *
 * The hidden starting state is applied from JS rather than a stylesheet on
 * purpose: if this hook never runs — no JS, an observer-less browser, reduced
 * motion — the copy stays plainly visible instead of being stranded at
 * opacity 0. One observer covers the whole page; each element is unobserved
 * once it has fired, since the reveal never replays.
 */
export function useReveals(root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') return;

    const targets = Array.from(el.querySelectorAll<HTMLElement>('[data-reveal]'));
    for (const t of targets) {
      t.style.opacity = '0';
      t.style.transform = 'translateY(26px)';
      t.style.transition = 'opacity .8s ease, transform .8s cubic-bezier(.2,.7,.2,1)';
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const target = entry.target as HTMLElement;
          target.style.opacity = '1';
          target.style.transform = 'translateY(0)';
          io.unobserve(target);
        }
      },
      { threshold: 0.12 },
    );
    for (const t of targets) io.observe(t);

    return () => io.disconnect();
  }, [root]);
}

/**
 * Drifts the two hero star layers at different rates as the page scrolls, so
 * the field reads as depth rather than wallpaper. Writes transforms straight to
 * the nodes — routing a scroll handler through React state would re-render the
 * whole page on every frame.
 */
export function useParallax(
  near: RefObject<HTMLElement | null>,
  far: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (prefersReducedMotion()) return;

    let frame = 0;
    const onScroll = () => {
      // Coalesce bursts of scroll events into one write per frame.
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        if (near.current) near.current.style.transform = `translateY(${y * 0.18}px)`;
        if (far.current) far.current.style.transform = `translateY(${y * 0.08}px)`;
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [near, far]);
}
