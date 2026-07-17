import { useState } from 'react';
import { validate } from '../rules';
import { prerequisiteProblems } from '../prerequisites';
import { useBuilder } from '../store';
import { CharacterOverview } from '../CharacterOverview';
import { FeatChoicesPanel } from '../FeatChoicesPanel';
import { toPathbuilder } from '@/features/builder/pathbuilder';

export function ReviewStep() {
  const state = useBuilder((s) => s.state);
  const [copied, setCopied] = useState(false);

  const problems = [...validate(state), ...prerequisiteProblems(state)];
  const complete = problems.length === 0;
  const exportJson = JSON.stringify(toPathbuilder(state), null, 2);

  const download = () => {
    const blob = new Blob([exportJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(state.name || 'character').toLowerCase().replace(/\s+/g, '-')}.pathbuilder.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copy = async () => {
    await navigator.clipboard.writeText(exportJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="mb-1 font-display text-xl text-gold-400">Review &amp; Export</h3>
        <p className="font-ui text-sm text-parchment/70">
          Export produces Pathbuilder-compatible JSON that the Pathway Discord bot reads directly.
        </p>
      </div>

      {!complete && (
        <div className="rounded-xl border border-red-400/30 bg-red-500/10 p-4">
          <div className="mb-2 font-display text-red-300">Still to do</div>
          <ul className="list-inside list-disc font-ui text-sm text-parchment/80">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {complete && (
        <div className="rounded-xl border border-green-400/30 bg-green-500/10 p-4 font-ui text-sm text-green-200">
          Your character is complete and valid.
        </div>
      )}

      <FeatChoicesPanel />

      <CharacterOverview state={state} />

      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn btn-primary" onClick={download}>
          Download JSON
        </button>
        <button type="button" className="btn" onClick={copy}>
          {copied ? 'Copied!' : 'Copy JSON'}
        </button>
      </div>
      <p className="font-ui text-xs text-parchment/50">
        Use <span className="text-gold-400">Save to Vault</span> at the top to store this character
        and sync it to the Discord bot — then download a PDF from its sheet. The JSON here is for
        Pathbuilder round-tripping or a manual backup.
      </p>

      <details className="panel p-5">
        <summary className="cursor-pointer font-display text-gold-400">View export JSON</summary>
        <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-midnight-950/70 p-4 font-mono text-xs text-parchment/80">
          {exportJson}
        </pre>
      </details>
    </div>
  );
}
