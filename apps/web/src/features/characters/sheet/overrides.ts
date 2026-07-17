/**
 * Resolve a bot/sheet override list against a fallback. An override only wins
 * when it is a NON-EMPTY array: the character overlay seeds edit lists (senses,
 * languages, …) to `[]`, and `edit ?? fallback` would keep that empty array
 * (nullish-coalescing only falls through on null/undefined), blanking the value
 * for every web-built character. Treat an empty edit as "unset".
 */
export function resolveListOverride<T>(edit: T[] | null | undefined, fallback: T[]): T[] {
  return Array.isArray(edit) && edit.length > 0 ? edit : fallback;
}
