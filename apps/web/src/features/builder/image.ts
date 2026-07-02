/**
 * Read an image File and return a small, square-ish data URL.
 *
 * We downscale to at most `max` px on the long edge and re-encode as JPEG so a
 * portrait costs a few KB, not several MB — important because we store it in the
 * browser (localStorage) and, later, sync it. A data URL is just the image
 * encoded as text so it can live inside our JSON.
 */
export async function fileToPortraitDataUrl(file: File, max = 320): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process image.');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  return canvas.toDataURL('image/jpeg', 0.85);
}
