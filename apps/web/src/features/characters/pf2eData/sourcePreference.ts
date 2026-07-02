/**
 * Coalesce duplicated reference rows so that the Remaster version wins over
 * the Legacy version — without dropping Legacy-only content that hasn't been
 * remastered yet.
 *
 * Rows are grouped by name (case-insensitive, trimmed). Within each group:
 *   - If any entry's `source` contains "Remaster" (case-insensitive), we keep
 *     that entry.
 *   - Otherwise the first entry survives (input order is preserved so the
 *     caller's sort — by level, id, name, etc. — carries through).
 *
 * The `keep-first` fallback matters: many niche heritages / feats only exist
 * in a single sourcebook, and we don't want the dedupe pass to remove them.
 */
export function preferRemaster<T extends { name: string; source?: string | null }>(
  rows: T[],
): T[] {
  const isRemaster = (s?: string | null) => /remaster/i.test(s ?? '');

  const groups = new Map<string, T[]>();
  const order: string[] = [];

  for (const r of rows) {
    const key = (r.name ?? '').trim().toLowerCase();
    if (!key) continue;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(r);
  }

  const out: T[] = [];
  for (const key of order) {
    const arr = groups.get(key)!;
    const chosen = arr.find((r) => isRemaster(r.source)) ?? arr[0];
    out.push(chosen);
  }
  return out;
}
