import { useBuilder } from './store';
import { featChoicesFor, pendingFeatChoices } from './rules';
import { plainText } from './contentText';

/**
 * Consolidated prompts for feats that let the player choose what they grant (Canny
 * Acumen → a save/Perception, Natural Skill → two skills, …). The options and their
 * effects are content, resolved at ingest; this only stores the pick. Renders
 * nothing when no chosen feat needs a choice, so it's safe to drop into any step.
 */
export function FeatChoicesPanel() {
  const state = useBuilder((s) => s.state);
  const setFeatChoice = useBuilder((s) => s.setFeatChoice);
  const pending = pendingFeatChoices(state);
  if (pending.length === 0) return null;

  return (
    <section className="panel flex flex-col gap-4 p-5">
      <div>
        <h4 className="font-display text-lg text-gold-400">Feat Choices</h4>
        <p className="font-ui text-sm text-parchment/70">
          Some feats let you choose what they train. Pick each option to apply it to your sheet.
        </p>
      </div>
      <div className="flex flex-col gap-4">
        {pending.map(({ feat, prompts }) => (
          <div key={feat.id} className="flex flex-col gap-2 rounded-md border border-parchment/10 p-3">
            <div className="font-display text-parchment">{feat.name}</div>
            {feat.description && (
              <p className="font-ui text-xs text-parchment/60">{plainText(feat.description)}</p>
            )}
            <div className="flex flex-wrap gap-3">
              {prompts.map((prompt) => {
                // Normalized, so a choice saved in the pre-migration Foundry path
                // form still shows as selected rather than blank.
                const current = featChoicesFor(state, feat.id)[prompt.flag] ?? '';
                return (
                  <label key={prompt.flag} className="flex flex-col gap-1 font-ui text-sm">
                    <span className="text-parchment/70">{prompt.prompt}</span>
                    <select
                      className="rounded-lg border border-gold-500/25 bg-midnight-950/50 px-2 py-1.5 text-sm text-parchment focus:border-gold-400/60 focus:outline-none"
                      value={current}
                      onChange={(e) => setFeatChoice(feat.id, prompt.flag, e.target.value)}
                    >
                      <option value="">— choose —</option>
                      {prompt.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
