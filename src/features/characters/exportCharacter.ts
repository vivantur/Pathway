import type { PathbuilderBuild } from './pathbuilder';

/** Trigger a client-side file download from in-memory content. */
export function downloadFile(filename: string, content: BlobPart, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** A filesystem-safe file name derived from the character name. */
export function safeFileName(name: string | undefined, ext: string): string {
  const base =
    (name ?? 'character')
      .replace(/[^\w.-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '') || 'character';
  return `${base}.${ext}`;
}

/**
 * Export a character's build as Pathbuilder-compatible JSON: the same
 * `{ success: true, build: {…} }` envelope Pathbuilder's own export produces,
 * so the file round-trips into Pathbuilder-aware tools.
 */
export function exportPathbuilderJson(name: string | undefined, build: PathbuilderBuild): void {
  const payload = JSON.stringify({ success: true, build }, null, 2);
  downloadFile(safeFileName(name, 'json'), payload, 'application/json');
}
