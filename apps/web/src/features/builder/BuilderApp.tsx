import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { emptyBuilderState } from './types';
import { STEPS, useBuilder } from './store';
import { validate } from './rules';
import { clearDraft, isEmptyState, loadDraft, saveDraft, type BuilderDraft } from './drafts';
import { CharacterSummary } from './CharacterSummary';
import { MobileStatBar } from './MobileStatBar';
import { BeginnerNote } from './BeginnerNote';
import { PortraitPicker } from './PortraitPicker';
import { fromPathbuilder, hasEmbeddedBuild } from '@/features/builder/pathbuilder';
import { useApp } from '@/features/builder/appStore';
import { useSaveBuild } from './useSaveBuild';
import { useAuth } from '@/features/auth/useAuth';
import { useCharacter } from '@/features/characters/useCharacter';
import { OptionsModal } from '@/features/builder/options/OptionsModal';
import { AncestryStep } from './steps/AncestryStep';
import { HeritageStep } from './steps/HeritageStep';
import { BackgroundStep } from './steps/BackgroundStep';
import { ClassStep } from './steps/ClassStep';
import { AbilitiesStep } from './steps/AbilitiesStep';
import { SkillsStep } from './steps/SkillsStep';
import { FeatsStep } from './steps/FeatsStep';
import { AdvancementStep } from './steps/AdvancementStep';
import { SpellsStep } from './steps/SpellsStep';
import { EquipmentStep } from './steps/EquipmentStep';
import { CompanionsStep } from './steps/CompanionsStep';
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
  spells: SpellsStep,
  equipment: EquipmentStep,
  companions: CompanionsStep,
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

export function BuilderApp({
  editCharKey,
  levelUpOnLoad = false,
}: {
  editCharKey?: string;
  levelUpOnLoad?: boolean;
} = {}) {
  const { step, setStep } = useBuilder();
  const state = useBuilder((s) => s.state);
  const update = useBuilder((s) => s.update);
  const replace = useBuilder((s) => s.replace);
  const levelUp = useBuilder((s) => s.levelUp);
  const setCurrentId = useApp((s) => s.setCurrentCharacterId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [resumeDraft, setResumeDraft] = useState<BuilderDraft | null>(() =>
    editCharKey ? null : loadDraft(),
  );
  const [partialLoad, setPartialLoad] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();
  const save = useSaveBuild();

  // Edit / level-up: load the existing character and hydrate the builder once.
  const editing = Boolean(editCharKey);
  const charQuery = useCharacter(editCharKey);
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!editCharKey || hydratedRef.current || !charQuery.data) return;
    hydratedRef.current = true;
    const data = charQuery.data;
    replace({ ...emptyBuilderState(), ...fromPathbuilder(data.pathbuilder_data) });
    setCurrentId(data.id);
    setPartialLoad(!hasEmbeddedBuild(data.pathbuilder_data));
    if (levelUpOnLoad) levelUp();
    else setStep('ancestry');
  }, [editCharKey, charQuery.data, levelUpOnLoad, replace, setCurrentId, setStep, levelUp]);

  const index = STEPS.findIndex((s) => s.id === step);
  const Content = STEP_CONTENT[step];
  const problems = validate(state);
  const complete = problems.length === 0;

  const onSaveDraft = () => {
    saveDraft(state);
    setResumeDraft(null); // this build IS the draft now; no stale resume prompt
    setDraftSaved(true);
    setTimeout(() => setDraftSaved(false), 1500);
  };

  const onResumeDraft = () => {
    if (resumeDraft) replace({ ...emptyBuilderState(), ...resumeDraft.state });
    setResumeDraft(null);
    setStep('ancestry');
  };

  const onDiscardDraft = () => {
    clearDraft();
    setResumeDraft(null);
  };

  const onSave = () => {
    save.mutate(
      { state, editCharKey },
      {
        onSuccess: (result) => {
          if (!editing) clearDraft(); // a fresh build's draft is now saved for real
          setCurrentId(result.id);
          navigate(`/vault/${result.char_key}`);
        },
      },
    );
  };
  // Creating requires a complete character; updating an existing one doesn't
  // (you may be mid-level-up), so we only gate create on validity.
  const canSave = Boolean(user) && !save.isPending && (editing || complete);
  const saveLabel = save.isPending
    ? editing
      ? 'Updating…'
      : 'Saving…'
    : editing
      ? 'Update Character'
      : 'Save to Vault';
  const saveTitle = !user
    ? 'Sign in to save to your vault — you can still Export JSON on the Review step.'
    : !editing && !complete
      ? 'Finish the remaining choices (see the Review step) before saving.'
      : editing
        ? 'Update this character in your vault and sync it to the Discord bot.'
        : 'Save this character to your vault and sync it to the Discord bot.';

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
        <MobileStatBar />
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
              onClick={onSaveDraft}
              title="Save your progress on this device and finish later — no sign-in needed, even if the character isn't complete."
            >
              {draftSaved ? 'Draft saved ✓' : 'Save Draft'}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canSave}
              title={saveTitle}
              onClick={onSave}
            >
              {saveLabel}
            </button>
            <button type="button" className="btn" onClick={() => setOptionsOpen(true)}>
              ⚙ Options
            </button>
            <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
              Import
            </button>
          </div>
        </div>

        {editing && charQuery.isLoading && (
          <div className="rounded-xl border border-gold-500/25 bg-midnight-800/60 p-3 font-ui text-sm text-parchment/70">
            Loading your character…
          </div>
        )}
        {editing && partialLoad && (
          <div className="rounded-xl border border-gold-500/30 bg-gold-500/10 p-3 font-ui text-sm text-parchment/85">
            This character wasn’t built here, so we reconstructed the basics from its Pathbuilder
            data. Review each step — some choices (skills, feats, boosts) may need re‑entering before
            you update.
          </div>
        )}

        {resumeDraft && isEmptyState(state) && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gold-500/30 bg-gold-500/10 p-3">
            <span className="font-ui text-sm text-parchment/85">
              You have an unfinished character saved on this device
              <span className="text-parchment/50"> ({new Date(resumeDraft.updatedAt).toLocaleString()})</span>.
            </span>
            <span className="flex gap-2">
              <button type="button" className="btn btn-primary py-1 text-xs" onClick={onResumeDraft}>
                Resume draft
              </button>
              <button type="button" className="btn py-1 text-xs" onClick={onDiscardDraft}>
                Discard
              </button>
            </span>
          </div>
        )}

        {save.isError && (
          <div className="rounded-xl border border-red-400/30 bg-red-500/10 p-3 font-ui text-sm text-red-200">
            Couldn’t save: {save.error.message}
          </div>
        )}
        {!user && (
          <div className="rounded-xl border border-arcane-400/30 bg-arcane-500/10 p-3 font-ui text-sm text-parchment/80">
            You’re not signed in. You can build and <span className="text-arcane-400">Export JSON</span>{' '}
            freely; <Link to="/login" className="text-gold-400 underline">sign in</Link> to save to your
            vault and sync to the Discord bot.
          </div>
        )}

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
