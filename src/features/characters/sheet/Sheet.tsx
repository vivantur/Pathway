import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PORTRAIT_MIME_TYPES } from '@/features/characters/api';
import { errorMessage } from '@/features/characters/errorMessage';
import {
  useDeleteCharacter,
  useSetCharacterPublic,
  useUpdateFromPathbuilder,
} from '@/features/characters/useCharacterActions';
import { useCharacterRealtime, type RealtimeState } from '@/features/characters/useCharacterRealtime';
import { useUpdateCharacterState } from '@/features/characters/useUpdateCharacterState';
import { useFavoriteSpells } from '@/features/characters/useFavoriteSpells';
import type { CharacterStatePatch } from '@/features/characters/api';
import { usePortraitUpload } from '@/features/characters/usePortraitUpload';
import { computeSensesFromAncestry } from '@/features/characters/pf2eData/senses';
import { mergeWeapons } from '@/features/characters/weapons';
import type { CharacterOverlay, CharacterRow } from '@/features/characters/types';
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
import { TAB_DEFINITIONS, normalizeTabId, type TabId } from './tabs/tabDefs';
import {
  ABILITY_ORDER,
  SKILL_ORDER,
  SKILL_ABILITY,
  TRADITION_COLOR,
  abilityMod,
  acTotal,
  classDC,
  defenseLine,
  fmtMod,
  maxHp,
  perceptionBonus,
  profLabel,
  saveBonus,
  shieldBonus,
  skillBonus,
  sizeLabel,
  speed,
  weaponDamage,
  type Ability,
  type PathbuilderBuild,
  type Spellcaster,
  type Weapon,
} from '@/features/characters/pathbuilder';
import {
  BookIcon,
  BrainIcon,
  CameraIcon,
  CompassIcon,
  CopyIcon,
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
  const edit: EditControls = {
    enabled: !readOnly,
    update: (patch) => stateMutation.mutate(patch),
    isPending: stateMutation.isPending,
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
  update: (patch: CharacterStatePatch) => void;
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
      return <SpellsTab build={build} />;
    case 'companions':
      return <CompanionsTab build={build} />;
    case 'equipment':
      return <EquipmentTab character={character} build={build} />;
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
            <XpHeaderField
              xp={xp}
              target={xpTarget}
              onChange={(n) => edit.update({ experience: n })}
            />
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
        {!readOnly && <SheetActions character={character} />}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------
// Header actions — Update from Pathbuilder / Share / Delete
// ---------------------------------------------------------------

function SheetActions({ character }: { character: CharacterRow }) {
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const updateMutation = useUpdateFromPathbuilder();
  const deleteMutation = useDeleteCharacter();
  const publicMutation = useSetCharacterPublic(character.char_key);

  const hasPathbuilderId = typeof character.pathbuilder_id === 'number';

  const handleUpdate = () => {
    if (!hasPathbuilderId || character.pathbuilder_id == null) return;
    updateMutation.mutate({
      charKey: character.char_key,
      pathbuilderId: character.pathbuilder_id,
    });
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
          label={updateMutation.isPending ? 'Updating…' : 'Update'}
          onClick={handleUpdate}
          disabled={!hasPathbuilderId || updateMutation.isPending}
          title={
            hasPathbuilderId
              ? 'Re-fetch this character from Pathbuilder and refresh the build (HP / XP / hero points / notes / portrait preserved).'
              : 'No Pathbuilder ID on file for this character.'
          }
        />
        <HeaderButton
          icon={<ShareIcon />}
          label="Share"
          onClick={() => setShareOpen((v) => !v)}
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
        <p className="text-xs text-emerald-soft">Updated from Pathbuilder ✓</p>
      )}

      {shareOpen && (
        <SharePopup
          character={character}
          publicMutation={publicMutation}
          onClose={() => setShareOpen(false)}
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

/** Editable XP header field — commits on blur / Enter. */
function XpHeaderField({
  xp,
  target,
  onChange,
}: {
  xp: number;
  target: number;
  onChange: (n: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft != null) {
      const n = Number(draft);
      if (!Number.isNaN(n) && n !== xp) onChange(Math.max(0, n));
    }
    setDraft(null);
  };
  return (
    <div className="flex items-center gap-2">
      <div className="whitespace-nowrap text-[0.6rem] uppercase tracking-widest text-gold/70">
        Experience Points
      </div>
      <div className="flex flex-1 items-center gap-1 rounded-sm border border-gold/20 bg-midnight-800/80 px-3 py-1 font-serif text-silver">
        <input
          type="number"
          value={draft ?? String(xp)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          className="w-16 bg-transparent tabular-nums focus:outline-none"
        />
        <span className="text-silver/40">/ {target.toLocaleString()}</span>
      </div>
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
  // otherwise fall back to the ancestry+heritage senses lookup, preferring the
  // denormalized `ancestry_name`/`heritage_name` columns which stay accurate
  // even after Pathbuilder re-imports.
  const senses =
    overlay.pathway_bot_state?.edits?.senses ??
    computeSensesFromAncestry(
      character.ancestry_name ?? build.ancestry,
      character.heritage_name ?? build.heritage,
    );
  const languages =
    overlay.pathway_bot_state?.edits?.languages ?? build.languages ?? [];
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
      </FramedBlock>
      <FramedBlock title="Languages">
        <p className="text-sm text-silver/80">
          {languages.length ? languages.join(', ') : '—'}
        </p>
      </FramedBlock>
      <FramedBlock title="Perception" icon={<EyeIcon />}>
        <div className="font-display text-3xl text-gold">{fmtMod(perception)}</div>
        <div className="text-xs text-silver/60">
          {profLabel(build.proficiencies?.perception)} in Perception
        </div>
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
              src={art}
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
      <AcCard build={build} edit={edit} />
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
          <StepBtn label="−" onClick={() => setHp((current ?? 0) - 1)} />
          <StepBtn label="+" onClick={() => setHp((current ?? 0) + 1)} />
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
        <div className="mt-0.5 text-[0.55rem] uppercase tracking-widest text-silver/50">
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
    const next = value === i + 1 ? i : i + 1;
    edit.update({ hero_points: next });
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
  const counters = renderCounters(character.overlay ?? null);
  return (
    <FramedBlock title="Conditions">
      {edit.enabled ? (
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
          {counters.length > 0 && (
            <p className="text-xs text-silver/60">{counters.join(' · ')}</p>
          )}
        </div>
      ) : (
        <p className="text-sm text-silver/85">
          {[...renderConditions(character), ...counters].join(' · ') || '—'}
        </p>
      )}
    </FramedBlock>
  );
}

function ConditionStepper({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (n: number) => void;
}) {
  const clamp = (n: number) => Math.max(0, Math.min(n, max));
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={`text-xs ${value > 0 ? 'text-red-300' : 'text-silver/70'}`}>
        {label} {value}
      </span>
      <span className="flex items-center gap-1">
        <StepBtn label="−" onClick={() => onChange(clamp(value - 1))} />
        <StepBtn label="+" onClick={() => onChange(clamp(value + 1))} />
      </span>
    </div>
  );
}

function renderConditions(c: CharacterRow): string[] {
  const out: string[] = [];
  if ((c.dying ?? 0) > 0) out.push(`Dying ${c.dying}`);
  if ((c.wounded ?? 0) > 0) out.push(`Wounded ${c.wounded}`);
  if (c.status) out.push(c.status);
  return out;
}

function renderCounters(overlay: CharacterOverlay | null): string[] {
  if (!overlay?.counters) return [];
  return Object.entries(overlay.counters)
    .filter(([, v]) => v && (v.max ?? 0) > 0)
    .map(([k, v]) => `${v.label || k.toUpperCase()} ${v.current ?? 0}/${v.max ?? 0}`);
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
            favorite ? 'text-gold' : 'text-silver/25 hover:text-gold/70'
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
  return (
    <aside className="space-y-4">
      <MiniStat label="Class DC" value={cdc ?? '—'} />
      <MiniStat label="Spell Attack" value={spellAttack != null ? fmtMod(spellAttack) : '—'} />
      <ConditionsBlock character={character} edit={edit} />
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
    </aside>
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

