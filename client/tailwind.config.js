/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Outfit', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        // Display serif — used sparingly for hero numerals & greetings only.
        // Keeps the rest of the UI on Outfit so this stays a deliberate accent,
        // not a wholesale typeface swap.
        display: ['Fraunces', 'ui-serif', 'Georgia', 'serif'],
      },
      colors: {
        // Reserved for achievement moments (streaks, compliance milestones,
        // "personal best" badges) — never used for primary actions or nav,
        // so it doesn't compete with the purple brand/action color.
        gold: {
          200: '#ecd9ad',
          300: '#e0c285',
          400: '#d4af6a',
          500: '#c2974f',
          600: '#a87c3a',
        },
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
        '4xl': '2rem',
      },
      boxShadow: {
        'card':       '0 0 0 1px rgba(255,255,255,0.07), 0 4px 24px rgba(0,0,0,0.55)',
        'card-raised':'inset 0 1px 0 rgba(255,255,255,0.06), 0 0 0 1px rgba(255,255,255,0.07), 0 12px 32px rgba(0,0,0,0.6)',
        'float':      '0 8px 40px rgba(0,0,0,0.75)',
        'glow':       '0 0 24px rgba(124,92,252,0.20)',
        'glow-gold':  '0 0 22px rgba(212,175,106,0.25)',
      },
      letterSpacing: {
        'widest': '0.12em',
      },
    },
  },
  plugins: [],
};
