import type { PathbuilderBuild } from './pathbuilder';

/**
 * Pathbuilder 2e's public JSON export endpoint. Users get a numeric short-id
 * when they click "Export to JSON" in the builder; the endpoint responds
 * with `{ success: boolean, build: {…} }` (or `{ success: false }` on
 * lookup failure). CORS is enabled server-side so direct browser fetch
 * works — no proxy needed.
 */
const PATHBUILDER_JSON_URL = 'https://pathbuilder2e.com/json.php';

export interface PathbuilderApiResponse {
  success: boolean;
  build?: PathbuilderBuild;
}

/**
 * Fetch a Pathbuilder build by its export id. Throws with a friendly message
 * on any failure the caller can display verbatim — no need for the UI to
 * parse error codes.
 */
export async function fetchPathbuilderBuild(id: number): Promise<PathbuilderBuild> {
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error('Pathbuilder ID must be a positive number.');
  }

  const url = `${PATHBUILDER_JSON_URL}?id=${encodeURIComponent(String(id))}`;

  let response: Response;
  try {
    response = await fetch(url, { method: 'GET', mode: 'cors' });
  } catch (err) {
    throw new Error(
      `Couldn't reach Pathbuilder (${err instanceof Error ? err.message : 'network error'}). Check your connection and try again.`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `Pathbuilder returned HTTP ${response.status}. The ID may be invalid or the export may have expired.`,
    );
  }

  let payload: PathbuilderApiResponse;
  try {
    payload = (await response.json()) as PathbuilderApiResponse;
  } catch {
    throw new Error("Pathbuilder didn't return JSON. The ID may be invalid.");
  }

  if (!payload.success || !payload.build) {
    throw new Error(
      "Pathbuilder doesn't have a build with that ID. Double-check the number, and make sure the build was exported recently (exports expire after a while).",
    );
  }

  return payload.build;
}

/**
 * Parse a raw string from the user (either just digits or a full URL) into
 * a Pathbuilder id. Users tend to paste either "123456" or the whole
 * `https://pathbuilder2e.com/json.php?id=123456` URL — both should work.
 */
export function parsePathbuilderId(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // If it's already just digits, done.
  if (/^\d+$/.test(trimmed)) return Number(trimmed);

  // Otherwise try to pluck an id from the query string.
  const match = trimmed.match(/(?:^|[?&])id=(\d+)/i);
  if (match) return Number(match[1]);

  // Or the last group of digits in the string.
  const digitsOnly = trimmed.match(/\d{4,}/);
  if (digitsOnly) return Number(digitsOnly[0]);

  return null;
}
