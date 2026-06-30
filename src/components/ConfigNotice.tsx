import { GildedRule } from './ui/GildedRule';

/**
 * Shown when Supabase env vars are missing. Phase W0 deliberately scaffolds the
 * app to boot without secrets so a fresh clone runs; this panel explains how to
 * connect it to the develop backend.
 */
export function ConfigNotice() {
  return (
    <div className="mx-auto max-w-xl rounded-lg border border-gold/30 bg-midnight-700/60 p-6 shadow-gilded">
      <h2 className="font-display text-lg text-gold">Connect the archive</h2>
      <GildedRule className="my-4" />
      <p className="text-sm leading-relaxed text-silver/90">
        Pathway isn&apos;t linked to a Supabase backend yet. Copy{' '}
        <code className="rounded bg-midnight-900 px-1.5 py-0.5 text-arcane">.env.example</code>{' '}
        to{' '}
        <code className="rounded bg-midnight-900 px-1.5 py-0.5 text-arcane">.env</code>{' '}
        and fill in the <strong>develop</strong> project&apos;s URL and{' '}
        <strong>anon</strong> key:
      </p>
      <pre className="mt-4 overflow-x-auto rounded bg-midnight-950 p-4 text-xs text-silver/90">
        {`VITE_SUPABASE_URL=https://nqnswvuqszpkntnjzomv.supabase.co
VITE_SUPABASE_ANON_KEY=<develop anon / publishable key>`}
      </pre>
      <p className="mt-4 text-xs text-silver/60">
        Use the <strong>anon</strong> key only — never the service-role key. The
        website acts as the logged-in user under RLS.
      </p>
    </div>
  );
}
