import type { SVGProps } from 'react';

/**
 * A small library of tasteful, on-theme line icons.
 *
 * Drawn as inline SVG so they inherit the surrounding text color and stay
 * crisp at any size. Names match what the icon represents in the spec's
 * decorative-elements vocabulary (compass rose, arcane circle, etc.).
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function withDefaults({ size = 24, ...props }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
    ...props,
  };
}

export function CompassIcon(props: IconProps) {
  return (
    <svg {...withDefaults(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3 L13.5 12 L12 21 L10.5 12 Z" fill="currentColor" opacity="0.4" />
      <path d="M3 12 L12 10.5 L21 12 L12 13.5 Z" fill="currentColor" opacity="0.4" />
    </svg>
  );
}

export function BookIcon(props: IconProps) {
  return (
    <svg {...withDefaults(props)}>
      <path d="M4 4h12a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3V4Z" />
      <path d="M4 4v13a3 3 0 0 0 3 3h12" />
      <path d="M8 8h7M8 12h7" />
    </svg>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <svg {...withDefaults(props)}>
      <path d="M12 3 4 6v6c0 4.5 3.4 7.7 8 9 4.6-1.3 8-4.5 8-9V6l-8-3Z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

export function SparklesIcon(props: IconProps) {
  return (
    <svg {...withDefaults(props)}>
      <path d="M12 3l1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3Z" />
      <path d="M19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z" />
    </svg>
  );
}

export function ScrollIcon(props: IconProps) {
  return (
    <svg {...withDefaults(props)}>
      <path d="M6 4h11a2 2 0 0 1 2 2v3M6 4a2 2 0 0 0-2 2v1a2 2 0 0 0 2 2h13M6 4v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-1a2 2 0 0 0-2-2H8" />
      <path d="M9 13h7M9 17h5" />
    </svg>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <svg {...withDefaults(props)}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <circle cx="17" cy="10" r="2.5" />
      <path d="M14.5 20c0-2.5 1.7-4.5 4-4.5s4 2 4 4.5" />
    </svg>
  );
}

export function DiscordIcon(props: IconProps) {
  return (
    <svg {...withDefaults({ ...props, fill: 'currentColor', stroke: 'none' })}>
      <path d="M19.27 5.33A18 18 0 0 0 14.91 4l-.2.39a16.6 16.6 0 0 1 5.27 1.7c-1.6-.86-3.36-1.42-5.18-1.66a13.7 13.7 0 0 0-5.6 0 17 17 0 0 0-5.27 1.7A18.6 18.6 0 0 0 .67 18.32a18.3 18.3 0 0 0 5.6 2.83s.74-.95 1.34-1.78a10.7 10.7 0 0 1-2.13-1.05c.18-.13.36-.27.53-.4a13 13 0 0 0 11.18 0c.18.14.35.28.53.41a10.7 10.7 0 0 1-2.13 1.05c.6.83 1.34 1.78 1.34 1.78a18.3 18.3 0 0 0 5.6-2.83 18.4 18.4 0 0 0-3.26-12.99Zm-11 9.83a2.05 2.05 0 0 1-1.9-2.16 2.04 2.04 0 0 1 1.9-2.15 2.02 2.02 0 0 1 1.9 2.15 2.04 2.04 0 0 1-1.9 2.16Zm6.99 0a2.05 2.05 0 0 1-1.9-2.16 2.04 2.04 0 0 1 1.9-2.15 2.04 2.04 0 0 1 1.9 2.15 2.05 2.05 0 0 1-1.9 2.16Z" />
    </svg>
  );
}

export function GithubIcon(props: IconProps) {
  return (
    <svg {...withDefaults({ ...props, fill: 'currentColor', stroke: 'none' })}>
      <path d="M12 2A10 10 0 0 0 8.84 21.5c.5.08.66-.22.66-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.9.83.1-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.1.39-2 1.03-2.7-.1-.26-.45-1.29.1-2.69 0 0 .84-.27 2.75 1.02a9.6 9.6 0 0 1 5 0c1.9-1.3 2.74-1.02 2.74-1.02.55 1.4.2 2.43.1 2.69.64.7 1.03 1.6 1.03 2.7 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.86v2.75c0 .27.16.58.67.48A10 10 0 0 0 12 2Z" />
    </svg>
  );
}

export function MailIcon(props: IconProps) {
  return (
    <svg {...withDefaults(props)}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 7 9-7" />
    </svg>
  );
}
