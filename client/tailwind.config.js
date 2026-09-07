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
        tiny:      '9px',     // badge counters, AUTO tags
        eyebrow:   '10px',    // uppercase section eyebrows, hints under tiles
        caption:   '11px',    // secondary labels
        micro:     '11.5px',  // tile sub-labels
        note:      '12px',    // dense body copy in cards
        'body-sm': '13px',
        body:      '15px',
        'num-sm':  '20px',    // tile numerals
        num:       '26px',    // hero numerals
        'num-lg':  '30px',
      },

      colors: {
        // ── Surfaces ──────────────────────────────────────────────────────
        charcoal:        '#121316',   // page background — the brand black
        'charcoal-deep': '#060609',   // bottom stop of header gradients
        surface:         '#1A1C20',   // cards, sheets, nav
        input:           '#1f1f26',   // form fields

        // ── Text greys, brightest to darkest ─────────────────────────────
        // (text-white is the top of the scale — no separate `hi` token, one
        // name per colour.)
        bright: '#ededf0',
        soft:   '#d8d8de',
        mid:    '#9EA3B0',   // secondary copy
        mute:   '#8C93A3',   // tile sub-labels
        lo:     '#7E8596',   // tertiary / placeholder
        faint:  '#6a6a78',
        dim:    '#5a5a68',
        ghost:  '#4A4E5A',   // disabled, hairline text

        // ── Brand gold ────────────────────────────────────────────────────
        gold:         '#D4AF37',   // the ONE accent. Primary buttons, active state.
        'gold-light': '#F0E2B6',   // gold text on dark, highlight stop
        'gold-deep':  '#C5A059',   // pressed / hover gold, secondary gold text
        'gold-dark':  '#8C6D37',   // shadow stop of the orb gradient

        // ── Status ────────────────────────────────────────────────────────
        // Semantic, not decorative. Green means "on target", amber "watch",
        // red "off". These are Tailwind's 400 shades so existing amber-400 /
        // red-400 / blue-400 classes are the same colour by definition.
        ok:        '#34d399',
        'ok-deep': '#10b981',
        warn:      '#fbbf24',
        danger:    '#f87171',
        info:      '#60a5fa',

        // ── Hairlines ─────────────────────────────────────────────────────
        // rgba strings, so `/opacity` modifiers do not apply — these ARE the
        // opacities. Use for border-* and divide-*.
        hair:       'rgba(255,255,255,0.07)',
        'hair-med': 'rgba(255,255,255,0.11)',
        'hair-hi':  'rgba(255,255,255,0.18)',
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
        'sm':          '0 2px 8px rgba(0,0,0,0.45)',
        'lg':          '0 10px 40px rgba(0,0,0,0.65)',
        'card':        '0 0 0 1px rgba(255,255,255,0.07), 0 4px 24px rgba(0,0,0,0.55)',
        'card-raised': 'inset 0 1px 0 rgba(255,255,255,0.06), 0 0 0 1px rgba(255,255,255,0.07), 0 12px 32px rgba(0,0,0,0.6)',
        'float':       '0 8px 40px rgba(0,0,0,0.75)',
        'glow':        '0 0 24px rgba(124,92,252,0.20)',
        'glow-gold':   '0 0 22px rgba(212,175,106,0.25)',
      },
      letterSpacing: {
        'widest': '0.12em',
      },
    },
  },
  plugins: [],
};
