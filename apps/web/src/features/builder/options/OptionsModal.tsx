import { useApp } from '@/features/builder/appStore';
import { useBuilder } from '@/features/builder/store';
import { OPTION_GROUPS, type OptionDef } from './config';

function Switch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative h-5 w-9 shrink-0 rounded-full border transition disabled:opacity-40"
      style={{
        borderColor: checked ? 'rgba(232,200,119,0.7)' : 'rgba(239,230,208,0.25)',
        background: checked ? 'rgba(212,175,55,0.35)' : 'rgba(239,230,208,0.08)',
      }}
    >
      <span
        className="absolute top-0.5 h-3.5 w-3.5 rounded-full bg-parchment transition-all"
        style={{ left: checked ? '1.25rem' : '0.15rem' }}
      />
    </button>
  );
}

function OptionRow({ def }: { def: OptionDef }) {
  const charOptions = useBuilder((s) => s.state.options);
  const setOption = useBuilder((s) => s.setOption);
  const globalOptions = useApp((s) => s.globalOptions);
  const setGlobalOption = useApp((s) => s.setGlobalOption);

  const value =
    def.scope === 'global' ? (globalOptions[def.id] ?? false) : (charOptions?.[def.id] ?? false);
  const onChange = (v: boolean) =>
    def.scope === 'global' ? setGlobalOption(def.id, v) : setOption(def.id, v);

  return (
    <div className="flex items-start justify-between gap-4 border-b border-gold-500/10 py-3 last:border-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={`font-ui text-sm ${def.implemented ? 'text-parchment' : 'text-parchment/50'}`}>
            {def.label}
          </span>
          {!def.implemented && (
            <span className="rounded-full border border-parchment/20 px-1.5 py-0.5 font-ui text-[9px] uppercase tracking-wider text-parchment/50">
              Planned
            </span>
          )}
        </div>
        {def.note && <p className="mt-0.5 font-ui text-xs text-parchment/50">{def.note}</p>}
      </div>
      <Switch checked={value} disabled={!def.implemented} onChange={onChange} />
    </div>
  );
}

export function OptionsModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="panel my-8 w-full max-w-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-2xl text-gold-400">Options</h2>
          <button type="button" className="btn py-1 text-xs" onClick={onClose}>
            Done
          </button>
        </div>
        <p className="mb-4 font-ui text-sm text-parchment/70">
          Variant rules apply to <span className="text-parchment">this character</span>; app options
          apply everywhere. Toggles marked <span className="text-parchment/50">Planned</span> aren’t
          wired up yet — the note says what each is waiting on.
        </p>

        <div className="flex flex-col gap-6">
          {OPTION_GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="mb-1 font-display text-lg text-parchment">{group.title}</h3>
              <div className="rounded-xl border border-gold-500/15 bg-midnight-800/40 px-4">
                {group.options.map((def) => (
                  <OptionRow key={def.id} def={def} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
