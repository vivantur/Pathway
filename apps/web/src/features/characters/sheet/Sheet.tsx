import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { safeHttpUrl } from "@/lib/safeUrl";
import { useNavigate, useSearchParams } from 'react-router-dom';
import { isDatasetLoaded, loadDataset } from '@/features/builder/data';
import { loadTraitIndex } from './pathbuilderTraits';
import { PORTRAIT_MIME_TYPES } from '@/features/characters/api';
import { errorMessage } from '@/features/characters/errorMessage';
import {
  useDeleteCharacter,
  useSetCharacterPublic,
  useUpdateFromPathbuilder,
} from '@/features/characters/useCharacterActions';
import { useCharacterRealtime, type RealtimeState } from '@/features/characters/useCharacterRealtime';
import { useUpdateCharacterState } from '@/features/characters/useUpdateCharacterState';
import { useUpdateCharacterOverlay } from '@/features/characters/useUpdateCharacterOverlay';
import { useFavoriteSpells } from '@/features/characters/useFavoriteSpells';
import {
  PF2E_CONDITIONS,
  conditionDef,
  isValuedCondition,
  type ConditionDef,
} from '@/features/characters/conditions';
import type { CharacterStatePatch } from '@/features/characters/api';
import { usePortraitUpload } from '@/features/characters/usePortraitUpload';
import { parsePathbuilderId } from '@/features/characters/pathbuilderImport';
import { exportPathbuilderJson } from '@/features/characters/exportCharacter';
import { computeSensesFromAncestry } from '@/features/characters/pf2eData/senses';
import { mergeWeapons } from '@/features/characters/weapons';
import type { ActiveCondition, CharacterOverlay, CharacterRow } from '@/features/characters/types';
import { AncestryTab } from './tabs/AncestryTab';
import { AbilitiesTab } from './tabs/AbilitiesTab';
import { ClassTab } from './tabs/ClassTab';
import { CompanionsTab } from './tabs/CompanionsTab';
import { EquipmentTab } from './tabs/EquipmentTab';
import { FeatsTab } from './tabs/FeatsTab';
import { JournalTab } from './tabs/JournalTab';
import { PlaceholderTab } from './tabs/PlaceholderTab';
import { SkillsTab } from './tabs/SkillsTab';
import { SpellsTab } from './tabs/SpellsTab';
import { DiceRoller } from './DiceRoller';
import { XpLogModal } from './XpLogModal';
import { TAB_DEFINITIONS, normalizeTabId, type TabId } from './tabs/tabDefs';
import {
  ABILITY_ORDER,
  SKILL_ORDER,
  SKILL_ABILITY,
  TRADITION_COLOR,
  abilityMod,
  defenseLine,
  fmtMod,
  profLabel,
  sizeLabel,
  weaponDamage,
  type Ability,
  type PathbuilderBuild,
  type Spellcaster,
  type Weapon,
} from '@/features/characters/pathbuilder';
// Core stat numbers go through the adapter so site-built characters show the
// SAME values as the builder (falls back to pathbuilder.ts otherwise).
import {
  acTotal,
  classDC,
  focusPoolMax,
  maxHp,
  perceptionBonus,
  resistances as coreResistances,
  saveBonus,
  senses as coreSenses,
  shieldBonus,
  skillBonus,
  speed,
} from './sheetStats';
import { formatSenseLabel } from '@/features/builder/rules';
import {
  BookIcon,
  BrainIcon,
  CameraIcon,
  CompassIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  HeartIcon,
  OverviewIcon,
  RefreshIcon,
  RunningIcon,
  ShareIcon,
  ShieldIcon,
  ShieldPlusIcon,
  StarIcon,
  SwordIcon,
  TrashIcon,
} from './icons';
import { resolveListOverride } from './overrides';

/**
 * Full read-only Pathway character sheet.
 *
 * Layout: fixed header + 3-column body + bottom tab bar. Data is sourced from
 * `pathbuilder_data` (Pathbuilder JSON, rooted — no `.build` wrapper) plus the
 * live play-state columns (HP/hero/dying/wounded/XP). Anything the build
 * doesn't tell us renders as an em-dash placeholder so the layout stays intact
 * for undermodeled characters.
 */
export function Sheet({
  character,
  build,
  readOnly = false,
}: {
  character: CharacterRow;
  build: PathbuilderBuild;
  /**
   * When true, hides all editing affordances — SheetActions, portrait upload
   * camera, and the Journal tab (whose bot notes / XP log may be private).
   * Set by the /share/:id public-view route.
   */
  readOnly?: boolean;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = normalizeTabId(searchParams.get('tab'));

  // Characters built on the site embed their builder state (`_pathwayBuild`).
  // Load the builder dataset so `sheetStats` can derive their stats with the
  // exact same @pathway/core engine the builder used — the sheet then can't
  // drift from the builder. No-op for imported / bot characters, and cached
  // across the session once loaded.
  const hasEmbeddedBuild = !!(build as { _pathwayBuild?: unknown })._pathwayBuild;
  useQuery({
    queryKey: ['builder-dataset-for-sheet'],
    queryFn: loadDataset,
    enabled: hasEmbeddedBuild && !isDatasetLoaded(),
    staleTime: Infinity,
    gcTime: Infinity,
  });
  // Imported / bot characters have no embedded build — load just the small
  // ancestry+heritage index so `sheetStats` can still show their senses &
  // (gap-filling) resistances without recomputing any base numbers.
  useQuery({
    queryKey: ['sheet-trait-index'],
    queryFn: loadTraitIndex,
    enabled: !hasEmbeddedBuild,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  // Live sync: subscribe to bot-side writes on this character. Disabled on
  // read-only public shares (they use a different, non-owner query path).
  const live = useCharacterRealtime({
    characterId: character.id,
    charKey: character.char_key,
    enabled: !readOnly,
  });

  // Live-state editing (HP / hero / dying / wounded / XP / notes). Disabled on
  // read-only shares. The hook is always called (rules of hooks); we just gate
  // whether the UI exposes the controls.
  const stateMutation = useUpdateCharacterState(character.char_key);
  const overlayMutation = useUpdateCharacterOverlay(character.char_key);
  const edit: EditControls = {
    enabled: !readOnly,
    update: (patch) => stateMutation.mutate(patch),
    updateWith: (resolve) => stateMutation.mutate({ resolve }),
    updateOverlay: (mutate) => overlayMutation.mutate(mutate),
    isPending: stateMutation.isPending || overlayMutation.isPending,
  };

  const setActiveTab = (id: TabId) => {
    const next = new URLSearchParams(searchParams);
    // Keep the URL clean when we're on the default view.
    if (id === 'overview') next.delete('tab');
    else next.set('tab', id);
    setSearchParams(next, { replace: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="space-y-4">
      <SheetHeader character={character} build={build} readOnly={readOnly} live={live} edit={edit} />
      <div className="grid gap-4 xl:grid-cols-[288px_1fr_240px]">
        <LeftColumn character={character} build={build} readOnly={readOnly} />
        {/* Center: vitals stay pinned; the tab bar sits above the content;
            only the tab content below swaps per tab. */}
        <div className="space-y-4">
          <StatRow character={character} build={build} edit={edit} />
          <TabBar activeTab={activeTab} onSelect={setActiveTab} readOnly={readOnly} />
          <TabContent tab={activeTab} character={character} build={build} readOnly={readOnly} edit={edit} />
        </div>
        <RightColumn build={build} character={character} edit={edit} />
      </div>
    </div>
  );
}

/**
 * Live-state editing controls threaded to the components that expose them.
 * `enabled` is false on read-only public shares.
 */
export interface EditControls {
  enabled: boolean;
  /** Write absolute live-state values (text entry, currency). */
  update: (patch: CharacterStatePatch) => void;
  /**
   * Write live state derived from the freshest row. Steppers use this so a fast
   * double-tap composes (each click sees the previous optimistic result)
   * instead of sending the same absolute value twice and dropping a step.
   */
  updateWith: (resolve: (prev: CharacterRow | undefined) => CharacterStatePatch) => void;
  /**
   * Read-modify-write the `overlay` blob via a MUTATOR that touches only its
   * own slice. The mutator is applied to the freshest overlay under
   * compare-and-swap, so a concurrent bot write (xp, xpLog) is never clobbered.
   */
  updateOverlay: (mutate: (current: CharacterOverlay) => CharacterOverlay) => void;
  isPending: boolean;
}

function TabContent({
  tab,
  character,
  build,
  readOnly,
  edit,
}: {
  tab: TabId;
  character: CharacterRow;
  build: PathbuilderBuild;
  readOnly: boolean;
  edit: EditControls;
}) {
  // Journal contains private data (character notes + XP log with awarder
  // Discord IDs). Force-swap it out of the router when readOnly.
  if (readOnly && tab === 'journal') {
    return (
      <PlaceholderTab
        label="Journal"
        description="The character journal is private and isn't included in public share views."
        Icon={OverviewIcon}
      />
    );
  }
  switch (tab) {
    case 'overview':
      return <OverviewBody character={character} build={build} edit={edit} />;
    case 'ancestry':
      return <AncestryTab character={character} build={build} />;
    case 'class':
      return <ClassTab character={character} build={build} />;
    case 'abilities':
      return <AbilitiesTab build={build} />;
    case 'skills':
      return <SkillsTab build={build} />;
    case 'feats':
      return <FeatsTab build={build} />;
    case 'spells':
      return <SpellsTab build={build} character={character} edit={edit} />;
    case 'companions':
      return <CompanionsTab build={build} character={character} readOnly={readOnly} />;
    case 'equipment':
      return <EquipmentTab character={character} build={build} edit={edit} />;
    case 'journal':
      return <JournalTab character={character} edit={edit} />;
    default: {
      const def = TAB_DEFINITIONS.find((t) => t.id === tab);
      return <PlaceholderTab label={def?.label ?? 'Coming soon'} description={def?.description ?? ''} Icon={def?.icon ?? OverviewIcon} />;
    }
  }
}

// ---------------------------------------------------------------
// Header
// ---------------------------------------------------------------

function SheetHeader({
  character,
  build,
  readOnly = false,
  live,
  edit,
}: {
  character: CharacterRow;
  build: PathbuilderBuild;
  readOnly?: boolean;
  live?: RealtimeState;
  edit?: EditControls;
}) {
  const level = character.level ?? build.level ?? 1;
  const xpTarget = 1000;
  const xp = character.experience ?? 0;
  const [xpLogOpen, setXpLogOpen] = useState(false);
  const overlay = character.overlay ?? {};
  const bg =
    overlay.pathway_bot_state?.edits?.background ??
    character.background_name ??
    build.background;
  return (
    <header className="rounded-lg border border-gold/25 bg-midnight-900/60 p-4 shadow-gilded">
      <div className="grid items-center gap-4 lg:grid-cols-[auto_1fr_auto]">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <CompassIcon className="text-3xl text-gold" />
          <div className="leading-tight">
            <div className="flex items-center gap-2">
              <span className="font-display text-2xl tracking-wider text-gold">PATHWAY</span>
              {!readOnly && live && <LiveBadge live={live} />}
            </div>
            <div className="text-[0.6rem] uppercase tracking-[0.25em] text-silver/50">
              PF2E Character Sheet
            </div>
          </div>
        </div>

        {/* Form-style field grid */}
        <div className="grid gap-2 sm:grid-cols-3">
          <HeaderField label="Character Name" value={character.name || build.name || '—'} wide />
          <HeaderField label="Ancestry" value={character.ancestry_name ?? build.ancestry} />
          <HeaderField label="Background" value={bg} />
          <HeaderField label="Class" value={character.class_name ?? build.class} />
          <HeaderField label="Level" value={level} />
          {edit?.enabled ? (
            <XpHeaderField xp={xp} target={xpTarget} onOpenLog={() => setXpLogOpen(true)} />
          ) : (
            <HeaderField
              label="Experience Points"
              value={
                <span className="tabular-nums">
                  {xp.toLocaleString()} <span className="text-silver/40">/ {xpTarget.toLocaleString()}</span>
                </span>
              }
            />
          )}
          <HeaderField label="Size" value={sizeLabel(build.size)} />
          <HeaderField label="Speed" value={`${speed(build)} ft.`} />
        </div>

        {/* Actions — hidden entirely on read-only public shares */}
        {!readOnly && <SheetActions character={character} build={build} />}
      </div>
      {xpLogOpen && (
        <XpLogModal charKey={character.char_key} currentXp={xp} onClose={() => setXpLogOpen(false)} />
      )}
    </header>
  );
}

// ---------------------------------------------------------------
// Header actions — Update from Pathbuilder / Share / Delete
// ---------------------------------------------------------------

function SheetActions({ character, build }: { character: CharacterRow; build: PathbuilderBuild }) {
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkRaw, setLinkRaw] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);

  const updateMutation = useUpdateFromPathbuilder();
  const deleteMutation = useDeleteCharacter();
  const publicMutation = useSetCharacterPublic(character.char_key);

  const hasPathbuilderId = typeof character.pathbuilder_id === 'number';

  const handleUpdate = () => {
    // With a stored ID, re-fetch directly. Without one (e.g. a character
    // created in the bot, never imported), open the link form so the player
    // can attach a Pathbuilder export ID — updateCharacterFromBuild will save
    // it onto the row, so future updates work like any imported character.
    if (hasPathbuilderId && character.pathbuilder_id != null) {
      updateMutation.mutate({
        charKey: character.char_key,
        pathbuilderId: character.pathbuilder_id,
      });
    } else {
      setLinkOpen(true);
    }
  };

  const handleLinkSubmit = () => {
    const id = parsePathbuilderId(linkRaw);
    if (id == null) {
      setLinkError(
        "Couldn't find a Pathbuilder id in that. Paste the number (e.g. 123456) or the full URL.",
      );
      return;
    }
    setLinkError(null);
    updateMutation.mutate(
      { charKey: character.char_key, pathbuilderId: id },
      {
        onSuccess: () => {
          setLinkOpen(false);
          setLinkRaw('');
        },
      },
    );
  };

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(character.char_key);
      navigate('/vault');
    } catch {
      // Error surfaces via deleteMutation.error below.
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <HeaderButton
          icon={<RefreshIcon />}
          label={
            updateMutation.isPending
              ? 'Updating…'
              : hasPathbuilderId
                ? 'Update'
                : 'Link Pathbuilder'
          }
          onClick={handleUpdate}
          disabled={updateMutation.isPending}
          title={
            hasPathbuilderId
              ? 'Re-fetch this character from Pathbuilder and refresh the build (HP / XP / hero points / notes / portrait preserved).'
              : 'Attach a Pathbuilder export ID to this character so you can update its build from Pathbuilder.'
          }
        />
        <HeaderButton
          icon={<ShareIcon />}
          label="Share"
          onClick={() => setShareOpen((v) => !v)}
        />
        <HeaderButton
          icon={<DownloadIcon />}
          label="Export"
          onClick={() => setExportOpen((v) => !v)}
        />
        <HeaderButton
          icon={<TrashIcon />}
          label="Delete"
          onClick={() => setConfirmDelete(true)}
          className="hover:border-red-400/60 hover:text-red-300"
        />
      </div>

      {updateMutation.isError && (
        <p className="text-xs text-red-300">{errorMessage(updateMutation.error)}</p>
      )}
      {updateMutation.isSuccess && !updateMutation.isPending && (
        <p className="text-xs text-emerald-soft">
          {hasPathbuilderId ? 'Updated from Pathbuilder ✓' : 'Linked to Pathbuilder ✓'}
        </p>
      )}

      {/* Let characters that already have an ID re-point to a different one. */}
      {hasPathbuilderId && !linkOpen && (
        <button
          type="button"
          onClick={() => setLinkOpen(true)}
          className="self-start text-[0.6rem] uppercase tracking-widest text-silver/50 hover:text-gold"
        >
          Change Pathbuilder link
        </button>
      )}

      {linkOpen && (
        <PathbuilderLinkForm
          raw={linkRaw}
          isBusy={updateMutation.isPending}
          error={linkError}
          relink={hasPathbuilderId}
          onChange={(v) => {
            setLinkRaw(v);
            setLinkError(null);
          }}
          onSubmit={handleLinkSubmit}
          onCancel={() => {
            setLinkOpen(false);
            setLinkError(null);
          }}
        />
      )}

      {shareOpen && (
        <SharePopup
          character={character}
          publicMutation={publicMutation}
          onClose={() => setShareOpen(false)}
        />
      )}

      {exportOpen && (
        <ExportPopup
          character={character}
          build={build}
          onClose={() => setExportOpen(false)}
        />
      )}

      {confirmDelete && (
        <ConfirmDeleteDialog
          name={character.name}
          isDeleting={deleteMutation.isPending}
          error={deleteMutation.error ? errorMessage(deleteMutation.error) : null}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}

/** Export menu — download the character in various formats. */
function ExportPopup({
  character,
  build,
  onClose,
}: {
  character: CharacterRow;
  build: PathbuilderBuild;
  onClose: () => void;
}) {
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const handlePdf = async () => {
    setPdfBusy(true);
    setPdfError(null);
    try {
      // Lazy-load pdf-lib (and the generator) so it's not in the main bundle.
      const [{ buildCharacterSheetPdf }, { downloadFile, safeFileName }] = await Promise.all([
        import('@/features/characters/pdf/characterSheetPdf'),
        import('@/features/characters/exportCharacter'),
      ]);
      const bytes = await buildCharacterSheetPdf(character, build);
      downloadFile(
        safeFileName(character.name || build.name, 'pdf'),
        bytes,
        'application/pdf',
      );
      onClose();
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'Could not build the PDF.');
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div className="w-64 rounded-md border border-gold/30 bg-midnight-900/90 p-3 shadow-gilded">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[0.65rem] uppercase tracking-widest text-gold/80">Export</span>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-silver/50 hover:text-gold"
          aria-label="Close export panel"
        >
          ✕
        </button>
      </div>
      <div className="space-y-2">
        <button
          type="button"
          onClick={handlePdf}
          disabled={pdfBusy}
          className="flex w-full items-center gap-2 rounded border border-gold/20 bg-midnight-900/60 px-2 py-2 text-left text-sm text-silver/90 hover:border-gold/50 hover:text-gold disabled:opacity-60"
        >
          <span className="text-gold">
            <DownloadIcon />
          </span>
          <span>
            <span className="block">{pdfBusy ? 'Building PDF…' : 'Character Sheet (PDF)'}</span>
            <span className="block text-[0.6rem] uppercase tracking-widest text-silver/50">
              Printable Pathway sheet
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => {
            exportPathbuilderJson(character.name || build.name, build);
            onClose();
          }}
          className="flex w-full items-center gap-2 rounded border border-gold/20 bg-midnight-900/60 px-2 py-2 text-left text-sm text-silver/90 hover:border-gold/50 hover:text-gold"
        >
          <span className="text-gold">
            <DownloadIcon />
          </span>
          <span>
            <span className="block">Pathbuilder JSON</span>
            <span className="block text-[0.6rem] uppercase tracking-widest text-silver/50">
              Round-trips to Pathbuilder tools
            </span>
          </span>
        </button>
      </div>
      {pdfError && <p className="mt-2 text-[0.65rem] text-red-300">{pdfError}</p>}
    </div>
  );
}

/** Inline form to attach (or re-point) a character's Pathbuilder export ID. */
function PathbuilderLinkForm({
  raw,
  isBusy,
  error,
  relink,
  onChange,
  onSubmit,
  onCancel,
}: {
  raw: string;
  isBusy: boolean;
  error: string | null;
  relink: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="w-72 rounded-md border border-gold/30 bg-midnight-900/90 p-3 shadow-gilded">
      <div className="mb-2 text-[0.65rem] uppercase tracking-widest text-gold/80">
        {relink ? 'Re-link Pathbuilder' : 'Link a Pathbuilder export'}
      </div>
      <p className="mb-2 text-[0.65rem] leading-relaxed text-silver/60">
        In Pathbuilder, tap <span className="text-silver/80">Export → JSON</span> to get an
        ID, then paste the number or the full URL here. Your live state (HP, XP,
        hero points, notes, portrait) is kept.
      </p>
      <input
        autoFocus
        type="text"
        value={raw}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit();
          if (e.key === 'Escape') onCancel();
        }}
        placeholder="123456 or https://pathbuilder2e.com/json.php?id=123456"
        className="w-full rounded border border-gold/30 bg-midnight-800/80 px-2 py-1.5 text-sm text-silver placeholder:text-silver/30 focus:border-gold/60 focus:outline-none"
      />
      {error && <p className="mt-1 text-[0.65rem] text-red-300">{error}</p>}
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="text-xs uppercase tracking-widest text-silver/60 hover:text-gold"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={isBusy || raw.trim().length === 0}
          className="rounded border border-gold/40 bg-gold/10 px-2 py-1 text-xs font-display uppercase tracking-widest text-gold hover:bg-gold/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isBusy ? 'Linking…' : relink ? 'Re-link & Update' : 'Link & Update'}
        </button>
      </div>
    </div>
  );
}

function SharePopup({
  character,
  publicMutation,
  onClose,
}: {
  character: CharacterRow;
  publicMutation: ReturnType<typeof useSetCharacterPublic>;
  onClose: () => void;
}) {
  const isPublic = Boolean(character.is_public);
  const shareUrl = character.public_share_id
    ? `${window.location.origin}/share/${character.public_share_id}`
    : null;

  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard write can fail on non-HTTPS or old browsers; ignore.
    }
  };

  return (
    <div className="w-72 rounded-md border border-gold/30 bg-midnight-900/90 p-3 shadow-gilded">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[0.65rem] uppercase tracking-widest text-gold/80">
          Sharing
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-silver/50 hover:text-gold"
          aria-label="Close share panel"
        >
          ✕
        </button>
      </div>

      <label className="flex cursor-pointer items-center justify-between gap-3 rounded border border-gold/15 bg-midnight-900/60 px-2 py-1.5">
        <span className="text-xs text-silver/85">
          {isPublic ? 'Publicly viewable' : 'Private (only you)'}
        </span>
        <input
          type="checkbox"
          checked={isPublic}
          onChange={(e) => publicMutation.mutate(e.target.checked)}
          disabled={publicMutation.isPending}
          className="h-4 w-4 accent-gold"
        />
      </label>

      {shareUrl && isPublic && (
        <div className="mt-2 space-y-1">
          <div className="text-[0.6rem] uppercase tracking-widest text-gold/70">
            Share URL{' '}
            <span className="text-silver/40">(anyone with the link can view)</span>
          </div>
          <div className="flex gap-1">
            <input
              readOnly
              value={shareUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 rounded border border-gold/20 bg-midnight-800/70 px-2 py-1 font-mono text-[0.65rem] text-silver/80"
            />
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1 rounded border border-gold/30 bg-midnight-800/70 px-2 text-[0.65rem] uppercase tracking-widest text-gold hover:border-gold/60"
              title="Copy to clipboard"
            >
              <CopyIcon />
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="text-[0.6rem] italic text-silver/50">
            The public view is read-only. Turn sharing off to revoke access.
          </p>
        </div>
      )}

      {publicMutation.isError && (
        <p className="mt-2 text-[0.65rem] text-red-300">
          {errorMessage(publicMutation.error)}
        </p>
      )}
    </div>
  );
}

function ConfirmDeleteDialog({
  name,
  isDeleting,
  error,
  onConfirm,
  onCancel,
}: {
  name: string;
  isDeleting: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-midnight-950/80 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-lg border border-red-500/40 bg-midnight-900 p-5 shadow-gilded"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-display text-lg text-red-300">Delete {name}?</h3>
        <p className="mt-2 text-sm text-silver/80">
          This removes the character from your vault permanently. Their bot-side
          record (if any) is not affected.
        </p>
        {error && (
          <p className="mt-3 rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-300">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            className="rounded-md border border-gold/25 bg-midnight-800/70 px-3 py-1.5 text-sm text-silver/80 hover:border-gold/50 hover:text-gold disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="inline-flex items-center gap-2 rounded-md border border-red-500/50 bg-red-500/10 px-3 py-1.5 text-sm font-display uppercase tracking-widest text-red-300 hover:border-red-400 hover:bg-red-500/20 disabled:opacity-50"
          >
            {isDeleting && (
              <span
                aria-hidden
                className="h-3 w-3 animate-spin rounded-full border-2 border-red-500/30 border-t-red-300"
              />
            )}
            {isDeleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * "Live" pill next to the wordmark. Shows a pulsing green dot when the
 * Realtime channel is subscribed, and briefly flashes gold when the bot
 * pushes an update. Silent (nothing rendered) while off/connecting so it
 * doesn't clutter the header before the socket is up.
 */
function LiveBadge({ live }: { live: RealtimeState }) {
  const [flash, setFlash] = useState(false);

  // Flash on each new bot update.
  useEffect(() => {
    if (live.lastUpdateAt == null) return;
    setFlash(true);
    const t = window.setTimeout(() => setFlash(false), 1200);
    return () => window.clearTimeout(t);
  }, [live.lastUpdateAt]);

  if (live.status !== 'live') return null;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.55rem] font-display uppercase tracking-widest transition-colors ${
        flash
          ? 'border-gold/70 bg-gold/20 text-gold'
          : 'border-emerald/40 bg-emerald/10 text-emerald-soft'
      }`}
      title={
        flash
          ? 'Just synced a change from the bot'
          : 'Live — bot changes appear here automatically'
      }
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${flash ? 'bg-gold' : 'animate-pulse bg-emerald-soft'}`}
        aria-hidden
      />
      {flash ? 'Synced' : 'Live'}
    </span>
  );
}

function HeaderField({
  label,
  value,
  wide,
}: {
  label: string;
  value: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2 ${wide ? 'sm:col-span-1' : ''}`}>
      <div className="whitespace-nowrap text-[0.6rem] uppercase tracking-widest text-gold/70">
        {label}
      </div>
      <div className="flex-1 rounded-sm border border-gold/20 bg-midnight-800/80 px-3 py-1 font-serif text-silver">
        {value || '—'}
      </div>
    </div>
  );
}

/**
 * Read-only XP header field. XP can no longer be typed directly — clicking it
 * opens the XP Log, where entries are added/edited (and the total follows).
 */
function XpHeaderField({ xp, target, onOpenLog }: { xp: number; target: number; onOpenLog: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <div className="whitespace-nowrap text-[0.6rem] uppercase tracking-widest text-gold/70">
        Experience Points
      </div>
      <button
        type="button"
        onClick={onOpenLog}
        title="Open the XP log to add or edit entries"
        className="group flex flex-1 items-center gap-1 rounded-sm border border-gold/20 bg-midnight-800/80 px-3 py-1 font-serif text-silver transition hover:border-gold/50 hover:bg-midnight-800"
      >
        <span className="tabular-nums">{xp.toLocaleString()}</span>
        <span className="text-silver/40">/ {target.toLocaleString()}</span>
        <StarIcon className="ml-auto text-xs text-gold/50 transition group-hover:text-gold" />
      </button>
    </div>
  );
}

function HeaderButton({
  icon,
  label,
  onClick,
  disabled,
  className,
  title,
  ...aria
}: {
  icon: ReactNode;
  label?: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  title?: string;
  'aria-label'?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center gap-2 rounded-md border border-gold/25 bg-midnight-800/70 px-3 py-1.5 text-sm text-silver/80 transition-colors hover:border-gold/60 hover:text-gold disabled:cursor-not-allowed disabled:opacity-50 ${className ?? ''}`}
      {...aria}
    >
      <span className="text-base text-gold">{icon}</span>
      {label && <span>{label}</span>}
    </button>
  );
}

// ---------------------------------------------------------------
// Left column
// ---------------------------------------------------------------

function LeftColumn({
  character,
  build,
  readOnly = false,
}: {
  character: CharacterRow;
  build: PathbuilderBuild;
  readOnly?: boolean;
}) {
  const perception = perceptionBonus(build);
  const overlay = character.overlay ?? {};
  // Overlay-side edits win when present (bot is the authority when set);
  // then, for site-built characters, the core engine's senses (level-scaled,
  // heritage-aware — same as the builder); otherwise the ancestry+heritage
  // lookup, preferring the denormalized `ancestry_name`/`heritage_name` columns
  // which stay accurate even after Pathbuilder re-imports.
  // A bot/sheet override only wins when it's actually set. The overlay seeds
  // these edit lists to `[]`, and `[] ?? fallback` keeps the empty array (??
  // only falls through on null/undefined) — which would blank out every
  // web-built character's senses & languages. Treat an empty edit as "no
  // override" and fall through to the derived / build values.
  const derivedSenses = coreSenses(build);
  const senses = resolveListOverride(
    overlay.pathway_bot_state?.edits?.senses,
    derivedSenses.length > 0
      ? derivedSenses.map(formatSenseLabel)
      : computeSensesFromAncestry(
          character.ancestry_name ?? build.ancestry,
          character.heritage_name ?? build.heritage,
        ),
  );
  // Damage resistances from the core engine (empty for imported/bot characters,
  // and for low levels where they round to 0).
  const resistances = coreResistances(build);
  const languages = resolveListOverride(overlay.pathway_bot_state?.edits?.languages, build.languages ?? []);
  return (
    <aside className="space-y-4">
      <Portrait
        art={character.art}
        name={character.name || build.name}
        charKey={character.char_key}
        readOnly={readOnly}
      />
      <AbilityScoreList build={build} />
      {/* Ability-boost trail moved off the main page — it's on the Abilities
          tab. Keeps the left rail focused on at-a-glance info. */}
      <FramedBlock title="Senses">
        <p className="text-sm text-silver/80">
          {senses.length ? senses.join(', ') : '—'}
        </p>
        <p className="mt-1 text-xs text-silver/60">Perception {fmtMod(perception)}</p>
        {resistances.length > 0 && (
          <p className="mt-1 text-xs text-silver/60">
            Resistances:{' '}
            {resistances
              .map((r) => `${r.type[0].toUpperCase()}${r.type.slice(1)} ${r.value}`)
              .join(', ')}
          </p>
        )}
      </FramedBlock>
      <FramedBlock title="Languages">
        <p className="text-sm text-silver/80">
          {languages.length ? languages.join(', ') : '—'}
        </p>
      </FramedBlock>
    </aside>
  );
}

function Portrait({
  art,
  name,
  charKey,
  readOnly = false,
}: {
  art: string | null;
  name: string | undefined;
  charKey: string;
  readOnly?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const upload = usePortraitUpload(charKey);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMessage(null);
    const file = e.target.files?.[0];
    // Reset so selecting the same file again re-triggers `onChange`.
    e.target.value = '';
    if (!file) return;
    upload.mutate(file, {
      onError: (err) => {
        setErrorMessage(err instanceof Error ? err.message : 'Upload failed.');
      },
    });
  };

  return (
    <div className="mx-auto flex flex-col items-center">
      {/* Outer wrapper stays un-clipped so the camera button can peek over
          the circle's edge without getting eaten by the rounded mask. */}
      <div className="relative h-64 w-64">
        {/* Inner mask: the actual circle. Overflow-hidden lives HERE, not
            on the parent — otherwise the button gets clipped and disappears
            (which is exactly what happened in the previous version). */}
        <div className="absolute inset-0 overflow-hidden rounded-full border-2 border-gold/40 bg-gradient-to-br from-midnight-700 to-midnight-900 shadow-gilded">
          {art ? (
            <img
              src={safeHttpUrl(art)}
              alt={name ?? 'Character portrait'}
              className="h-full w-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="font-display text-6xl text-gold/60">{initials(name)}</span>
            </div>
          )}

          {upload.isPending && (
            <div className="absolute inset-0 flex items-center justify-center bg-midnight-900/75 text-xs uppercase tracking-widest text-gold/90">
              Uploading…
            </div>
          )}
        </div>

        {/* Camera button — outside the clipped circle so it's fully visible
            even when it slightly overlaps the round edge. Sits at ~5 o'clock. */}
        {!readOnly && (
          <>
            <button
              type="button"
              aria-label="Upload portrait"
              disabled={upload.isPending}
              onClick={() => fileInputRef.current?.click()}
              className="absolute bottom-2 right-2 z-10 rounded-full border-2 border-gold/60 bg-midnight-900 p-2.5 text-gold shadow-gilded transition-all hover:scale-105 hover:border-gold hover:bg-midnight-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CameraIcon className="text-base" />
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept={PORTRAIT_MIME_TYPES.join(',')}
              className="hidden"
              onChange={handleFile}
            />
          </>
        )}
      </div>
      {errorMessage && (
        <p className="mt-2 max-w-[16rem] text-center text-xs text-red-300">{errorMessage}</p>
      )}
    </div>
  );
}

function AbilityScoreList({ build }: { build: PathbuilderBuild }) {
  return (
    <ul className="space-y-1.5">
      {ABILITY_ORDER.map((ab) => {
        const score = build.abilities?.[ab] ?? 10;
        const mod = abilityMod(score);
        return (
          <li
            key={ab}
            className="flex items-center gap-3 rounded-md border border-gold/15 bg-midnight-900/60 px-3 py-2"
          >
            <span className="w-10 text-[0.7rem] uppercase tracking-widest text-gold/80">
              {ab.toUpperCase()}
            </span>
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-gold/30 bg-midnight-800 font-display text-silver">
              {score}
            </span>
            <span className="ml-auto w-8 text-right font-display text-lg text-gold">
              {fmtMod(mod)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function FramedBlock({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="relative rounded-md border border-gold/20 bg-midnight-900/60 p-3">
      <CornerAccents />
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[0.65rem] uppercase tracking-widest text-gold/80">
        {icon && <span className="text-sm text-gold">{icon}</span>}
        {title}
      </h3>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------
// Center column
// ---------------------------------------------------------------

/**
 * The Overview tab's body — the per-tab content that swaps below the pinned
 * vitals + tab bar. Skills / Attacks / Feats are the "three big boxes" the
 * table feedback asked to sit under the tabs.
 */
function OverviewBody({
  character,
  build,
  edit,
}: {
  character: CharacterRow;
  build: PathbuilderBuild;
  edit: EditControls;
}) {
  return (
    <div className="space-y-4">
      {/* Skills gets one column; Attacks & Spellcasting spans two so its
          dense rows have room to breathe. Feats moved off Overview — they
          have their own tab. Equipment / Inventory / Treasure / Notes were
          removed too: each has a dedicated tab, so Overview stays focused. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <SkillsPanel build={build} />
        <div className="lg:col-span-2">
          <AttacksPanel character={character} build={build} edit={edit} />
        </div>
      </div>
    </div>
  );
}

// ---- Ornate top stat row ---------------------------------------

function StatRow({
  character,
  build,
  edit,
}: {
  character: CharacterRow;
  build: PathbuilderBuild;
  edit: EditControls;
}) {
  const max = maxHp(build);
  const hero = character.hero_points ?? character.overlay?.daily?.hero_points ?? 0;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
      <HpCard current={character.current_hp} max={max ?? null} edit={edit} />
      <AcCard key={character.id} build={build} edit={edit} />
      <StatCard label="Fortitude" icon={<ShieldPlusIcon />} value={fmtMod(saveBonus(build, 'fortitude'))} />
      <StatCard label="Reflex" icon={<RunningIcon />} value={fmtMod(saveBonus(build, 'reflex'))} />
      <StatCard label="Will" icon={<BrainIcon />} value={fmtMod(saveBonus(build, 'will'))} />
      <StatCard
        label="Perception"
        icon={<EyeIcon />}
        value={fmtMod(perceptionBonus(build))}
        sub={`Init ${fmtMod(perceptionBonus(build))}`}
      />
      <HeroPointsCard value={hero} edit={edit} />
    </div>
  );
}

/**
 * HP stat card. Read-only when editing is disabled (public share); otherwise
 * shows − / + damage-heal steppers and a click-to-set current value.
 */
function HpCard({
  current,
  max,
  edit,
}: {
  current: number | null;
  max: number | null;
  edit: EditControls;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const clamp = (n: number) => Math.max(0, max != null ? Math.min(n, max) : n);
  const setHp = (n: number) => edit.update({ current_hp: clamp(n) });
  // Deltas resolve against the freshest row so rapid taps compose (see updateWith).
  const stepHp = (delta: number) =>
    edit.updateWith((prev) => ({ current_hp: clamp((prev?.current_hp ?? current ?? 0) + delta) }));

  const commit = () => {
    const n = Number(draft);
    if (!Number.isNaN(n)) setHp(n);
    setEditing(false);
  };

  return (
    <div className="relative rounded-md border border-gold/30 bg-midnight-900/70 px-3 py-3 text-center shadow-gilded">
      <CornerAccents />
      <div className="text-[0.65rem] font-display uppercase tracking-widest text-gold/90">HP</div>
      <div className="my-1 flex justify-center text-xl">
        <HeartIcon className="text-red-400" />
      </div>

      {editing ? (
        <input
          autoFocus
          type="number"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEditing(false);
          }}
          className="w-16 rounded border border-gold/40 bg-midnight-800 text-center font-display text-lg text-silver focus:outline-none"
        />
      ) : (
        <button
          type="button"
          disabled={!edit.enabled}
          onClick={() => {
            setDraft(String(current ?? 0));
            setEditing(true);
          }}
          className={`font-display text-2xl text-silver tabular-nums ${edit.enabled ? 'hover:text-gold' : 'cursor-default'}`}
          title={edit.enabled ? 'Click to set HP' : undefined}
        >
          {current ?? '—'}
          <span className="text-silver/40"> / {max ?? '—'}</span>
        </button>
      )}

      {edit.enabled && !editing && (
        <div className="mt-1 flex items-center justify-center gap-1">
          <StepBtn label="−" onClick={() => stepHp(-1)} />
          <StepBtn label="+" onClick={() => stepHp(1)} />
        </div>
      )}
    </div>
  );
}

function StepBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-5 w-5 items-center justify-center rounded border border-gold/30 bg-midnight-800/70 font-display text-sm text-gold/90 transition-colors hover:border-gold/60 hover:bg-midnight-800"
    >
      {label}
    </button>
  );
}

function StatCard({
  label,
  icon,
  value,
  sub,
}: {
  label: string;
  icon: ReactNode;
  value: ReactNode;
  /** Small caption under the value (e.g. Perception's Initiative modifier). */
  sub?: ReactNode;
}) {
  return (
    <div className="relative rounded-md border border-gold/30 bg-midnight-900/70 px-3 py-3 text-center shadow-gilded">
      <CornerAccents />
      <div className="text-[0.65rem] font-display uppercase tracking-widest text-gold/90">
        {label}
      </div>
      <div className="my-1 flex justify-center text-xl text-gold">{icon}</div>
      <div className="font-display text-2xl text-silver">{value}</div>
      {sub && (
        <div className="mt-1 border-t border-gold/15 pt-1 text-[0.62rem] font-display uppercase tracking-wide text-arcane/90">
          {sub}
        </div>
      )}
    </div>
  );
}

/**
 * AC stat card with a "Raise Shield" quick action. When the character carries
 * a shield (`acTotal.shieldBonus > 0`) and editing is enabled, a toggle bumps
 * the shown AC by the shield bonus and tints the card — modelling the raised
 * condition until your next turn. The raised state is deliberately ephemeral
 * (view-only, resets on reload): it's a turn-scale combat toggle, not a
 * persisted stat, and it never writes to the DB or overlay.
 */
function AcCard({ build, edit }: { build: PathbuilderBuild; edit: EditControls }) {
  const base = acTotal(build);
  const shield = shieldBonus(build);
  const [raised, setRaised] = useState(false);
  const canRaise = edit.enabled && shield > 0;
  const shown = raised && base != null ? base + shield : base;

  return (
    <div
      className={`relative rounded-md border bg-midnight-900/70 px-3 py-3 text-center shadow-gilded ${
        raised ? 'border-arcane/70' : 'border-gold/30'
      }`}
    >
      <CornerAccents />
      <div className="text-[0.65rem] font-display uppercase tracking-widest text-gold/90">AC</div>
      <div className="my-1 flex justify-center text-xl text-gold">
        <ShieldIcon />
      </div>
      <div className={`font-display text-2xl tabular-nums ${raised ? 'text-arcane' : 'text-silver'}`}>
        {shown ?? '—'}
      </div>
      {canRaise ? (
        <button
          type="button"
          onClick={() => setRaised((r) => !r)}
          title={`Raise a shield (+${shield} AC until your next turn)`}
          className={`mt-1 text-[0.55rem] uppercase tracking-widest transition-colors ${
            raised ? 'text-arcane hover:text-arcane-soft' : 'text-silver/50 hover:text-gold'
          }`}
        >
          {raised ? `▲ Shield +${shield}` : 'Raise Shield'}
        </button>
      ) : shield > 0 ? (
        <div className="mt-0.5 text-[0.55rem] uppercase tracking-widest text-silver/40">
          Shield +{shield}
        </div>
      ) : null}
    </div>
  );
}

function HeroPointsCard({ value, edit }: { value: number; edit: EditControls }) {
  // Clicking pip i sets hero points to i+1; clicking the current top pip
  // toggles it back down by one.
  const setPip = (i: number) => {
    // Resolve against the freshest row so a fast re-tap toggles from the real
    // current value rather than a stale captured prop.
    edit.updateWith((prev) => {
      const v = prev?.hero_points ?? value;
      return { hero_points: v === i + 1 ? i : i + 1 };
    });
  };
  return (
    <div className="relative rounded-md border border-gold/30 bg-midnight-900/70 px-3 py-3 text-center shadow-gilded">
      <CornerAccents />
      <div className="text-[0.65rem] font-display uppercase tracking-widest text-gold/90">
        Hero Points
      </div>
      <div className="my-1 flex justify-center text-xl text-gold">
        <StarIcon />
      </div>
      <div className="flex justify-center gap-1.5">
        {[0, 1, 2].map((i) =>
          edit.enabled ? (
            <button
              key={i}
              type="button"
              onClick={() => setPip(i)}
              aria-label={`Set hero points to ${i + 1}`}
              className={`h-3.5 w-3.5 rounded-full border border-gold/60 transition-colors hover:border-gold ${i < value ? 'bg-gold' : 'bg-transparent hover:bg-gold/30'}`}
            />
          ) : (
            <span
              key={i}
              className={`inline-block h-3 w-3 rounded-full border border-gold/60 ${i < value ? 'bg-gold' : 'bg-transparent'}`}
            />
          ),
        )}
      </div>
    </div>
  );
}

// ---- Conditions + resistances ----------------------------------

/** Conditions block for the right sidebar (dying/wounded steppers in edit mode). */
function ConditionsBlock({
  character,
  edit,
}: {
  character: CharacterRow;
  edit: EditControls;
}) {
  const webConditions = character.overlay?.web_edits?.conditions ?? [];

  // Transform the web-owned conditions list inside an overlay mutator: the
  // transform runs against the FRESHEST overlay (not this render's stale prop),
  // so concurrent bot writes and rapid edits both survive. Only web_edits is
  // touched; the rest of the overlay is preserved.
  const transformConditions = (fn: (conds: ActiveCondition[]) => ActiveCondition[]) =>
    edit.updateOverlay((o) => ({
      ...o,
      web_edits: { ...(o.web_edits ?? {}), conditions: fn(o.web_edits?.conditions ?? []) },
    }));
  const without = (conds: ActiveCondition[], name: string) =>
    conds.filter((c) => c.name.toLowerCase() !== name.toLowerCase());
  const addCondition = (name: string) =>
    transformConditions((conds) =>
      conds.some((c) => c.name.toLowerCase() === name.toLowerCase())
        ? conds
        : [...conds, isValuedCondition(name) ? { name, value: 1 } : { name }],
    );
  const removeCondition = (name: string) => transformConditions((conds) => without(conds, name));
  const setConditionValue = (name: string, value: number) =>
    transformConditions((conds) =>
      value <= 0 ? without(conds, name) : [...without(conds, name), { name, value }],
    );

  if (!edit.enabled) {
    const active = renderConditions(character, webConditions);
    return (
      <FramedBlock title="Conditions">
        <p className="text-sm text-silver/85">{active.join(' · ') || '—'}</p>
      </FramedBlock>
    );
  }

  const available = PF2E_CONDITIONS.filter(
    (d) => !webConditions.some((c) => c.name.toLowerCase() === d.name.toLowerCase()),
  );

  return (
    <FramedBlock title="Conditions">
      <div className="space-y-2">
        <ConditionStepper
          label="Dying"
          value={character.dying ?? 0}
          max={4}
          onChange={(n) => edit.update({ dying: n })}
        />
        <ConditionStepper
          label="Wounded"
          value={character.wounded ?? 0}
          max={4}
          onChange={(n) => edit.update({ wounded: n })}
        />
        {webConditions.map((c) => {
          const def = conditionDef(c.name);
          return def?.valued ? (
            <ConditionStepper
              key={c.name}
              label={c.name}
              value={c.value ?? 1}
              max={6}
              title={def.summary}
              onChange={(n) => setConditionValue(c.name, n)}
            />
          ) : (
            <ConditionChip
              key={c.name}
              label={c.name}
              title={def?.summary}
              onRemove={() => removeCondition(c.name)}
            />
          );
        })}
        <AddConditionSelect available={available} onAdd={addCondition} />
      </div>
    </FramedBlock>
  );
}

/**
 * Editable view of the bot's custom counters (`overlay.counters`). We only let
 * players adjust each counter's CURRENT value (clamped to its max) — the bot
 * owns the definitions. Writes to the real overlay, so they sync to the bot.
 */
function CountersBlock({
  character,
  edit,
}: {
  character: CharacterRow;
  edit: EditControls;
}) {
  const counters = character.overlay?.counters ?? {};
  const entries = Object.entries(counters).filter(([, v]) => v && (v.max ?? 0) > 0);
  if (entries.length === 0) return null;

  // Adjust by a delta computed against the FRESHEST counter value inside the
  // mutator, so rapid taps compose and a concurrent bot write isn't clobbered.
  const changeCurrent = (key: string, delta: number) =>
    edit.updateOverlay((o) => {
      const all = o.counters ?? {};
      const c = all[key];
      if (!c) return o;
      const clamped = Math.max(0, Math.min(c.max ?? 0, (c.current ?? 0) + delta));
      return { ...o, counters: { ...all, [key]: { ...c, current: clamped } } };
    });

  return (
    <FramedBlock title="Counters">
      <div className="space-y-2">
        {entries.map(([key, v]) => {
          const label = v.label || key.toUpperCase();
          const current = v.current ?? 0;
          const max = v.max ?? 0;
          return (
            <div key={key} className="flex items-center justify-between gap-2">
              <span className="text-xs text-silver/80">
                {label}{' '}
                <span className="tabular-nums text-silver/60">
                  {current}/{max}
                </span>
              </span>
              {edit.enabled && (
                <span className="flex items-center gap-1">
                  <StepBtn label="−" onClick={() => changeCurrent(key, -1)} />
                  <StepBtn label="+" onClick={() => changeCurrent(key, 1)} />
                </span>
              )}
            </div>
          );
        })}
      </div>
    </FramedBlock>
  );
}

function ConditionStepper({
  label,
  value,
  max,
  onChange,
  title,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (n: number) => void;
  title?: string;
}) {
  const clamp = (n: number) => Math.max(0, Math.min(n, max));
  return (
    <div className="flex items-center justify-between gap-2">
      <span
        className={`text-xs ${value > 0 ? 'text-red-300' : 'text-silver/70'}`}
        title={title}
      >
        {label} {value}
      </span>
      <span className="flex items-center gap-1">
        <StepBtn label="−" onClick={() => onChange(clamp(value - 1))} />
        <StepBtn label="+" onClick={() => onChange(clamp(value + 1))} />
      </span>
    </div>
  );
}

/** A boolean (non-valued) active condition with a remove control. */
function ConditionChip({
  label,
  title,
  onRemove,
}: {
  label: string;
  title?: string;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-red-300" title={title}>
        {label}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        title="Remove condition"
        className="text-silver/40 hover:text-red-300"
      >
        ×
      </button>
    </div>
  );
}

function AddConditionSelect({
  available,
  onAdd,
}: {
  available: ConditionDef[];
  onAdd: (name: string) => void;
}) {
  if (available.length === 0) return null;
  return (
    <select
      value=""
      onChange={(e) => {
        if (e.target.value) onAdd(e.target.value);
      }}
      className="w-full rounded border border-gold/30 bg-midnight-800/80 px-2 py-1 text-xs text-silver/80 focus:border-gold/60 focus:outline-none"
    >
      <option value="">+ Add condition…</option>
      {available.map((d) => (
        <option key={d.name} value={d.name}>
          {d.name}
        </option>
      ))}
    </select>
  );
}

function renderConditions(c: CharacterRow, web: ActiveCondition[]): string[] {
  const out: string[] = [];
  if ((c.dying ?? 0) > 0) out.push(`Dying ${c.dying}`);
  if ((c.wounded ?? 0) > 0) out.push(`Wounded ${c.wounded}`);
  for (const cond of web) {
    out.push(cond.value != null ? `${cond.name} ${cond.value}` : cond.name);
  }
  if (c.status) out.push(c.status);
  return out;
}

// ---- Skills panel ----------------------------------------------

function SkillsPanel({ build }: { build: PathbuilderBuild }) {
  return (
    <Panel title="Skills">
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-1.5 text-sm">
        <div className="text-[0.6rem] uppercase tracking-widest text-gold/70">Skill</div>
        <div className="text-[0.6rem] uppercase tracking-widest text-gold/70">Total</div>
        <div className="text-[0.6rem] uppercase tracking-widest text-gold/70">Rank</div>
        <div className="text-[0.6rem] uppercase tracking-widest text-gold/70">Ability</div>
        {SKILL_ORDER.map((s) => {
          const rank = build.proficiencies?.[s];
          const trained = (rank ?? 0) > 0;
          const bonus = skillBonus(build, s);
          const ab = SKILL_ABILITY[s] as Ability;
          const abMod = abilityMod(build.abilities?.[ab]);
          return (
            <RowContents key={s} dim={!trained}>
              <span className="flex items-center gap-1.5 capitalize">
                <BookIcon className="text-xs text-gold/50" />
                {s}
              </span>
              <span className="tabular-nums text-arcane">{fmtMod(bonus)}</span>
              <span className="text-xs text-silver/60">{profLabel(rank)}</span>
              <span className="text-xs uppercase tracking-wider text-silver/60 tabular-nums">
                {fmtMod(abMod)}
              </span>
            </RowContents>
          );
        })}
      </div>
      {build.lores && build.lores.length > 0 && (
        <>
          <div className="mt-3 border-t border-gold/15 pt-2 text-[0.6rem] uppercase tracking-widest text-gold/70">
            Additional Skills
          </div>
          <p className="mt-1 text-sm text-silver/80">
            {build.lores
              .map(([name, rank]) => `${name} ${fmtMod(loreBonus(build, rank))}`)
              .join(', ')}
          </p>
        </>
      )}
    </Panel>
  );
}

function loreBonus(build: PathbuilderBuild, rank: number): number {
  const int = abilityMod(build.abilities?.int);
  const level = build.level ?? 1;
  return rank > 0 ? int + rank + level : int;
}

/** Reusable "row of 4 cells" — pass exactly 4 children. */
function RowContents({ children, dim }: { children: ReactNode; dim?: boolean }) {
  const cls = dim ? 'opacity-50' : '';
  return (
    <>
      {Array.isArray(children) &&
        children.map((c, i) => (
          <div key={i} className={cls}>
            {c}
          </div>
        ))}
    </>
  );
}

// ---- Attacks & spellcasting -----------------------------------

function AttacksPanel({
  character,
  build,
  edit,
}: {
  character: CharacterRow;
  build: PathbuilderBuild;
  edit: EditControls;
}) {
  const weapons = mergeWeapons(build, character.overlay ?? null);
  const allSpells = collectSpellAttackRows(build);
  const { favorites, toggle } = useFavoriteSpells(character.char_key);

  // Pinned spells float to the very top and are always shown; the rest are
  // capped so a big spellbook doesn't bury the weapons. The pin toggle only
  // appears on your own editable sheet (it writes to this browser only).
  const pinned = allSpells.filter((s) => favorites.has(s.name));
  const rest = allSpells.filter((s) => !favorites.has(s.name)).slice(0, 10);
  const isEmpty = pinned.length + weapons.length + rest.length === 0;
  const onToggle = edit.enabled ? toggle : undefined;

  return (
    <Panel title="Attacks & Spellcasting">
      <div className="grid grid-cols-[auto_1fr_auto_auto] gap-x-3 gap-y-1.5 text-sm">
        <div />
        <div className="text-[0.6rem] uppercase tracking-widest text-gold/70">Name</div>
        <div className="text-[0.6rem] uppercase tracking-widest text-gold/70">Atk / Dmg / DC</div>
        <div className="text-[0.6rem] uppercase tracking-widest text-gold/70">Traits</div>
        {isEmpty && (
          <div className="col-span-4 py-3 text-center text-sm text-silver/40">—</div>
        )}
        {pinned.map((s, i) => (
          <SpellRow key={`p-${i}`} row={s} favorite onToggle={onToggle} />
        ))}
        {weapons.map((w, i) => (
          <WeaponRow key={`w-${i}`} w={w} />
        ))}
        {rest.map((s, i) => (
          <SpellRow key={`s-${i}`} row={s} favorite={false} onToggle={onToggle} />
        ))}
      </div>
    </Panel>
  );
}

function WeaponRow({ w }: { w: Weapon }) {
  return (
    <>
      <SwordIcon className="text-sm text-gold/70" />
      <span className="text-silver">{w.display || w.name}</span>
      <span className="text-arcane tabular-nums">
        {w.attack != null && `${fmtMod(w.attack)} `}
        <span className="text-silver/80">{weaponDamage(w)}</span>
      </span>
      <span className="text-xs text-silver/60">{w.prof ?? ''}</span>
    </>
  );
}

type SpellAttackRow = {
  kind: 'spell';
  name: string;
  attack: number;
  tradition: string;
  level: number;
};

function collectSpellAttackRows(build: PathbuilderBuild): SpellAttackRow[] {
  const casters = build.spellCasters ?? [];
  const rows: SpellAttackRow[] = [];
  for (const c of casters) {
    if (c.innate) continue;
    const attack = spellAttackTotal(build, c);
    for (const lvl of c.spells ?? []) {
      for (const name of lvl.list ?? []) {
        rows.push({
          kind: 'spell',
          name,
          attack,
          tradition: c.magicTradition,
          level: lvl.spellLevel,
        });
      }
    }
  }
  return rows;
}

function SpellRow({
  row,
  favorite,
  onToggle,
}: {
  row: SpellAttackRow;
  favorite: boolean;
  onToggle?: (name: string) => void;
}) {
  const tint = TRADITION_COLOR[row.tradition] ?? 'gold';
  return (
    <>
      {onToggle ? (
        <button
          type="button"
          onClick={() => onToggle(row.name)}
          title={favorite ? 'Unpin spell' : 'Pin spell to top'}
          className={`text-sm transition-colors ${
            favorite ? 'text-gold' : 'text-silver/45 hover:text-gold'
          }`}
        >
          <StarIcon />
        </button>
      ) : favorite ? (
        <StarIcon className="text-sm text-gold" />
      ) : (
        <span className={`text-sm text-${tint === 'gold' ? 'gold' : tint}/70`}>✦</span>
      )}
      <span className="text-silver">{row.name}</span>
      <span className="tabular-nums text-arcane">{fmtMod(row.attack)}</span>
      <span className="text-xs capitalize text-silver/60">
        {row.tradition} · L{row.level}
      </span>
    </>
  );
}

function spellAttackTotal(build: PathbuilderBuild, c: Spellcaster): number {
  const level = build.level ?? 1;
  const ab = abilityMod(build.abilities?.[c.ability]);
  const rank = c.proficiency ?? 0;
  return rank > 0 ? level + rank + ab : ab;
}



// ---------------------------------------------------------------
// Right column
// ---------------------------------------------------------------

function RightColumn({
  build,
  character,
  edit,
}: {
  build: PathbuilderBuild;
  character: CharacterRow;
  edit: EditControls;
}) {
  const cdc = classDC(build);
  const primaryCaster = (build.spellCasters ?? []).find((c) => !c.innate);
  const spellAttack = primaryCaster ? spellAttackTotal(build, primaryCaster) : undefined;
  // Resistances / weaknesses / immunities live in the Defenses box; the
  // center row no longer duplicates them. Initiative folded into the
  // Perception vitals card; Speed lives in the header (Movement box removed
  // to avoid showing speed twice).
  const defenses = defenseLine(build);
  const focusMax = focusPoolMax(build);
  return (
    <aside className="space-y-4">
      <MiniStat label="Class DC" value={cdc ?? '—'} />
      <MiniStat label="Spell Attack" value={spellAttack != null ? fmtMod(spellAttack) : '—'} />
      {focusMax > 0 && <FocusPool max={focusMax} character={character} edit={edit} />}
      <ConditionsBlock character={character} edit={edit} />
      <CountersBlock character={character} edit={edit} />
      <FramedBlock title="Defenses">
        {defenses.length > 0 ? (
          <ul className="space-y-1 text-sm text-silver/85">
            {defenses.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-silver/40">—</p>
        )}
      </FramedBlock>
      <FramedBlock title="Specials">
        <p className="text-sm text-silver/40">—</p>
      </FramedBlock>
      <DiceRoller />
    </aside>
  );
}

/**
 * Focus-pool tracker for casters. Reads/writes `overlay.daily.focus_spent`
 * (bot-synced) via read-modify-write. Pips show remaining points; clicking one
 * sets the remaining count (clicking the current top pip spends one). A
 * "Refocus" link restores the pool to full.
 */
function FocusPool({
  max,
  character,
  edit,
}: {
  max: number;
  character: CharacterRow;
  edit: EditControls;
}) {
  const spent = Math.max(0, Math.min(max, character.overlay?.daily?.focus_spent ?? 0));
  const current = max - spent;

  const setSpent = (nextSpent: number) =>
    edit.updateOverlay((o) => ({
      ...o,
      daily: { ...(o.daily ?? {}), focus_spent: Math.max(0, Math.min(max, nextSpent)) },
    }));

  // Clicking pip i sets remaining to i+1; clicking the current top pip spends
  // one. Resolve the toggle against the freshest overlay so a re-tap works off
  // the real value, not this render's stale prop.
  const setPip = (i: number) =>
    edit.updateOverlay((o) => {
      const curSpent = Math.max(0, Math.min(max, o.daily?.focus_spent ?? 0));
      const curCurrent = max - curSpent;
      const nextCurrent = curCurrent === i + 1 ? i : i + 1;
      return {
        ...o,
        daily: { ...(o.daily ?? {}), focus_spent: Math.max(0, Math.min(max, max - nextCurrent)) },
      };
    });

  return (
    <div className="relative rounded-md border border-arcane/30 bg-midnight-900/60 px-3 py-3 text-center">
      <div className="text-[0.65rem] font-display uppercase tracking-widest text-arcane/90">
        Focus Pool
      </div>
      <div className="mt-2 flex items-center justify-center gap-1.5">
        {Array.from({ length: max }, (_, i) =>
          edit.enabled ? (
            <button
              key={i}
              type="button"
              onClick={() => setPip(i)}
              aria-label={`Set focus points to ${i + 1}`}
              className={`h-3.5 w-3.5 rounded-full border border-arcane/60 transition-colors hover:border-arcane ${
                i < current ? 'bg-arcane' : 'bg-transparent hover:bg-arcane/30'
              }`}
            />
          ) : (
            <span
              key={i}
              className={`inline-block h-3 w-3 rounded-full border border-arcane/60 ${
                i < current ? 'bg-arcane' : 'bg-transparent'
              }`}
            />
          ),
        )}
      </div>
      <div className="mt-1.5 text-[0.6rem] uppercase tracking-widest text-silver/50">
        {current} / {max}
      </div>
      {edit.enabled && spent > 0 && (
        <button
          type="button"
          onClick={() => setSpent(0)}
          className="mt-1 text-[0.6rem] uppercase tracking-widest text-arcane hover:text-arcane-soft"
        >
          Refocus
        </button>
      )}
    </div>
  );
}

function MiniStat({
  label,
  value,
  icon,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border border-gold/20 bg-midnight-900/60 px-3 py-2">
      <span className="flex items-center gap-1.5 text-[0.65rem] uppercase tracking-widest text-gold/80">
        {icon && <span className="text-sm">{icon}</span>}
        {label}
      </span>
      <span className="font-display text-gold">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------
// Bottom tab bar
// ---------------------------------------------------------------

function TabBar({
  activeTab,
  onSelect,
  readOnly = false,
}: {
  activeTab: TabId;
  onSelect: (id: TabId) => void;
  readOnly?: boolean;
}) {
  // On public share views the Journal tab is hidden since it can contain
  // private notes and the bot's XP log with awarder Discord IDs.
  const visibleTabs = readOnly
    ? TAB_DEFINITIONS.filter((t) => t.id !== 'journal')
    : TAB_DEFINITIONS;

  return (
    <nav
      role="tablist"
      aria-label="Character sheet sections"
      className="flex items-center justify-between gap-4 rounded-lg border border-gold/25 bg-midnight-900/60 px-4 py-3 shadow-gilded"
    >
      <div className="flex flex-1 flex-wrap items-center gap-2 sm:gap-4">
        {visibleTabs.map((t) => {
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onSelect(t.id)}
              className={`group relative inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs uppercase tracking-widest transition-colors ${
                isActive
                  ? 'text-gold'
                  : 'text-silver/60 hover:bg-midnight-800/50 hover:text-gold/80'
              }`}
            >
              <t.icon className="text-base" />
              <span className="font-display">{t.label}</span>
              {isActive && (
                <span
                  className="absolute inset-x-2 -bottom-0.5 h-px bg-gold/70"
                  aria-hidden
                />
              )}
            </button>
          );
        })}
      </div>
      <CompassIcon className="text-xl text-gold/50" />
    </nav>
  );
}

// ---------------------------------------------------------------
// Shared decorations
// ---------------------------------------------------------------

export function Panel({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="relative rounded-md border border-gold/20 bg-midnight-900/50 p-3">
      <CornerAccents />
      <h2 className="mb-2 flex items-center gap-1.5 border-b border-gold/15 pb-1.5 font-display text-sm uppercase tracking-widest text-gold">
        {icon && <span>{icon}</span>}
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Four gilded L-brackets at each panel corner — approximates the ornate frames. */
export function CornerAccents() {
  const size = 'h-2.5 w-2.5';
  return (
    <>
      <span className={`pointer-events-none absolute left-0.5 top-0.5 ${size} border-l border-t border-gold/70`} aria-hidden />
      <span className={`pointer-events-none absolute right-0.5 top-0.5 ${size} border-r border-t border-gold/70`} aria-hidden />
      <span className={`pointer-events-none absolute bottom-0.5 left-0.5 ${size} border-b border-l border-gold/70`} aria-hidden />
      <span className={`pointer-events-none absolute bottom-0.5 right-0.5 ${size} border-b border-r border-gold/70`} aria-hidden />
    </>
  );
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

function initials(name: string | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (first + last).toUpperCase() || '?';
}

