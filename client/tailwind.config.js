/** @type {import('tailwindcss').Config} */
//
// Design tokens. Every colour, type size and shadow the app uses has a name
// here. The JSX says `bg-surface`, `text-lo`, `text-eyebrow` — never a hex,
// never a Tailwind palette shade like `stone-400` or `emerald-600`.
//
// WHY: until Sprint 0 the theme was a 346-line override layer in index.css
// that re-coloured Tailwind's LIGHT-theme classes to dark/gold. It only worked
// while the map was complete, hover variants needed !important, and any
// alpha variant (`bg-stone-50/60`) slipped through and rendered near-white on
// charcoal. Naming the tokens once here removes the whole class of bug.
// `test-layout-contracts` [8] fails if a stone/emerald class or a brand hex
// comes back.
//
// Naming rule: a colour name must never collide with a Tailwind utility
// suffix. `base` is out (`text-base` is a font size), `label` is out (used as
// a font size below). Adding a token? grep tailwind's utility list first.
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Outfit', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        // Display serif — hero numerals & greetings only. Everything else stays
        // on Outfit so this reads as a deliberate accent.
        display: ['Fraunces', 'ui-serif', 'Georgia', 'serif'],
      },

      // Type scale. Plain strings on purpose: a tuple would also set
      // line-height, and these replaced `text-[10px]`-style arbitrary values
      // that set font-size only. Same pixels, now with a name.
      fontSize: {
        'nav-label': '10px', // compact labels in the coach/admin dock
        tiny:      '9px',     // badge counters, AUTO tags
        eyebrow:   '11px',    // uppercase section eyebrows, hints under tiles
        caption:   '12px',    // secondary labels
        micro:     '11.5px',  // tile sub-labels
        note:      '12px',    // dense body copy in cards
        'body-sm': '13px',
        body:      '15px',
        'num-sm':  '20px',    // tile numerals
        num:       '26px',    // hero numerals
        'num-lg':  '30px',
      },

      colors: {
        'charcoal': 'rgb(var(--fit-base) / <alpha-value>)',
        'charcoal-deep': 'rgb(var(--fit-base) / <alpha-value>)',
        'surface': 'rgb(var(--fit-surface) / <alpha-value>)',
        'input': 'rgb(var(--fit-input) / <alpha-value>)',
        'white': 'rgb(var(--fit-ink) / <alpha-value>)',
        'bright': 'rgb(var(--fit-ink) / <alpha-value>)',
        'soft': 'rgb(var(--fit-soft) / <alpha-value>)',
        'mid': 'rgb(var(--fit-mid) / <alpha-value>)',
        'mute': 'rgb(var(--fit-mid) / <alpha-value>)',
        'lo': 'rgb(var(--fit-lo) / <alpha-value>)',
        'faint': 'rgb(var(--fit-lo) / <alpha-value>)',
        'dim': 'rgb(var(--fit-lo) / <alpha-value>)',
        'ghost': 'rgb(var(--fit-ghost) / <alpha-value>)',
        'gold': 'rgb(var(--fit-accent) / <alpha-value>)',
        'gold-light': 'rgb(var(--fit-accent) / <alpha-value>)',
        'gold-deep': 'rgb(var(--fit-accent) / <alpha-value>)',
        'gold-dark': 'rgb(var(--fit-accent) / <alpha-value>)',
        'ok': 'rgb(var(--fit-ok) / <alpha-value>)',
        'ok-deep': 'rgb(var(--fit-ok) / <alpha-value>)',
        'warn': 'rgb(var(--fit-warn) / <alpha-value>)',
        'danger': 'rgb(var(--fit-danger) / <alpha-value>)',
        'info': 'rgb(var(--fit-info) / <alpha-value>)',
        'carb': 'rgb(var(--fit-carb) / <alpha-value>)',
        'fat': 'rgb(var(--fit-fat) / <alpha-value>)',
        'hair': 'rgb(var(--fit-line) / <alpha-value>)',
        'hair-med': 'rgb(var(--fit-line) / <alpha-value>)',
        'hair-hi': 'rgb(var(--fit-line) / <alpha-value>)',
        'green': { 300: 'rgb(var(--fit-ok) / <alpha-value>)', 400: 'rgb(var(--fit-ok) / <alpha-value>)' },
        'emerald': { 300: 'rgb(var(--fit-ok) / <alpha-value>)', 400: 'rgb(var(--fit-ok) / <alpha-value>)' },
        'red': { 300: 'rgb(var(--fit-danger) / <alpha-value>)', 400: 'rgb(var(--fit-danger) / <alpha-value>)' },
        'amber': { 300: 'rgb(var(--fit-warn) / <alpha-value>)', 400: 'rgb(var(--fit-warn) / <alpha-value>)' },
        'orange': { 300: 'rgb(var(--fit-warn) / <alpha-value>)', 400: 'rgb(var(--fit-warn) / <alpha-value>)' },
        'blue': { 300: 'rgb(var(--fit-info) / <alpha-value>)', 400: 'rgb(var(--fit-info) / <alpha-value>)' },
      },

      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
        '4xl': '2rem',
      },
      boxShadow: {
        // sm / lg override Tailwind's defaults: the light-theme shadows were
        // invisible on charcoal, so index.css used to re-declare them. Now the
        // utility itself is dark-tuned.
        'sm':          '0 2px 8px rgba(0,0,0,0.06)',
        'lg':          '0 10px 40px rgba(0,0,0,0.65)',
        'card':        '0 0 0 1px rgba(255,255,255,0.07), 0 4px 24px rgba(0,0,0,0.55)',
        'card-raised': 'inset 0 1px 0 rgba(255,255,255,0.06), 0 0 0 1px rgba(255,255,255,0.07), 0 12px 32px rgba(0,0,0,0.6)',
        'float':       '0 16px 50px rgba(0,0,0,0.18)',
        'glow':        '0 0 24px rgba(124,92,252,0.20)',
        'glow-gold':   '0 0 22px rgb(var(--fit-accent) / 0.25)',
      },
      letterSpacing: {
        'widest': '0.12em',
      },
    },
  },
  plugins: [],
};
