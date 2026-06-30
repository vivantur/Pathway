import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { GildedRule } from '@/components/ui/GildedRule';
import { ConfigNotice } from '@/components/ConfigNotice';
import { useAuth } from '@/features/auth/useAuth';
import { supabase } from '@/lib/supabase';

export function LoginPage() {
  const { user, signInWithEmail, signInWithDiscord } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!supabase) {
    return <ConfigNotice />;
  }

  if (user) {
    return <Navigate to="/vault" replace />;
  }

  async function onEmailSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signInWithEmail(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the link.');
    } finally {
      setBusy(false);
    }
  }

  async function onDiscord() {
    setError(null);
    try {
      await signInWithDiscord();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start Discord sign-in.');
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="rounded-lg border border-gold/20 bg-midnight-700/50 p-7 shadow-gilded">
        <h1 className="text-center font-display text-2xl text-gold">Enter Pathway</h1>
        <p className="mt-2 text-center text-sm text-silver/70">
          Sign in to reach your character vault.
        </p>

        <GildedRule className="my-6" />

        <button
          type="button"
          onClick={() => void onDiscord()}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-[#5865F2] px-4 py-2.5 font-medium text-white transition-opacity hover:opacity-90"
        >
          Continue with Discord
        </button>
        <p className="mt-2 text-center text-xs text-silver/50">
          Recommended — links your web account to the same identity the bot uses.
        </p>

        <div className="my-5 flex items-center gap-3 text-xs text-silver/40">
          <span className="h-px flex-1 bg-silver/15" />
          or
          <span className="h-px flex-1 bg-silver/15" />
        </div>

        {sent ? (
          <p className="rounded-md border border-emerald/30 bg-emerald/10 p-4 text-center text-sm text-emerald-soft">
            Check your inbox — a magic sign-in link is on its way to {email}.
          </p>
        ) : (
          <form onSubmit={onEmailSubmit} className="space-y-3">
            <label className="block text-sm text-silver/80">
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="mt-1 w-full rounded-md border border-gold/20 bg-midnight-900 px-3 py-2 text-silver placeholder:text-silver/30 focus:border-gold/60 focus:outline-none"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-md bg-gold px-4 py-2.5 font-medium text-midnight-900 transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Sending…' : 'Email me a magic link'}
            </button>
          </form>
        )}

        {error && (
          <p className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
