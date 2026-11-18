/**
 * themeColor — a theme token as a real colour string, for the places CSS
 * variables cannot reach: SVG presentation attributes (recharts stroke/fill,
 * gradient stops) and canvas drawing. Reads the live theme on every call, so a
 * chart rendered after a theme switch uses the new colours.
 *
 * Added 16 Oct 2026 when the brand moved from gold to green: charts were the
 * last places still writing '#D4AF37' by hand.
 */
const FALLBACK = { '--fit-accent': '183 215 194', '--fit-ink': '242 244 236', '--fit-mid': '173 189 177',
  '--fit-lo': '151 170 156', '--fit-line': '54 72 59', '--fit-surface': '28 34 32', '--fit-base': '20 24 23',
  '--fit-warn': '234 190 118', '--fit-danger': '247 160 152', '--fit-ok': '110 215 163', '--fit-info': '149 190 238' };

export function themeColor(token = '--fit-accent', alpha = 1) {
  let v = '';
  try { v = getComputedStyle(document.documentElement).getPropertyValue(token).trim(); } catch (_) {}
  const parts = (v || FALLBACK[token] || FALLBACK['--fit-accent']).split(/[\s,]+/).filter(Boolean).map(Number);
  const [r, g, b] = parts.length >= 3 && parts.every(Number.isFinite) ? parts : FALLBACK['--fit-accent'].split(' ').map(Number);
  return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
export const accent = (alpha = 1) => themeColor('--fit-accent', alpha);
