/**
 * Classify Supabase/PostgREST errors so the UI can respond helpfully.
 *
 * Before a feature's migration is applied, its table OR its RPC may not exist:
 *   - missing table:    PGRST205 / 42P01 ("undefined_table")
 *   - missing function: PGRST202 / 42883  ("undefined_function") — e.g. calling
 *                       `my_campaigns()` before the campaigns migration is run.
 * We treat all of these as "the database isn't set up yet" rather than a scary
 * error, so the UI can prompt the user to apply the pending migration.
 */
export function isSchemaNotReady(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: string }).code;
  const message = (err as { message?: string }).message ?? '';
  return (
    code === 'PGRST205' ||
    code === 'PGRST202' ||
    code === '42P01' ||
    code === '42883' ||
    /could not find the (table|function)/i.test(message) ||
    /does not exist/i.test(message)
  );
}
