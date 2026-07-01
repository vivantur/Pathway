import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Grimoire-themed markdown renderer for reference-data descriptions.
 *
 * PF2e content descriptions ship as raw markdown (bold section labels, italic
 * flavor, GFM tables for progression) — dropping the string directly into a
 * <p> printed the asterisks and pipes as literal text. This component maps
 * every markdown node to Tailwind classes that match the sheet's palette:
 * gold accents for headings + strong, silver-soft for prose, a real bordered
 * table for progression grids, and arcane for links / inline code.
 *
 * Pass `strip=['source']` (etc.) to skip common redundant lines that we already
 * render as chips outside the description body.
 */
export function GrimoireMarkdown({
  children,
  strip = [],
  structure = false,
  name,
}: {
  children: string;
  /** Case-insensitive substring matches; any line containing one is dropped. */
  strip?: string[];
  /**
   * When true, run the raw text through `structurePf2eSections` first — this
   * turns unstructured AoN lore prose (where section titles like "Physical
   * Description" / "Society" are embedded inline with no line breaks) into
   * proper headed sections, and strips the inline "Source … pg. N" citation.
   * Use for long lore blocks (ancestries, backgrounds, classes); leave off for
   * already-structured feat/spell text.
   */
  structure?: boolean;
  /** The entry's name — stripped from the start of the description when structuring. */
  name?: string;
}) {
  let source = preprocessDescription(children ?? '', strip);
  if (structure) source = structurePf2eSections(source, name);
  if (!source.trim()) return null;

  return (
    <div className="text-sm leading-relaxed text-silver/85">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (props) => (
            <h3 className="mb-2 mt-4 font-display text-lg uppercase tracking-widest text-gold first:mt-0" {...props} />
          ),
          h2: (props) => (
            <h4 className="mb-2 mt-4 font-display text-sm uppercase tracking-widest text-gold/90 first:mt-0" {...props} />
          ),
          h3: (props) => (
            <h5 className="mb-1 mt-3 font-display text-xs uppercase tracking-widest text-gold/80 first:mt-0" {...props} />
          ),
          h4: (props) => (
            <h6 className="mb-1 mt-3 text-xs uppercase tracking-widest text-gold/70 first:mt-0" {...props} />
          ),
          p: (props) => <p className="mb-3 last:mb-0" {...props} />,
          strong: (props) => <strong className="font-display font-normal text-gold/95" {...props} />,
          em: (props) => <em className="italic text-silver/95" {...props} />,
          a: ({ href, children: c, ...rest }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-arcane underline decoration-arcane/40 underline-offset-2 hover:decoration-arcane/80"
              {...rest}
            >
              {c}
            </a>
          ),
          code: (props) => (
            <code className="rounded bg-midnight-900/70 px-1 py-0.5 text-[0.85em] text-arcane" {...props} />
          ),
          ul: (props) => <ul className="mb-3 ml-5 list-disc space-y-1" {...props} />,
          ol: (props) => <ol className="mb-3 ml-5 list-decimal space-y-1" {...props} />,
          li: (props) => <li className="text-silver/85" {...props} />,
          hr: () => <hr className="my-4 border-gold/15" />,
          blockquote: (props) => (
            <blockquote className="my-3 border-l-2 border-gold/40 pl-3 italic text-silver/70" {...props} />
          ),

          // Real bordered table for class-progression grids etc.
          table: (props) => (
            <div className="mb-3 overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs" {...props} />
            </div>
          ),
          thead: (props) => <thead className="bg-midnight-900/70" {...props} />,
          tbody: (props) => <tbody className="divide-y divide-gold/10" {...props} />,
          tr: (props) => <tr {...props} />,
          th: (props) => (
            <th
              className="border-b border-gold/30 px-2 py-1.5 text-left font-display text-[0.65rem] uppercase tracking-widest text-gold/90"
              {...props}
            />
          ),
          td: (props) => <td className="border-t border-gold/10 px-2 py-1.5 align-top text-silver/85" {...props} />,
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

/**
 * PF2e descriptions bury metadata inside markdown (`**Source** Core Rulebook
 * pg. 140`) that we already render as chips outside the body. This strips any
 * line matching a caller-supplied fragment before the markdown renderer sees
 * it — case-insensitive, whitespace-tolerant.
 */
function preprocessDescription(raw: string, strip: string[]): string {
  const lower = strip.map((s) => s.toLowerCase());
  const kept = raw
    .split(/\r?\n/)
    .filter((line) => {
      if (lower.length === 0) return true;
      const l = line.toLowerCase();
      return !lower.some((s) => l.includes(s));
    });
  return kept
    .join('\n')
    // Collapse runs of 3+ blank lines back to 2 so the vertical rhythm stays sane
    // after we strip the source line.
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Canonical section labels AoN uses inside ancestry / background / class lore
 * prose. In our reference data these arrive embedded inline with no line
 * breaks, so the whole thing renders as one paragraph. We detect them and
 * promote each to a markdown `## heading`, which the renderer then styles as
 * a proper section. Multi-word, distinctively-capitalized phrases keep false
 * positives low. Order longest-first so a longer header wins over a substring.
 */
const PF2E_SECTION_HEADERS = [
  'Alignment and Religion',
  'Physical Description',
  'Other Information',
  'You Might…',
  'You Might...',
  'Others Probably…',
  'Others Probably...',
  'Sample Names',
  'Adventurers',
  'Society',
  'Names',
  'Beliefs',
  'Appearance',
];

/**
 * Turn a wall of AoN lore prose into headed markdown sections + strip the
 * inline "Source <book> pg. N" citation and a redundant leading name.
 */
function structurePf2eSections(raw: string, name?: string): string {
  if (!raw) return raw;
  let text = raw.trim();

  // Drop a redundant leading "<Name> " (AoN prose often repeats it).
  if (name && text.toLowerCase().startsWith(`${name.toLowerCase()} `)) {
    text = text.slice(name.length + 1);
  }
  // Drop the inline source citation — already shown as a meta chip. `[^.]*?`
  // keeps it from swallowing past the sentence.
  text = text.replace(/\bSource\b[^.]*?pg\.\s*\d+\s*/gi, '').trim();

  // Dynamic "<Word> Heritage Mechanics" header (aasimar, tiefling, etc.).
  text = text.replace(/\s+(\w+ Heritage Mechanics)\s+/g, '\n\n## $1\n\n');

  // Known section headers → markdown h2. Matched only when flanked by
  // whitespace (a real section boundary), not mid-word.
  for (const h of PF2E_SECTION_HEADERS) {
    const esc = h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`\\s+${esc}\\s+`, 'g'), `\n\n## ${h}\n\n`);
  }

  return text.replace(/\n{3,}/g, '\n\n').trim();
}
