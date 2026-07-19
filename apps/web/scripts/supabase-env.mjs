// Resolve Supabase credentials for the decision scripts.
//
// WHY THIS EXISTS. The web app reaches Supabase happily while these scripts report
// "missing credentials", which looks contradictory and is not: **Vite** loads
// `apps/web/.env` for the browser, and plain `node` loads nothing at all. Node has no
// implicit .env support, so a script has to ask.
//
// It also needs a DIFFERENT key. The browser uses the anon key and relies on RLS;
// `effect_decisions` is admin-only, and a script has no session to be an admin with —
// so it needs the SERVICE ROLE key, which lives in `apps/bot/.env` (the bot already
// uses it) per CLAUDE.md's "secrets stay in .env at the repo root or inside apps/bot".
//
// PRECEDENCE: a variable already in the environment always wins — `process.loadEnvFile`
// does not overwrite — so `SUPABASE_URL=… npm run pull:decisions` still works, and the
// files are only a fallback. Among files, the first to define a name wins.

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');

/** Where secrets live in this repo, in precedence order. */
const ENV_FILES = ['.env', '.env.local', 'apps/bot/.env', 'apps/web/.env', 'apps/web/.env.local'];

/**
 * The `role` claim of a Supabase key, or null if it is not a readable JWT.
 *
 * Used ONLY to tell the anon key apart from the service role key. Supplying the anon
 * key would not error — it would authenticate fine and then return zero rows, because
 * RLS denies a non-admin — so without this check a wrong key looks like an empty table.
 * Decoding is a plain base64 read of the public payload; the token itself is never
 * logged.
 */
function keyRole(key) {
  try {
    const payload = key.split('.')[1];
    if (!payload) return null;
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof json.role === 'string' ? json.role : null;
  } catch {
    return null;
  }
}

/**
 * Load the repo's env files, then resolve the URL + service role key. Exits with an
 * actionable message rather than a bare "missing" — including WHICH files were read,
 * since the usual cause is that the credentials exist somewhere this did not look.
 */
export function requireServiceCredentials() {
  const loaded = [];
  for (const rel of ENV_FILES) {
    const path = join(ROOT, rel);
    if (!existsSync(path)) continue;
    try {
      process.loadEnvFile(path);
      loaded.push(rel);
    } catch {
      // A malformed file should not be fatal — a later one, or the real environment,
      // may still carry what we need. Report it only if we end up short.
      loaded.push(`${rel} (unreadable)`);
    }
  }

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('Missing Supabase credentials.\n');
    console.error(`  SUPABASE_URL / VITE_SUPABASE_URL : ${url ? 'found' : 'MISSING'}`);
    console.error(`  SUPABASE_SERVICE_ROLE_KEY        : ${key ? 'found' : 'MISSING'}`);
    console.error(`\nEnv files read: ${loaded.length ? loaded.join(', ') : '(none found)'}`);
    if (!key) {
      console.error(
        '\nThe SERVICE ROLE key is required — `effect_decisions` is admin-only by RLS\n' +
          'and a script has no session. The browser\'s anon key will not do.\n' +
          'It lives in apps/bot/.env, or Supabase dashboard → Project Settings → API.\n' +
          'Never name it VITE_* — that would bundle it into the browser.',
      );
    }
    process.exit(1);
  }

  const role = keyRole(key);
  if (role && role !== 'service_role') {
    console.error(`SUPABASE_SERVICE_ROLE_KEY carries role "${role}", not "service_role".`);
    console.error(
      'That key would authenticate and then read nothing, because RLS denies a\n' +
        'non-admin — an empty result that looks like an empty table. Use the service\n' +
        'role key from Supabase dashboard → Project Settings → API.',
    );
    process.exit(1);
  }

  return { url, key };
}
