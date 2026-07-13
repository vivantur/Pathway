/**
 * Reduce the enriched Markdown descriptions to clean single-paragraph plain text
 * for compact previews (e.g. feat cards in a picker grid), where rendering full
 * Markdown would be too tall and showing raw `**`/`|`/`---` looks broken. The
 * full formatted text is rendered with GrimoireMarkdown where there's room.
 */
export function plainText(md: string | undefined, maxLength = 220): string {
  if (!md) return '';
  let s = md
    .replace(/```[\s\S]*?```/g, ' ') // code fences
    .replace(/^\s*#{1,6}\s+/gm, '') // headings
    .replace(/^\s*[-*+]\s+/gm, '') // list bullets
    .replace(/^\s*>\s?/gm, '') // blockquotes
    .replace(/^\s*-{3,}\s*$/gm, ' ') // horizontal rules
    .replace(/\|/g, ' ') // table pipes
    .replace(/(\*\*|__)(.*?)\1/g, '$2') // bold
    .replace(/(\*|_)(.*?)\1/g, '$2') // italic
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → text
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > maxLength) s = `${s.slice(0, maxLength).replace(/\s+\S*$/, '')}…`;
  return s;
}
