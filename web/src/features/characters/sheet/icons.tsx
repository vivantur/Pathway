import type { SVGProps } from 'react';

/**
 * Small stroke-based SVG icons used throughout the character sheet.
 * All render at 1em (`width="1em" height="1em"`) so callers control size
 * with `text-{size}` / `size-{n}` classes; color via `text-{color}`
 * (they inherit `currentColor`).
 */

type Icon = (props: SVGProps<SVGSVGElement>) => JSX.Element;

const base = {
  width: '1em',
  height: '1em',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** Pathway compass — 8-point star inside a circle. */
export const CompassIcon: Icon = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3v18M3 12h18M5.5 5.5l13 13M18.5 5.5l-13 13" />
  </svg>
);

export const HeartIcon: Icon = (p) => (
  <svg {...base} fill="currentColor" strokeWidth="0" {...p}>
    <path d="M12 20.5s-7-4.35-9.24-9.02c-1.6-3.32.31-7.48 4.02-7.48 2.2 0 3.8 1.2 5.22 2.9 1.42-1.7 3.02-2.9 5.22-2.9 3.7 0 5.61 4.16 4.02 7.48C19 16.15 12 20.5 12 20.5z" />
  </svg>
);

export const ShieldIcon: Icon = (p) => (
  <svg {...base} {...p}>
    <path d="M12 3l8 3v5c0 4.5-3.4 8.7-8 10-4.6-1.3-8-5.5-8-10V6l8-3z" />
    <path d="M9 12h6M12 9v6" />
  </svg>
);

export const ShieldPlusIcon: Icon = (p) => (
  <svg {...base} {...p}>
    <path d="M12 3l8 3v5c0 4.5-3.4 8.7-8 10-4.6-1.3-8-5.5-8-10V6l8-3z" />
    <path d="M9 12h6M12 9v6" />
  </svg>
);

export const RunningIcon: Icon = (p) => (
  <svg {...base} {...p}>
    <circle cx="15" cy="4" r="1.5" />
    <path d="M8 20l3-4-1-5 3-3 3 3 3 1M6 10l3-1 3 2M4 20l3-3" />
  </svg>
);

export const BrainIcon: Icon = (p) => (
  <svg {...base} {...p}>
    <path d="M12 4a3 3 0 0 0-3 3 3 3 0 0 0-3 3v1a3 3 0 0 0 1 5.5V19a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-2.5A3 3 0 0 0 18 11v-1a3 3 0 0 0-3-3 3 3 0 0 0-3-3z" />
    <path d="M12 4v17M9 9h.01M15 9h.01M9 14h.01M15 14h.01" />
  </svg>
);

export const EyeIcon: Icon = (p) => (
  <svg {...base} {...p}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="2.5" />
  </svg>
);

export const StarIcon: Icon = (p) => (
  <svg {...base} fill="currentColor" strokeWidth="0" {...p}>
    <path d="M12 2l3 6.9 7.5.8-5.6 5.1 1.6 7.3L12 18.4 5.5 22.1l1.6-7.3L1.5 9.7l7.5-.8z" />
  </svg>
);

export const HourglassIcon: Icon = (p) => (
  <svg {...base} {...p}>
    <path d="M6 3h12M6 21h12M7 3v3c0 2 5 4 5 6 0 2-5 4-5 6v3M17 3v3c0 2-5 4-5 6 0 2 5 4 5 6v3" />
  </svg>
);

export const CameraIcon: Icon = (p) => (
  <svg {...base} {...p}>
    <path d="M5 8h3l2-3h4l2 3h3v11H5z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);

export const SwordIcon: Icon = (p) => (
  <svg {...base} {...p}>
    <path d="M14.5 3.5L20 3l-.5 5.5-9 9L6 15l-2.5 2.5 3 3L9 18l3 4.5 9-9z" />
  </svg>
);

export const BookIcon: Icon = (p) => (
  <svg {...base} {...p}>
    <path d="M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3V4z" />
    <path d="M4 17a3 3 0 0 1 3-3h11" />
  </svg>
);

export const PencilIcon: Icon = (p) => (
  <svg {...base} {...p}>
    <path d="M4 20h4l10-10-4-4L4 16z" />
    <path d="M14 6l4 4" />
  </svg>
);

export const ShareIcon: Icon = (p) => (
  <svg {...base} {...p}>
    <path d="M12 3v13M8 7l4-4 4 4" />
    <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
  </svg>
);

export const DotsIcon: Icon = (p) => (
  <svg {...base} {...p}>
    <circle cx="6" cy="12" r="1.25" fill="currentColor" />
    <circle cx="12" cy="12" r="1.25" fill="currentColor" />
    <circle cx="18" cy="12" r="1.25" fill="currentColor" />
  </svg>
);

export const DownloadIcon: Icon = (p) => (
  <svg {...base} {...p}>
    <path d="M12 3v13M8 12l4 4 4-4" />
    <path d="M5 19h14" />
  </svg>
);

export const PouchIcon: Icon = (p) => (
  <svg {...base} {...p}>
    <path d="M8 8l-3 3v6a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-6l-3-3" />
    <path d="M8 8V6a4 4 0 0 1 8 0v2" />
    <path d="M9 13h6" />
  </svg>
);

export const CoinsIcon: Icon = (p) => (
  <svg {...base} {...p}>
    <ellipse cx="8" cy="8" rx="6" ry="3" />
    <path d="M2 8v3c0 1.7 2.7 3 6 3s6-1.3 6-3V8" />
    <ellipse cx="16" cy="15" rx="6" ry="3" />
    <path d="M10 15v3c0 1.7 2.7 3 6 3s6-1.3 6-3v-3" />
  </svg>
);

export const NoteIcon: Icon = (p) => (
  <svg {...base} {...p}>
    <path d="M6 3h9l3 3v15H6z" />
    <path d="M15 3v3h3M9 12h6M9 16h6M9 8h3" />
  </svg>
);

export const CircleIcon: Icon = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="9" />
  </svg>
);

export const ArrowRightIcon: Icon = (p) => (
  <svg {...base} {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const TrashIcon: Icon = (p) => (
  <svg {...base} {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
  </svg>
);

export const RefreshIcon: Icon = (p) => (
  <svg {...base} {...p}>
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 4v4h-4M21 12a9 9 0 0 1-15 6.7L3 16M3 20v-4h4" />
  </svg>
);

export const CopyIcon: Icon = (p) => (
  <svg {...base} {...p}>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
  </svg>
);

/* --- Bottom tab-nav icons --- */

export const OverviewIcon: Icon = (p) => (
  <svg {...base} {...p}>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M4 10h16M4 15h16M10 4v16" />
  </svg>
);

export const AncestryIcon: Icon = (p) => (
  <svg {...base} {...p}>
    <path d="M12 2l4 6-4 3-4-3z" />
    <path d="M12 11v10M4 16l8-3 8 3" />
  </svg>
);

export const ClassIcon: Icon = (p) => (
  <svg {...base} {...p}>
    <path d="M12 2l2.5 5 5.5.8-4 3.9 1 5.5L12 15l-5 2.2 1-5.5L4 7.8l5.5-.8z" />
  </svg>
);

export const AbilitiesIcon: Icon = (p) => (
  <svg {...base} {...p}>
    <path d="M12 3v3M12 18v3M4.5 6.5l2 2M17.5 15.5l2 2M4.5 17.5l2-2M17.5 8.5l2-2M3 12h3M18 12h3" />
    <circle cx="12" cy="12" r="4" />
  </svg>
);

export const SkillsIcon: Icon = (p) => (
  <svg {...base} {...p}>
    <path d="M18 6L6 18M6 6h6v6M18 12v6h-6" />
  </svg>
);

export const FeatsIcon: Icon = (p) => (
  <svg {...base} {...p}>
    <path d="M17 3l4 4-8 8-4 1 1-4z" />
    <path d="M4 20l6-6M3 20h7" />
  </svg>
);

export const SpellsIcon: Icon = (p) => (
  <svg {...base} {...p}>
    <path d="M12 3v3M12 18v3M4.5 6.5l2 2M17.5 15.5l2 2M4.5 17.5l2-2M17.5 8.5l2-2M3 12h3M18 12h3" />
    <circle cx="12" cy="12" r="2.5" fill="currentColor" strokeWidth="0" />
  </svg>
);

export const EquipmentIcon: Icon = (p) => (
  <svg {...base} {...p}>
    <path d="M7 4h10l1 5H6zM6 9h12v11H6z" />
    <path d="M10 13h4" />
  </svg>
);

export const JournalIcon: Icon = (p) => (
  <svg {...base} {...p}>
    <path d="M6 4h11a2 2 0 0 1 2 2v14H8a2 2 0 0 1-2-2V4z" />
    <path d="M6 18a2 2 0 0 1 2-2h11M10 8h6M10 12h5" />
  </svg>
);

export const CompanionIcon: Icon = (p) => (
  <svg {...base} {...p}>
    <ellipse cx="12" cy="15" rx="4" ry="3.5" />
    <circle cx="6.5" cy="10" r="1.6" />
    <circle cx="17.5" cy="10" r="1.6" />
    <circle cx="9" cy="6" r="1.6" />
    <circle cx="15" cy="6" r="1.6" />
  </svg>
);

/** Faceted d20 — the dice roller. */
export const DiceIcon: Icon = (p) => (
  <svg {...base} {...p}>
    <path d="M12 2l8.5 5v10L12 22l-8.5-5V7z" />
    <path d="M12 2v20M3.5 7l8.5 5 8.5-5M3.5 17l8.5-5 8.5 5" />
  </svg>
);
