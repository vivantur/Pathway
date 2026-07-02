import { useRef, useState } from 'react';
import { fileToPortraitDataUrl } from '@/features/builder/image';
import { useBuilder } from './store';

export function PortraitPicker() {
  const portrait = useBuilder((s) => s.state.portrait);
  const update = useBuilder((s) => s.update);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      update({ portrait: await fileToPortraitDataUrl(file) });
    } catch {
      alert('Sorry, that image could not be used. Try a JPG or PNG.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="group relative h-24 w-24 overflow-hidden rounded-full border-2 border-gold-500/40 bg-midnight-800 transition hover:border-gold-400"
        title={portrait ? 'Change portrait' : 'Add a portrait'}
      >
        {portrait ? (
          <img src={portrait} alt="Character portrait" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full flex-col items-center justify-center text-parchment/50">
            <span className="text-2xl" aria-hidden>
              ⬆
            </span>
            <span className="font-ui text-[10px] uppercase tracking-wider">
              {busy ? 'Loading…' : 'Add photo'}
            </span>
          </span>
        )}
      </button>
      {portrait && (
        <button
          type="button"
          className="font-ui text-xs text-parchment/50 underline hover:text-parchment/80"
          onClick={() => update({ portrait: undefined })}
        >
          Remove
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
    </div>
  );
}
