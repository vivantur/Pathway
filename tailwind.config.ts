import type { Config } from 'tailwindcss';

/**
 * Pathway design tokens — the "enchanted grimoire" palette from the
 * Master Vision Specification (PATHWAY_VISION.md → Colors / Visual Style).
 *
 * Primary surfaces are deep midnight blues, navy, charcoal and black.
 * Accents are gold, antique brass, emerald, arcane cyan and silver.
 * Fantasy enhances usability — contrast and readability come first.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Every palette color is backed by a CSS variable (RGB channel
        // triplet) defined in index.css. Dark values live in :root; a `.light`
        // root class overrides them for light mode. Components keep using the
        // same class names (bg-midnight-900, text-silver, …) — only the
        // underlying color flips.
        //
        // `ink` is the ONE fixed exception: dark text on gold buttons, which
        // must stay dark in BOTH themes, so it never swaps.
        ink: '#0b1026',
        midnight: {
          DEFAULT: 'rgb(var(--c-midnight) / <alpha-value>)',
          50: 'rgb(var(--c-midnight-50) / <alpha-value>)',
          100: 'rgb(var(--c-midnight-100) / <alpha-value>)',
          200: 'rgb(var(--c-midnight-200) / <alpha-value>)',
          300: 'rgb(var(--c-midnight-300) / <alpha-value>)',
          400: 'rgb(var(--c-midnight-400) / <alpha-value>)',
          500: 'rgb(var(--c-midnight-500) / <alpha-value>)',
          600: 'rgb(var(--c-midnight-600) / <alpha-value>)',
          700: 'rgb(var(--c-midnight-700) / <alpha-value>)',
          800: 'rgb(var(--c-midnight-800) / <alpha-value>)',
          900: 'rgb(var(--c-midnight-900) / <alpha-value>)',
          950: 'rgb(var(--c-midnight-950) / <alpha-value>)',
        },
        navy: 'rgb(var(--c-navy) / <alpha-value>)',
        charcoal: 'rgb(var(--c-charcoal) / <alpha-value>)',
        gold: {
          DEFAULT: 'rgb(var(--c-gold) / <alpha-value>)',
          soft: 'rgb(var(--c-gold-soft) / <alpha-value>)',
          deep: 'rgb(var(--c-gold-deep) / <alpha-value>)',
        },
        brass: 'rgb(var(--c-brass) / <alpha-value>)',
        emerald: {
          DEFAULT: 'rgb(var(--c-emerald) / <alpha-value>)',
          soft: 'rgb(var(--c-emerald-soft) / <alpha-value>)',
        },
        arcane: {
          DEFAULT: 'rgb(var(--c-arcane) / <alpha-value>)',
          soft: 'rgb(var(--c-arcane-soft) / <alpha-value>)',
        },
        silver: 'rgb(var(--c-silver) / <alpha-value>)',
      },
      fontFamily: {
        // Display: an engraved, grimoire feel. Body: highly readable serif.
        display: ['"Cinzel"', 'Georgia', 'serif'],
        serif: ['"EB Garamond"', 'Georgia', 'serif'],
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        arcane: '0 0 24px -4px rgba(57, 214, 232, 0.35)',
        gilded: '0 1px 0 0 rgba(212, 175, 55, 0.4), 0 8px 30px -12px rgba(0,0,0,0.7)',
      },
      backgroundImage: {
        'grimoire-radial':
          'radial-gradient(120% 120% at 50% -10%, rgba(47,58,92,0.55) 0%, rgba(11,16,38,0.0) 55%)',
        'gilded-rule':
          'linear-gradient(90deg, transparent, rgba(212,175,55,0.6) 20%, rgba(212,175,55,0.9) 50%, rgba(212,175,55,0.6) 80%, transparent)',
      },
      keyframes: {
        'rune-pulse': {
          '0%, 100%': { opacity: '0.45', filter: 'drop-shadow(0 0 2px rgba(57,214,232,0.4))' },
          '50%': { opacity: '1', filter: 'drop-shadow(0 0 8px rgba(57,214,232,0.8))' },
        },
      },
      animation: {
        'rune-pulse': 'rune-pulse 4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
