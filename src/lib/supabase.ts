import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';

/**
 * The shared Supabase browser client.
 *
 * This is the website's only connection to the bot's live backend. It uses the
 * anon key and the logged-in user's session, so every query is confined by RLS
 * to that user's rows (see docs/architecture/web-bot-sync.md).
 *
 * When env vars are absent (e.g. a fresh clone before `.env` is filled in),
 * `supabase` is `null` and the UI shows a configuration notice instead of
 * crashing. Use `requireSupabase()` in data code that must have a client.
 */
export const supabase: SupabaseClient | null = env.isConfigured
  ? createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Set VITE_SUPABASE_URL and ' +
        'VITE_SUPABASE_ANON_KEY in your .env file (see .env.example).',
    );
  }
  return supabase;
}
