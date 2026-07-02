/**
 * Classify Supabase/PostgREST errors so the UI can respond helpfully.
 *
 * Before the bot's schema is migrated into a project, the `characters` table
 * may not exist yet. PostgREST reports that as code `PGRST205` ("Could not find
 * the table"), and Postgres itself as `42P01` ("undefined_table"). We treat
 * both as "the database isn't set up yet" rather than a scary error.
 */
export function isSchemaNotReady(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: string }).code;
  const message = (err as { message?: string }).message ?? '';
  return (
    code === 'PGRST205' ||
    code === '42P01' ||
    /could not find the table/i.test(message) ||
    /does not exist/i.test(message)
  );
}
