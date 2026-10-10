#!/usr/bin/env node
/**
 * sweep-classes.js — Sprint 0 class sweep, kept in the repo as an audit trail.
 *
 * Rewrites legacy Tailwind palette classes (`text-stone-400`, `bg-emerald-600`,
 * `text-[#7E8596]`, `text-[10px]`…) to the design tokens declared in
 * client/tailwind.config.js, using the table in class-map.json. Also rewrites
 * `bg-[rgba(212,175,55,0.10)]`-style arbitrary values to `bg-gold/10` where
 * the rgb triplet is a known token or Tailwind 400-shade — same colour, named.
 *
 * Whole-token replacement only: a class is matched when it is not glued to
 * another class character on either side, so `bg-white` never touches
 * `bg-white/[0.04]`, and `hover:bg-white/20` is left alone unless the map has
 * that exact key.
 *
 *   node sweep-classes.js          rewrite files in place, print a summary
 *   node sweep-classes.js --check  exit 1 if anything WOULD change (gate use)
 */
const fs   = require('fs');
const path = require('path');

const CLIENT = path.join(__dirname, '../../../client/src');
const MAP    = JSON.parse(fs.readFileSync(path.join(__dirname, 'class-map.json'), 'utf8'));
delete MAP._comment;
const CHECK  = process.argv.includes('--check');

// rgb triplet → token / Tailwind colour that renders identically
const RGB = {
  '212,175,55':  'gold',
  '248,113,113': 'red-400',
  '251,191,36':  'amber-400',
  '251,146,60':  'orange-400',
  '96,165,250':  'blue-400',
  '52,211,153':  'ok',
  '251,113,133': 'rose-400',
  '255,255,255': 'white',
};

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
// Not preceded by a class character (so `hover:` prefixed keys are matched via
// their own entries, never by the bare key) and not followed by one.
const LEAD  = '(?<![\\w:\\-\\[#./])';
const TRAIL = '(?![\\w\\-/\\[])';

// ONE combined pattern, longest key first, so a rewrite can never be rewritten
// again by a later rule in the same file (`bg-white/20` → `bg-white/10` must
// not then hit the `bg-white/10` rule).
const LEAD_ANY = '(?<![\\w\\-\\[#./])';
const keys = Object.keys(MAP).sort((a, b) => b.length - a.length);
const palette = keys.filter(k => !k.includes('['));
const arb     = keys.filter(k =>  k.includes('['));
const PALETTE_RE = new RegExp(LEAD + '(' + palette.map(esc).join('|') + ')' + TRAIL, 'g');
const ARB_RE     = new RegExp(LEAD_ANY + '(' + arb.map(esc).join('|') + ')' + TRAIL, 'g');

// `bg-[rgba(212,175,55,0.10)]` → `bg-gold/10`;  0.08 → `/[0.08]`
const RGBA = new RegExp(LEAD_ANY + '(bg|text|border|divide|from|to|via|ring)-\\[rgba\\((\\d+),(\\d+),(\\d+),\\s*([0-9.]+)\\)\\]' + TRAIL, 'g');
// `border-[#D4AF37]/30`, `border-t-[#D4AF37]`, `bg-[#121316]/90` → named token,
// alpha preserved verbatim. Any utility prefix (border-t, ring-offset…).
const HEX = { D4AF37: 'gold', '121316': 'charcoal', '8C6D37': 'gold-dark', '1A1C20': 'surface',
              F0E2B6: 'gold-light', C5A059: 'gold-deep', '7E8596': 'lo', '9EA3B0': 'mid', FFFFFF: 'white',
              // Sprint 12: the long tail of one-off greys, golds and backgrounds, each to
              // its nearest token BY ROLE. This is a deliberate visual consolidation, not
              // pixel-identical: fourteen greys become six.
              '4E4E5C': 'ghost', '9A9AA6': 'mid', '8E8E9A': 'mute', F2F1EE: 'white', E8E6E1: 'bright',
              A9B0BF: 'mid', '9A968E': 'mute', B6B6C2: 'mid', '3A3A46': 'ghost', '6E7480': 'lo', '9AA0AE': 'mid',
              '5A5A68': 'dim', '4A4E5A': 'ghost', '6A6A78': 'faint', D8D8DE: 'soft', EDEDF0: 'bright', '8C93A3': 'mute',
              E8CE7A: 'gold-light', E0C98A: 'gold-light', D4AF6A: 'gold', BF9A2E: 'gold-deep', B08D2F: 'gold-deep',
              C9B37E: 'gold-light', '8C7A46': 'gold-dark', '8A6A1E': 'gold-dark', C4924B: 'gold-deep', D9A66B: 'gold-deep',
              '131317': 'charcoal', '111116': 'charcoal', '0D0D11': 'charcoal', '17181C': 'surface', '16161C': 'surface',
              '1A1B1F': 'surface', '16171A': 'surface', '0D0B18': 'surface', '07060F': 'charcoal',
              E4572E: 'danger', D98A80: 'danger', '6E8F6B': 'ok', '00D49F': 'ok',
              '8B6DFF': 'gold-light', '6344E8': 'gold-dark', '9775FA': 'gold' };
// Brand colours that are NOT ours and stay as written (a WhatsApp button is WhatsApp green).
const HEX_KEEP = new Set(['25D366']);
const HEXA = new RegExp(LEAD_ANY + '([a-z]+(?:-[a-z]+)*)-\\[#([0-9A-Fa-f]{6})\\](/\\[?[0-9.]+\\]?)?' + TRAIL, 'g');

const alphaSuffix = (a) => {
  const pct = Math.round(parseFloat(a) * 1000) / 10;      // 0.035 → 3.5
  return Number.isInteger(pct) && pct % 5 === 0 ? '/' + pct : '/[' + a + ']';
};

const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.(jsx|js)$/.test(p)) files.push(p);
  }
})(CLIENT);

const tally = new Map();
let changedFiles = 0;
for (const f of files) {
  const before = fs.readFileSync(f, 'utf8');
  let after = before;
  for (const re of [PALETTE_RE, ARB_RE]) {
    after = after.replace(re, (m, key) => { tally.set(key, (tally.get(key) || 0) + 1); return MAP[key]; });
  }
  after = after.replace(RGBA, (m, util, r, g, b, a) => {
    const tok = RGB[`${r},${g},${b}`];
    if (!tok) return m;
    tally.set('rgba→' + tok, (tally.get('rgba→' + tok) || 0) + 1);
    return `${util}-${tok}${alphaSuffix(a)}`;
  });
  after = after.replace(HEXA, (m, util, hex, alpha) => {
    if (HEX_KEEP.has(hex.toUpperCase())) return m;
    const tok = HEX[hex.toUpperCase()] || HEX[hex];
    if (!tok) return m;
    tally.set('hex→' + tok, (tally.get('hex→' + tok) || 0) + 1);
    return `${util}-${tok}${alpha || ''}`;
  });
  if (after !== before) {
    changedFiles++;
    if (!CHECK) fs.writeFileSync(f, after);
    else console.log('would change ' + path.relative(CLIENT, f));
  }
}

const total = [...tally.values()].reduce((a, b) => a + b, 0);
console.log(`${CHECK ? 'would rewrite' : 'rewrote'} ${total} class tokens in ${changedFiles} files`);
for (const [k, v] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
if (CHECK && changedFiles) process.exit(1);
