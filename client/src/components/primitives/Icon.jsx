/**
 * Icon — FitLife's own 24px line-icon set.
 *
 * Drawn in the same hand as the AI orb's spark: 1.8px stroke, round caps,
 * currentColor. Emoji used to do this job (🏃 💊 🔬 as section icons); they
 * render as whatever glyph the phone's font supplies, differ between Android
 * skins, and read as chat, not chrome. These are ours and identical everywhere.
 *
 *   <Icon name="flame" />            20px, inherits text colour
 *   <Icon name="mic" size={24} />
 *
 * Add an icon: one entry in PATHS, drawn on a 24×24 grid. Keep it to lines —
 * no fills — so it sits with the rest. Unknown names render nothing and warn
 * in development, so a typo cannot ship as an empty square silently.
 */

const PATHS = {
  // ── logging ─────────────────────────────────────────────────────────────
  scale:    'M12 3v18M5 12h14M7 8l-3 6a4 4 0 0 0 6 0l-3-6zM17 8l-3 6a4 4 0 0 0 6 0l-3-6z',
  flame:    'M12 21c3.6 0 6-2.5 6-6 0-3.2-2.6-5.6-3.8-8.2-.4-.8-.6-1.6-.6-2.8-2.6 1.2-3.4 3.6-3.2 5.6-1-.5-1.6-1.4-1.9-2.6C7 9.2 6 11.4 6 15c0 3.5 2.4 6 6 6zM12 21c-1.7 0-3-1.3-3-3 0-1.5.9-2.4 1.5-3.5.7 1 2.5 1.5 2.5 3.5 0 1.7-1.3 3-1 3z',
  drop:     'M12 3s-6 6.8-6 11a6 6 0 0 0 12 0c0-4.2-6-11-6-11z',
  moon:     'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  dumbbell: 'M6 8v8M18 8v8M3 10v4M21 10v4M6 12h12M4.5 9.5h1.5M18 9.5h1.5M4.5 14.5h1.5M18 14.5h1.5',
  run:      'M14 5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM5 21l4-6 3 2 2-4-3-2-2 3-3-1M17 21l-3-6 2-4 3 2 3-1',
  food:     'M4 12h16a8 8 0 0 1-16 0zM12 3v3M9 5l1 1M15 5l-1 1',
  water:    'M7 4h10l-1 16H8L7 4zM8 9h8',
  sun:      'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5',
  pill:     'M8.5 3.5l12 12a4.24 4.24 0 0 1-6 6l-12-12a4.24 4.24 0 0 1 6-6zM8.5 15.5l7-7',
  trend:    'M3 17l6-6 4 4 8-8M15 7h6v6',
  chart:    'M4 20V10M10 20V4M16 20v-7M22 20H2',
  // ── input ────────────────────────────────────────────────────────────────
  mic:      'M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zM6 11a6 6 0 0 0 12 0M12 17v4M9 21h6',
  camera:   'M4 8h3l2-3h6l2 3h3v11H4V8zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  barcode:  'M4 6v12M8 6v12M11 6v12M14 6v12M17 6v12M20 6v12',
  spark:    'M12 3.5l1.7 5 5 1.7-5 1.7-1.7 5-1.7-5-5-1.7 5-1.7 1.7-5zM18.5 4v3M20 5.5h-3',
  send:     'M4 12l16-8-4 16-4-6-8-2z',
  chat:     'M4 5h16v11H9l-5 4V5z',
  note:     'M6 3h9l4 4v14H6V3zM14 3v5h5M9 13h6M9 17h6',
  search:   'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  // ── people / system ─────────────────────────────────────────────────────
  user:     'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 20a7 7 0 0 1 14 0',
  users:    'M9 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 20a6 6 0 0 1 12 0M16 11a3 3 0 1 0 0-6M21 20a5 5 0 0 0-4-4.9',
  bell:     'M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2zM10 20a2 2 0 0 0 4 0',
  gear:     'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-1.5-3.5-2.3.4-1.6-1.6.4-2.3L12.5 2 11 4l-2.3-.4-1.6 1.6.4 2.3L4 8.5 5 12l-2 1 1.5 3.5 2.3-.4 1.6 1.6-.4 2.3 3.5 1.5 1.5-2 2.3.4 1.6-1.6-.4-2.3 3.5-1.5z',
  home:     'M4 11l8-7 8 7v9h-5v-6h-6v6H4v-9z',
  calendar: 'M4 6h16v14H4V6zM4 10h16M8 3v4M16 3v4',
  clock:    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  phone:    'M7 3h4l2 5-2.5 1.5a11 11 0 0 0 5 5L17 12l5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 5 5a2 2 0 0 1 2-2z',
  message:  'M4 5h16v11h-8l-4 3v-3H4V5zM8 9h8M8 12h5',
  // ── status / navigation ─────────────────────────────────────────────────
  check:    'M5 12.5l4.5 4.5L19 7',
  plus:     'M12 5v14M5 12h14',
  minus:    'M5 12h14',
  close:    'M6 6l12 12M18 6L6 18',
  warning:  'M12 3l10 18H2L12 3zM12 10v4M12 17.5v.5',
  info:     'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8v.5',
  'chevron-right': 'M9 5l7 7-7 7',
  'chevron-left':  'M15 5l-7 7 7 7',
  'chevron-down':  'M5 9l7 7 7-7',
  'chevron-up':    'M5 15l7-7 7 7',
  'arrow-right':   'M4 12h16M13 5l7 7-7 7',
  'arrow-left':    'M20 12H4M11 5l-7 7 7 7',
  'arrow-up':      'M12 20V4M5 11l7-7 7 7',
  'arrow-down':    'M12 4v16M5 13l7 7 7-7',
  dots:     'M6 12h.01M12 12h.01M18 12h.01',
  external: 'M14 4h6v6M20 4l-9 9M18 13v7H4V6h7',
  refresh:  'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  logout:   'M10 4H5v16h5M14 8l4 4-4 4M18 12H9',
};

export const ICON_NAMES = Object.keys(PATHS);

export default function Icon({ name, size = 20, strokeWidth = 1.8, className = '', ...rest }) {
  const d = PATHS[name];
  if (!d) {
    if (import.meta.env.DEV) console.warn(`Icon: unknown name "${name}"`);
    return null;
  }
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false" className={className} {...rest}>
      <path d={d} />
    </svg>
  );
}
