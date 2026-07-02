import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { emptyBuilderState } from './types';
import { STEPS, useBuilder } from './store';
import { CharacterSummary } from './CharacterSummary';
import { BeginnerNote } from './BeginnerNote';
import { PortraitPicker } from './PortraitPicker';
import { fromPathbuilder } from '@/features/builder/pathbuilder';
import { useApp } from '@/features/builder/appStore';
import { OptionsModal } from '@/features/builder/options/OptionsModal';
import { AncestryStep } from './steps/AncestryStep';
import { HeritageStep } from './steps/HeritageStep';
import { BackgroundStep } from './steps/BackgroundStep';
import { ClassStep } from './steps/ClassStep';
import { AbilitiesStep } from './steps/AbilitiesStep';
import { SkillsStep } from './steps/SkillsStep';
import { FeatsStep } from './steps/FeatsStep';
import { AdvancementStep } from './steps/AdvancementStep';
import { EquipmentStep } from './steps/EquipmentStep';
import { ReviewStep } from './steps/ReviewStep';

const STEP_CONTENT = {
  ancestry: AncestryStep,
  heritage: HeritageStep,
  background: BackgroundStep,
  class: ClassStep,
  abilities: AbilitiesStep,
  skills: SkillsStep,
  feats: FeatsStep,
  advancement: AdvancementStep,
  equipment: EquipmentStep,
  review: ReviewStep,
} as const;

function BeginnerToggle() {
  const beginner = useApp((s) => s.beginner);
  const setBeginner = useApp((s) => s.setBeginner);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={beginner}
      onClick={() => setBeginner(!beginner)}
      className="flex items-center gap-2 font-ui text-xs text-parchment/70"
      title="Beginner Mode adds plain-language guidance on every step"
    >
      <span
        className="relative h-5 w-9 rounded-full border transition"
        style={{
          borderColor: beginner ? 'rgba(232,200,119,0.7)' : 'rgba(201,209,224,0.25)',
          background: beginner ? 'rgba(212,175,55,0.35)' : 'rgba(201,209,224,0.08)',
        }}
      >
        <span
          className="absolute top-0.5 h-3.5 w-3.5 rounded-full bg-parchment transition-all"
          style={{ left: beginner ? '1.25rem' : '0.15rem' }}
        />
      </span>
      Beginner Mode
    </button>
  );
}

export function BuilderApp() {
  const { step, setStep } = useBuilder();
  const state = useBuilder((s) => s.state);
  const update = useBuilder((s) => s.update);
  const replace = useBuilder((s) => s.replace);
  const setCurrentId = useApp((s) => s.setCurrentCharacterId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);

  const index = STEPS.findIndex((s) => s.id === step);
  const Content = STEP_CONTENT[step];

  const importJson = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      const parsed = fromPathbuilder(data);
      replace({ ...emptyBuilderState(), ...parsed });
      setCurrentId(null);
      setStep('review');
    } catch {
      alert('That file did not look like Pathbuilder JSON.');
    }
  };

  return (
    <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 lg:grid-cols-[1fr_20rem]">
      <main className="flex flex-col gap-6">
        {/* Top toolbar: back, portrait, name, actions */}
        <div className="panel flex flex-wrap items-center gap-4 p-4">
          <Link to="/vault" className="btn py-1 text-xs" title="Back to your vault">
            ← Vault
          </Link>
          <PortraitPicker />
          <input
            className="min-w-0 flex-1 rounded-lg border border-gold-500/25 bg-midnight-950/50 px-4 py-2 font-display text-lg text-parchment placeholder:text-parchment/40 focus:border-gold-400/60 focus:outline-none"
            placeholder="Name your character…"
            value={state.name}
            onChange={(e) => update({ name: e.target.value })}
          />
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])}
          />
          <div className="flex items-center gap-3">
            <BeginnerToggle />
            <button
              type="button"
              className="btn"
              disabled
              title="Saving to your vault (and syncing to the Discord bot) is wired in the next integration step. For now, finish on the Review step and use Export JSON."
            >
              Save to Vault (soon)
            </button>
            <button type="button" className="btn" onClick={() => setOptionsOpen(true)}>
              ⚙ Options
            </button>
            <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
              Import
            </button>
          </div>
        </div>

        {optionsOpen && <OptionsModal onClose={() => setOptionsOpen(false)} />}

        {/* Stepper */}
        <nav className="flex flex-wrap gap-1.5">
          {STEPS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setStep(s.id)}
              className="flex items-center gap-2 rounded-lg border px-3 py-1.5 font-ui text-sm transition"
              style={{
                borderColor: s.id === step ? 'rgba(232,200,119,0.7)' : 'rgba(212,175,55,0.2)',
                background: s.id === step ? 'rgba(212,175,55,0.15)' : 'transparent',
                opacity: i <= index ? 1 : 0.55,
              }}
            >
              <span className="font-display text-gold-400">{i + 1}</span>
              <span className="text-parchment">{s.label}</span>
            </button>
          ))}
        </nav>

        <section className="panel p-6">
          <BeginnerNote step={step} />
          <Content />
        </section>

        {/* Prev / Next */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            className="btn"
            disabled={index === 0}
            onClick={() => setStep(STEPS[Math.max(0, index - 1)].id)}
          >
            ← Back
          </button>
          <span className="font-ui text-sm text-parchment/50">
            Step {index + 1} of {STEPS.length}
          </span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={index === STEPS.length - 1}
            onClick={() => setStep(STEPS[Math.min(STEPS.length - 1, index + 1)].id)}
          >
            Next →
          </button>
        </div>
      </main>

      <CharacterSummary />
    </div>
  );
}
