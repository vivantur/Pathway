/**
 * Extract a readable message from any thrown value.
 *
 * Supabase queries typically reject with a `PostgrestError`, which is a plain
 * object rather than a JS `Error` instance — so a naive `error instanceof
 * Error` check misses it entirely and falls back to a useless generic string.
 * This helper unwraps the common shapes so the UI can show the underlying
 * detail (RLS violations, missing columns, network failures, etc.).
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;

  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;

    // Postgrest-style: { message, code, details, hint }
    if (typeof e.message === 'string' && e.message.trim().length > 0) {
      const detail = typeof e.details === 'string' && e.details.trim().length > 0 ? ` — ${e.details}` : '';
      const hint = typeof e.hint === 'string' && e.hint.trim().length > 0 ? ` (${e.hint})` : '';
      return `${e.message}${detail}${hint}`;
    }

    if (typeof e.error === 'string') return e.error;
    if (typeof e.description === 'string') return e.description;
    try {
      return JSON.stringify(err);
    } catch {
      return 'Unknown error (unserializable)';
    }
  }

  if (typeof err === 'string' && err.trim().length > 0) return err;
  return 'Unknown error';
}
