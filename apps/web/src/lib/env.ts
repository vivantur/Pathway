/**
 * Environment configuration for the Supabase connection.
 *
 * Phase W0 hard rule (see docs/architecture/web-bot-sync.md §1): the website
 * connects with the **anon / publishable key** and acts as the logged-in user
 * under RLS. The service-role key must NEVER reach the browser. We decode the
 * key's JWT payload and refuse to boot if a `service_role` key is supplied, so
 * a misconfigured deploy fails loudly instead of silently bypassing RLS.
 */

export interface PathwayEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** True only when both values are present and look valid. */
  isConfigured: boolean;
}

function decodeJwtRole(token: string): string | undefined {
  try {
    const payload = token.split('.')[1];
    if (!payload) return undefined;
    const json = JSON.parse(
      atob(payload.replace(/-/g, '+').replace(/_/g, '/')),
    ) as { role?: string };
    return json.role;
  } catch {
    return undefined;
  }
}

/**
 * Whether a key is a service-role / secret key that must never reach the
 * browser. Covers BOTH key formats:
 *   - legacy JWT keys, whose payload carries `role: 'service_role'`
 *   - the current opaque secret keys, prefixed `sb_secret_` (non-JWT, so the
 *     JWT decode above returns undefined and would otherwise slip through).
 */
function isSecretKey(token: string): boolean {
  return token.startsWith('sb_secret_') || decodeJwtRole(token) === 'service_role';
}

function readEnv(): PathwayEnv {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';

  // Loud failure: a service-role key in the browser would bypass RLS for every
  // user. This is the single most dangerous misconfiguration for a second
  // client on a shared backend.
  if (supabaseAnonKey && isSecretKey(supabaseAnonKey)) {
    throw new Error(
      'VITE_SUPABASE_ANON_KEY is a service-role / secret key. The website must use ' +
        'the anon/publishable key under RLS — never the service-role key. Refusing to start.',
    );
  }

  return {
    supabaseUrl,
    supabaseAnonKey,
    isConfigured: Boolean(supabaseUrl && supabaseAnonKey),
  };
}

export const env = readEnv();
