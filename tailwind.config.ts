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
        // Primary (surfaces)
        midnight: {
          DEFAULT: '#0b1026',
          50: '#e6e8f0',
          100: '#c2c7dd',
          200: '#9aa2c4',
          300: '#6f7aa6',
          400: '#4c587f',
          500: '#2f3a5c',
          600: '#1d2742',
          700: '#141c33',
          800: '#0b1026',
          900: '#070a1a',
          950: '#040611',
        },
        navy: '#10183a',
        charcoal: '#1a1d24',
        // Accents
        gold: {
          DEFAULT: '#d4af37',
          soft: '#e8cf7e',
          deep: '#a8842a',
        },
        brass: '#b08d57',
        emerald: {
          DEFAULT: '#2e8b6f',
          soft: '#5bbfa1',
        },
        arcane: {
          DEFAULT: '#39d6e8',
          soft: '#8be9f2',
        },
        silver: '#c9d1e0',
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
