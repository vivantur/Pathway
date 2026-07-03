/**
 * Guard stored URLs before putting them in an `href` or `<img src>`.
 *
 * Character `art`, class images, and AoN `aon_url` all come from the shared bot
 * database (some of it scraped/imported) and could in principle be a
 * `javascript:` URL (which React does NOT sanitize in an href) or a tracking
 * beacon. Only allow http(s); return undefined otherwise so callers can fall
 * back or omit the attribute.
 */
export function safeHttpUrl(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return undefined;
}
