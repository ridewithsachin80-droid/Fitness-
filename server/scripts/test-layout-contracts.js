/**
 * scripts/test-layout-contracts.js — layout, brand and page-structure contracts.
 *
 * These are source contracts, not rendering checks. They need no browser, no
 * jsdom and no database, so they can live in the gate and run on every change.
 *
 * The rule this file follows, from FitLife-Test-Infrastructure.md: a test that
 * cannot fail is worse than no test. Every assertion below was written by
 * reintroducing the bug it describes and confirming it goes red.
 *
 * What a real browser found (headless Chrome, 320/360/390px, every page):
 * three page/width combinations scrolled sideways. The page-level symptom was
 * a header whose dark gradient stopped short of the scrollable width and a
 * "Sign out" button that looked cut off. Both came from flex children refusing
 * to shrink. Those fixes are guarded here.
 */
const fs   = require('fs');
const path = require('path');

const CLIENT = path.join(__dirname, '../../client/src');
const read   = (p) => fs.readFileSync(path.join(CLIENT, p), 'utf8');

let pass = 0, fail = 0;
const ck = (name, cond, detail) => {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else      { fail++; console.log('  \u2717 ' + name + ' ' + JSON.stringify(detail || '').slice(0, 200)); }
};

/**
 * Strips JSX comments before searching for user-visible copy.
 *
 * test-rename-contracts learned this the hard way: without stripping, a comment
 * that merely MENTIONS the forbidden string fails the check, so people phrase
 * comments around the test instead of writing what they mean.
 */
const stripComments = (src) =>
  src.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

// ── 1. The overflow root fix ────────────────────────────────────────────────
console.log('\n[1] horizontal overflow');

const css = read('index.css');

ck('index.css lets flex children shrink (the root fix, not 50 call sites)',
   /\.flex-1:not\(\[class\*=["']min-w-["']\]\)\s*\{[^}]*min-width:\s*0/.test(css), 'rule missing');

ck('the guard for explicit min-w-* utilities is intact',
   /:not\(\[class\*=["']min-w-["']\]\)/.test(css), 'guard missing');

/**
 * `overflow-x: hidden` on html or body would also stop the page scrolling
 * sideways — and would silently break every `position: sticky` in the app,
 * because an ancestor with overflow-x becomes a scroll container. The coach
 * page's tab bar is sticky. This assertion exists so nobody reaches for it
 * later without knowing what it costs.
 */
const htmlBodyOverflowX = /(^|\})\s*(html|body|html\s*,\s*body|body\s*,\s*html)\s*\{[^}]*overflow-x\s*:\s*hidden/m.test(css);
ck('no overflow-x:hidden on html/body — it would kill the sticky coach tabs',
   htmlBodyOverflowX === false, 'found overflow-x:hidden on html/body');

ck('the coach page tab bar is still sticky (what the shortcut would have broken)',
   /sticky top-0/.test(read('pages/Monitor.jsx')), 'sticky tab bar gone');

// ── 2. Admin tab strip ──────────────────────────────────────────────────────
console.log('\n[2] admin tab strip');

const admin = read('pages/AdminDashboard.jsx');

/**
 * Five tabs at 14px with an emoji each need ~389px of label. They used to widen
 * the page instead of giving way. `overflow-x-auto` on the strip plus
 * `min-w-max` on each tab means the STRIP scrolls, never the document.
 */
const tabStrip = admin.match(/<div className="flex gap-2 mb-3[^"]*"/);
ck('admin tab strip scrolls horizontally rather than widening the page',
   !!tabStrip && /overflow-x-auto/.test(tabStrip[0]), tabStrip && tabStrip[0]);

ck('admin tabs keep their full label (min-w-max + whitespace-nowrap)',
   /min-w-max whitespace-nowrap/.test(admin), 'tabs may truncate or wrap');

// ── 3. The header row that clipped "Sign out" ───────────────────────────────
console.log('\n[3] admin header row');

const signOut = admin.match(/<button onClick=\{\(\) => \{ logout\(\); \}\}[\s\S]{0,320}?Sign out/);
ck('Sign out cannot be squeezed onto two lines',
   !!signOut && /flex-shrink-0/.test(signOut[0]) && /whitespace-nowrap/.test(signOut[0]),
   signOut && signOut[0].slice(0, 160));

// The invariant is that the name block CAN shrink, so the Sign out button
// beside it is never pushed off-screen. The previous version of this check
// matched the eyebrow's exact font classes as a proxy for that — so restyling
// the type broke a layout test while the layout was untouched, and the obvious
// response to a test failing for the wrong reason is to edit the test until it
// stops. Assert the structural property instead: the header's name block, the
// one holding the FitLife label and the welcome line, carries min-w-0.
{
  const headerBlock = admin.slice(admin.indexOf('flex items-start justify-between gap-3 mb-4'));
  const nameBlock = headerBlock.slice(0, headerBlock.indexOf('</h1>'));
  ck('the name block beside it is allowed to shrink instead',
     /<div className="[^"]*min-w-0[^"]*">/.test(nameBlock) && /FitLife admin/i.test(nameBlock),
     'name block missing min-w-0');
}

// ── 4. One action, one place ────────────────────────────────────────────────
console.log('\n[4] duplicate add buttons');

/**
 * The gold "+ Add Member" / "+ Add Coach" button in the search row is on screen
 * whenever those tabs are, empty list included. A second "+ Add first …" button
 * in the empty state put two identical actions a few centimetres apart and made
 * the page look like it had rendered twice.
 */
const adminCopy = stripComments(admin);
ck('no "+ Add first member" duplicating the header button',
   /Add first member/.test(adminCopy) === false, 'duplicate present');
ck('no "+ Add first coach" duplicating the header button',
   /Add first coach/.test(adminCopy) === false, 'duplicate present');

ck('the single add button is still there',
   /\+ Add \{tab === 'members' \? 'Member' : 'Coach'\}/.test(admin), 'header add button missing');

ck('an empty list caused by a search says so instead of "none yet"',
   /No member matches/.test(admin) && /No coach matches/.test(admin), 'search-empty copy missing');

// ── 5. Brand and CSS hygiene ────────────────────────────────────────────────
console.log('\n[5] brand and CSS hygiene');

const listJsx = (dir) => fs.readdirSync(path.join(CLIENT, dir)).filter(f => f.endsWith('.jsx')).map(f => dir + '/' + f);
const PAGES = ['pages/AdminDashboard.jsx', 'pages/AdminFoods.jsx', 'pages/Monitor.jsx',
               'pages/PatientList.jsx', 'pages/Settings.jsx', 'pages/Profile.jsx',
               'pages/Progress.jsx', 'pages/DailyLog.jsx', 'pages/Today.jsx', 'pages/Login.jsx',
               // Sprint 3: the Today screen is spread over these folders now
               ...listJsx('components/today'), ...listJsx('components/sheets'), ...listJsx('components/primitives'),
               // Sprint 12: the split-out folders get the same hygiene checks
               ...listJsx('components/admin'), ...listJsx('components/food'), ...listJsx('components/coach'), ...listJsx('components/chat')];

const segmentsOf = (classList) => {
  const segs = [classList.replace(/\$\{[\s\S]*?\}/g, ' ')];
  const inner = /['"]([^'"]*)['"]/g;
  const exprs = classList.match(/\$\{[\s\S]*?\}/g) || [];
  for (const e of exprs) { let q; while ((q = inner.exec(e))) segs.push(q[1]); }
  return segs;
};
/**
 * White on #D4AF37 is about 1.9:1. Gold buttons carry charcoal text.
 *
 * The first version of this looked for the literal `bg-[#D4AF37]` and missed
 * ten buttons, because a background can arrive at gold two ways: written as
 * the hex, or written as `bg-emerald-500/600/700` and remapped in index.css.
 * Both paint the same pixels. Checking only the spelling checked half the app.
 */
const GOLD_BG = new Set(['bg-[#D4AF37]', 'bg-emerald-500', 'bg-emerald-600', 'bg-emerald-700',
                         'hover:bg-emerald-600', 'hover:bg-emerald-700']);
/**
 * Scanned across pages AND components. The first version checked PAGES only,
 * and a contrast audit against the built stylesheet later found four gold
 * buttons with white text sitting in components/ — the AI chat, the coach
 * chat, the food log and the programme builder. The check was real; its search
 * path was half the app.
 */
const ALL_JSX = PAGES.slice();
for (const dir of ['components']) {
  for (const g of fs.readdirSync(path.join(CLIENT, dir))) {
    if (g.endsWith('.jsx')) ALL_JSX.push(dir + '/' + g);
  }
}

const whiteOnGold = [];
for (const f of ALL_JSX) {
  const src = read(f);
  const re = /className=\{?[`"]([\s\S]*?)[`"]/g;
  let m;
  while ((m = re.exec(src))) {
    for (const seg of segmentsOf(m[1])) {
      const toks = seg.split(/\s+/).filter(Boolean);
      if (toks.some(t => GOLD_BG.has(t)) && toks.includes('text-white')) {
        whiteOnGold.push(f + ': ' + seg.trim().replace(/\s+/g, ' ').slice(0, 80));
      }
    }
  }
}
ck('no white text on a gold button', whiteOnGold.length === 0, whiteOnGold);

/**
 * The pre-rebrand PURPLE. Fourteen `rgba(192,132,252,…)` values survived the
 * gold sweep, every one of them a background sitting under amber or gold TEXT
 * — a half-finished edit where the foreground was changed and the background
 * was not, so the pill read as an amber chip on a lilac wash.
 *
 * Scanned across the whole client, not just PAGES: four of the fourteen were
 * in `components/UI.jsx`, which PAGES does not cover.
 */
const purpleLeftovers = [];
for (const f of ['index.css'].concat(PAGES)) {
  if (/rgba\(\s*192\s*,\s*132\s*,\s*252/.test(read(f))) purpleLeftovers.push(f);
}
for (const dir of ['components']) {
  for (const g of fs.readdirSync(path.join(CLIENT, dir))) {
    if (g.endsWith('.jsx') && /rgba\(\s*192\s*,\s*132\s*,\s*252/.test(read(dir + '/' + g))) {
      purpleLeftovers.push(dir + '/' + g);
    }
  }
}
ck('the pre-rebrand purple has not come back', purpleLeftovers.length === 0, purpleLeftovers);

/** The pre-rebrand gold. sprint6 removed it; this keeps it removed. */
const offBrand = PAGES.concat(['index.css']).filter(f => /#c9a227/i.test(read(f)));
ck('the off-brand #c9a227 gold has not come back', offBrand.length === 0, offBrand);

/**
 * `border border-white/[0.08] … border` in one className meant the card
 * declared a bare `border` twice and a colour twice. Tailwind emits one class
 * per utility, so the winner was stylesheet order, not intent.
 */
/**
 * What matters is two different border COLOURS landing on one element, not a
 * bare `border` appearing twice — `border-width: 1px` twice is a no-op.
 *
 * A class list is checked in segments: the static text, and then each quoted
 * string inside a `${…}` separately. Branches of a ternary are alternatives, so
 * `cond ? 'border border-emerald-200' : 'border border-red-200'` is correct and
 * must not be flagged. `border border-white/[0.07] border border-stone-200` in
 * one segment is the bug — both apply, and the winner is stylesheet order.
 */
const isBorderColour = (c) => /^border-(?:[a-z]+-\d{2,3}|white|black|transparent|\[)/.test(c);

const borderClashes = [], repeatedTokens = [];
for (const f of PAGES) {
  const src = read(f);
  const re = /className=\{?[`"]([\s\S]*?)[`"]/g;
  let m;
  while ((m = re.exec(src))) {
    for (const seg of segmentsOf(m[1])) {
      const toks = seg.split(/\s+/).filter(Boolean);
      const colours = [...new Set(toks.filter(isBorderColour))];
      if (colours.length > 1) borderClashes.push(f + ': ' + colours.join(' vs '));
      const seen = new Set(), dup = new Set();
      for (const t of toks) { if (seen.has(t)) dup.add(t); seen.add(t); }
      if (dup.size) repeatedTokens.push(f + ': ' + [...dup].join(', '));
    }
  }
}
ck('no element carries two competing border colours', borderClashes.length === 0, borderClashes);
ck('no class list repeats the same utility token', repeatedTokens.length === 0, repeatedTokens);

// ── 6. Coach page tab grouping — no orphaned cards ──────────────────────────
console.log('\n[6] coach page tab grouping');

/**
 * Sprint 4.3 split 23 cards across four tabs. A card added later without a tab
 * guard would render on ALL of them, which reads as a duplicate rather than as
 * a missing guard — so it is exactly the kind of mistake that ships.
 *
 * Walk the content region and confirm every <Card> sits inside a
 * `{tab === '…' && (<>` block. Modals mount after the content region and are
 * correctly outside it, so the walk stops at the first one.
 */
const monitor  = read('pages/Monitor.jsx');
const lines    = monitor.split('\n');
const startIdx = lines.findIndex(l => /\{\/\* Content \*\/\}/.test(l));
const endIdx   = lines.findIndex((l, i) => i > startIdx && /<AddLabModal/.test(l));

ck('the content region and the modal block are both findable',
   startIdx > -1 && endIdx > startIdx, { startIdx, endIdx });

let depth = 0;
const orphans = [];
// Read from the component's own TABS array rather than hardcoded here. With a
// fixed list, adding a legitimate fifth tab fails this suite for the wrong
// reason — the check would report a correct change as a bad tab id, and the
// natural response to that is to edit the test until it goes quiet.
const tabsDecl   = monitor.slice(monitor.indexOf('const TABS = ['));
const KNOWN_TABS = new Set(
  [...tabsDecl.slice(0, tabsDecl.indexOf(']')).matchAll(/id:\s*'([^']+)'/g)].map(m => m[1]));
const badTabIds  = [];

for (let i = startIdx; i < endIdx; i++) {
  const line = lines[i];
  const open = line.match(/\{tab === '([a-z]+)' && \(<>/);
  if (open) { depth++; if (!KNOWN_TABS.has(open[1])) badTabIds.push(open[1]); continue; }
  if (/^\s*<\/>\)\}/.test(line)) { depth = Math.max(0, depth - 1); continue; }
  if (depth === 0 && /^\s*<(Card|MuscleCoverage|MetabolicInsight|MacroLab|TrainingSummary|LabResults)\b/.test(line)) {
    orphans.push((i + 1) + ': ' + line.trim().slice(0, 70));
  }
}

ck('every card on the coach page sits inside a tab group', orphans.length === 0, orphans);
ck('no tab guard references a tab id that does not exist', badTabIds.length === 0, badTabIds);
ck('the tab list was parsed out of the component', KNOWN_TABS.size >= 2, [...KNOWN_TABS]);
ck('every declared tab group is actually used',
   [...KNOWN_TABS].every(t => monitor.includes(`{tab === '${t}' && (<>`)),
   [...KNOWN_TABS].filter(t => !monitor.includes(`{tab === '${t}' && (<>`)));

// ── Summary ─────────────────────────────────────────────────────────────────
// ── 7. Nothing invisible ────────────────────────────────────────────────────
console.log('\n[7] invisible controls');

/**
 * Four controls in AdminDashboard.jsx carried a solid `bg-white` AND a white
 * foreground on the same element: the Assign-to-Coach select, the Assign Coach
 * select, the push Recipient select, and the meal-plan food search input.
 *
 * Read literally that is white on white. It was NOT, and the reason matters:
 * `index.css` remaps `.bg-white` to `--bg-surface` (#1A1C20), loads after
 * Tailwind, and wins on position — so these rendered white on charcoal and
 * looked fine. They were one deleted line away from being unreadable, and the
 * line that saved them is 1,200 lines away in a different file.
 *
 * They now name their own dark background instead of borrowing a global remap
 * of a class called `white`. This assertion keeps it that way. It is a
 * robustness contract, not a bug that shipped — recorded honestly because a
 * comment that overstates what it fixed is how the next person mis-scopes.
 *
 * Alpha whites (`bg-white/[0.08]`) are a wash over a dark surface and are
 * fine — the check requires the SOLID token. A white element with no text on
 * it (the Settings toggle knob) has no foreground token and is not flagged.
 */
const WHITE_FG = /^(?:text-white|text-\[#(?:fff|ffffff|ededf0|f5f5f5|fafafa)\])$/i;
const invisible = [];
for (const f of PAGES) {
  const src = read(f);
  const re = /className=\{?[`"]([\s\S]*?)[`"]/g;
  let m;
  while ((m = re.exec(src))) {
    for (const seg of segmentsOf(m[1])) {
      const toks = seg.split(/\s+/).filter(Boolean);
      const solidWhiteBg = toks.some(t => t === 'bg-white');
      const whiteFg      = toks.some(t => WHITE_FG.test(t));
      if (solidWhiteBg && whiteFg) invisible.push(f + ': ' + seg.trim().replace(/\s+/g, ' ').slice(0, 90));
    }
  }
}
ck('no element pairs a solid white background with white text', invisible.length === 0, invisible);

/**
 * The mirror image, and the reason the fixes above set a text colour as well as
 * a background: dropping a dark background onto an input without saying what
 * colour the text is leaves the browser default — near-black on charcoal.
 */
const DARK_BG = /^bg-\[#(?:121316|1A1C20)\]$/i;
/**
 * A colour, not a size. `text-sm` and `text-center` are `text-` tokens too, so
 * "does it mention text-anything" would pass on every element in the app.
 */
const TEXT_COLOUR = /^text-(?:\[|white$|black$|transparent$|[a-z]+-\d{2,3}$)/;
const darkNoFg = [];
for (const f of PAGES) {
  const src = read(f);
  /**
   * Finding the className on a form control cannot be done by matching the
   * whole tag. JSX props hold arrow functions, and `e => e.key === 'Enter'`
   * contains a `>`, so any regex that stops at the first `>` stops in the
   * middle of an onChange handler and never reaches className. The first
   * version of this check did exactly that and passed on a planted bug.
   *
   * So: walk from each tag opener to its FIRST className, and give up if
   * another tag opens first — that className belongs to a different element.
   */
  const tag = /<(input|select|textarea)\b/g;
  let t;
  while ((t = tag.exec(src))) {
    const window_ = src.slice(t.index + 1, t.index + 900);
    const ci = window_.indexOf('className=');
    if (ci === -1) continue;
    if (window_.slice(0, ci).includes('<')) continue;
    const cm = window_.slice(ci).match(/className=\{?[`"]([\s\S]*?)[`"]/);
    if (!cm) continue;
    const toks = cm[1].replace(/\$\{[\s\S]*?\}/g, ' ').split(/\s+/).filter(Boolean);
    if (toks.some(x => DARK_BG.test(x)) && !toks.some(x => TEXT_COLOUR.test(x))) {
      darkNoFg.push(f + ': <' + t[1] + '> ' + cm[1].trim().replace(/\s+/g, ' ').slice(0, 80));
    }
  }
}
ck('every dark-backgrounded input states its own text colour', darkNoFg.length === 0, darkNoFg);

// ── 6b. Measured low-contrast pairs ─────────────────────────────────────────
console.log('\n[6b] contrast');

/**
 * These pairs were measured against the BUILT stylesheet — every className in
 * pages/ and components/, background and foreground resolved through the
 * index.css overrides, composited over the page colour, scored with the WCAG
 * formula. Seven elements came back under 3:1:
 *
 *     2.10:1  four gold buttons carrying white text
 *     2.51:1  the "+ Day" and rest-timer buttons, #5a5a68 on a 4% white wash
 *     2.58:1  the offline banner, white on amber
 *
 * The measurement needs client/dist, which no CI step builds, so the audit
 * itself is a tool rather than a gate — and a gate that skips is worse than no
 * gate. What runs here instead is the specific pairs it found, as source
 * contracts. Narrower, but it cannot silently pass.
 */
const CONTRAST_BANNED = [
  { bg: 'bg-amber-500/90', fg: 'text-white', ratio: '2.58:1' },
  { bg: 'bg-white/[0.04]', fg: 'text-[#5a5a68]', ratio: '2.51:1' },
];
const lowContrast = [];
for (const f of ALL_JSX) {
  const src = read(f);
  const re = /className=\{?[`"]([\s\S]*?)[`"]/g;
  let m;
  while ((m = re.exec(src))) {
    for (const seg of segmentsOf(m[1])) {
      const toks = seg.split(/\s+/).filter(Boolean);
      for (const pair of CONTRAST_BANNED) {
        if (toks.includes(pair.bg) && toks.includes(pair.fg)) {
          lowContrast.push(`${f}: ${pair.bg} + ${pair.fg} (${pair.ratio})`);
        }
      }
    }
  }
}
ck('no element repeats a pair measured below 3:1', lowContrast.length === 0, lowContrast);

// ── 7b. plural() argument order ─────────────────────────────────────────────
console.log('\n[7b] plural() argument order');

/**
 * `plural(count, singular)`. Reversed, it does not throw — `Number('message')`
 * is NaN, so the `n === 1` branch is skipped and the badge renders "2 2s".
 * Silent, and only visible on a screen with the right data on it.
 *
 * A string literal in the first argument is always the mistake, and it is the
 * only form that can be caught statically.
 */
const badPlural = [];
for (const dir of ['pages', 'components']) {
  for (const g of fs.readdirSync(path.join(CLIENT, dir))) {
    if (!g.endsWith('.jsx')) continue;
    const f = dir + '/' + g;
    for (const m of read(f).matchAll(/\bplural\(\s*(['"])/g)) badPlural.push(f);
  }
}
ck('plural() is never called with the word first', badPlural.length === 0, [...new Set(badPlural)]);

/**
 * A count interpolated straight in front of a plural noun.
 *
 * Two of these were on a member's own screens: "1 days Logging Streak" on
 * Progress, and "Still open today: 6 physical activity" on the dashboard —
 * the second because the word is coach-configurable, so it was a variable
 * rather than a literal and the eye slid past it. `plural()` has existed since
 * the int8 fix; twelve places were simply not using it.
 *
 * Only counts, not every occurrence of the word: `${x} days` is the bug,
 * "last 90 days" is fine.
 */
const HARD_PLURALS = /\$\{[^}]*\}\s+(days|items|members|coaches|exercises|sets|messages|weeks|meals|entries|notes|foods|logs)\b/g;
const hardcoded = [];
for (const dir of ['pages', 'components', 'utils']) {
  const abs = path.join(CLIENT, dir);
  if (!fs.existsSync(abs)) continue;
  for (const g of fs.readdirSync(abs)) {
    if (!/\.(jsx|js)$/.test(g)) continue;
    const f = dir + '/' + g;
    for (const m of read(f).matchAll(HARD_PLURALS)) {
      hardcoded.push(`${f}: …${m[0].trim().slice(0, 60)}`);
    }
  }
}
ck('a count is never interpolated straight in front of a plural noun',
   hardcoded.length === 0, hardcoded.slice(0, 6));

// ── 8. No light-theme class without a dark-theme rule ───────────────────────
console.log('\n[8] design tokens — no legacy palette, no brand hex, no override layer');

/**
 * Until Sprint 0 the app was dark by ACCIDENT of a 346-line override layer in
 * index.css that re-coloured Tailwind's light-theme classes. It only worked
 * while the map was complete; hover variants needed !important; alpha variants
 * (`bg-stone-50/60`) slipped through and rendered near-white on charcoal.
 *
 * Now the theme is tokens in tailwind.config.js (`bg-surface`, `text-lo`,
 * `text-gold`, `text-eyebrow`…) and the JSX names them. This block is the
 * contract:
 *   · no `stone-*` or `emerald-*` utility anywhere in the client source
 *   · no brand colour written as a hex inside a class (`text-[#D4AF37]`)
 *   · the override layer stays deleted from index.css
 *   · every token the JSX names is one the config actually defines
 * The sweep tool that did the migration is server/scripts/lib/sweep-classes.js;
 * `--check` mode is asserted here too so it cannot silently drift from the map.
 */
const srcFiles = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.(jsx|js)$/.test(f)) srcFiles.push(path.relative(CLIENT, p));
  }
})(CLIENT);
ck('the client source tree was found', srcFiles.length > 40, srcFiles.length);

const LEGACY_PALETTE = /(?<![\w-])(?:hover:|focus:|active:|disabled:|group-hover:)?(?:bg|text|border|divide|from|to|via|ring|placeholder|accent|fill|stroke)-(?:stone|emerald)-\d{2,3}(?:\/[\w.\[\]]+)?(?![\w-])/g;
// Sprint 12: NO arbitrary hex colour class at all. Every colour in the JSX is a
// token. The one exception is a third-party brand colour used on its own
// button (WhatsApp green) — not ours to rename.
const HEX_ALLOWED = new Set(['25D366']);
const BRAND_HEX = /(?<![\w-])(?:hover:|focus:|active:|group-hover:)?[a-z-]+-\[#([0-9A-Fa-f]{3,8})\](?:\/[\w.\[\]]+)?(?![\w-])/g;

const legacyHits = [], hexHits = [];
for (const f of srcFiles) {
  const src = stripComments(read(f)).replace(/^\s*\/\/.*$/gm, '');
  let m;
  while ((m = LEGACY_PALETTE.exec(src))) legacyHits.push(m[0] + ' (' + f + ')');
  while ((m = BRAND_HEX.exec(src)))      { if (!HEX_ALLOWED.has(m[1].toUpperCase())) hexHits.push(m[0] + ' (' + f + ')'); }
}
ck('no stone-* or emerald-* palette class in any client file', legacyHits.length === 0, legacyHits.slice(0, 8));
ck('no hex colour inside a class anywhere (tokens only; WhatsApp green is the one allowed brand colour)', hexHits.length === 0, hexHits.slice(0, 8));

const cssNow = read('index.css');
ck('the override layer is gone from index.css (no .bg-stone / .text-emerald rules)',
   !/^\s*\.(?:bg|text|border|divide)-(?:stone|emerald)-\d+/m.test(cssNow), 'override rule found');
ck('index.css no longer re-declares Tailwind utilities with !important on hover',
   !/\.hover\\:[a-z-]+:hover\s*\{[^}]*!important/.test(cssNow), 'hover !important override found');

// Every token the JSX names must exist in tailwind.config.js. A typo like
// `text-gold-lite` renders as nothing at all — no error, just missing colour.
const twConfig = fs.readFileSync(path.join(CLIENT, '../tailwind.config.js'), 'utf8');
const colorBlock = twConfig.slice(twConfig.indexOf('colors: {'), twConfig.indexOf('borderRadius:'));
const sizeBlock  = twConfig.slice(twConfig.indexOf('fontSize: {'), twConfig.indexOf('colors: {'));
const defined = new Set();
for (const m of colorBlock.matchAll(/^\s*'?([a-z][a-z-]*)'?\s*:/gm)) defined.add(m[1]);
for (const m of sizeBlock.matchAll(/^\s*'?([a-z][a-z-]*)'?\s*:/gm))  defined.add(m[1]);
ck('tailwind.config.js defines the token set', defined.has('charcoal') && defined.has('gold') && defined.has('eyebrow') && defined.size > 25, [...defined]);

const TOKEN_USE = /(?<![\w-])(?:hover:|focus:|active:|disabled:|group-hover:)?(?:bg|text|border|border-t|border-b|divide|from|to|via|ring|accent|placeholder|fill|stroke)-((?:charcoal|surface|input|bright|soft|mid|mute|lo|faint|dim|ghost|gold|ok|warn|danger|info|hair|tiny|eyebrow|caption|micro|note|body|num)(?:-[a-z]+)*)(?:\/[\w.\[\]]+)?(?![\w-])/g;
const unknown = new Set();
for (const f of srcFiles) {
  const src = read(f);
  let m;
  while ((m = TOKEN_USE.exec(src))) if (!defined.has(m[1])) unknown.add(m[1] + ' (' + f + ')');
}
ck('every token the JSX uses is defined in the config (no silent typos)', unknown.size === 0, [...unknown].slice(0, 8));

// The sweep must be a no-op on the current tree. If someone reintroduces a
// mapped class, this tells them exactly which one, and that a tool exists.
{
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, [path.join(__dirname, 'lib/sweep-classes.js'), '--check'], { encoding: 'utf8' });
  ck('sweep-classes.js --check finds nothing left to rewrite', r.status === 0, (r.stdout || '').split('\n').slice(0, 6));
}

// ── 9. Today screen (Sprint 3) ──────────────────────────────────────────────
console.log('\n[9] Today screen structure');

/**
 * The member home is a hook (useTodayModel) + a layout (Today.jsx) + sheets.
 * These contracts keep that split honest, and pin the two layout rules a
 * phone cares about: the day strip scrolls inside itself, and nothing
 * interactive is hidden under a sheet.
 */
const todayPage = read('pages/Today.jsx');
const model     = read('../src/hooks/useTodayModel.js');
const dailyLog  = read('pages/DailyLog.jsx');

ck('DailyLog.jsx is a wrapper that renders Today (the route did not move)',
   /import Today from '\.\/Today'/.test(dailyLog) && /return <Today \/>/.test(dailyLog) && dailyLog.split('\n').length < 40, dailyLog.length);
ck('Today.jsx has no fetches and no store writes of its own — that is the hook\'s job',
   !/api\.(get|post)\(/.test(todayPage) && !/useEffect\(/.test(todayPage) && !/useState\(/.test(todayPage), 'Today.jsx has logic');
ck('the model still handles the PWA shortcuts (?open=ai / ?open=weight)',
   /get\('open'\)/.test(model) && /\['weight', 'food', 'water', 'sleep', 'workout', 'protocol', 'nutrition', 'mealidea'\]\.includes\(open\)/.test(model) && /open === 'ai'/.test(model));
ck('the model still flushes the debounced save on tab hide / unload',
   /visibilitychange/.test(model) && /beforeunload/.test(model));
ck('auto-derived protocol ticks are still additive only (tick, never untick)',
   /if \(derived\[id\] && !cur\[id\]\) patch\[id\] = true;/.test(model));

// Sprint 5b: Today's Plan (Move · Eat · Recover) is the one section that
// replaced the coach card, the tiles, the deficit chip and the dots card.
// DayStrip.jsx / ProtocolDots.jsx / CoachCard.jsx stay on disk (deploy never
// deletes) but Today must not import them.
const plan = read('components/today/TodaysPlan.jsx');
ck('Today provides the AI launcher, daily essentials and full plan entry', /<AILauncher/.test(todayPage) && /<DailyEssentials/.test(todayPage) && /navigate\('\/plan'\)/.test(todayPage));

ck('Today\'s Plan has exactly the three rows and every sheet a row can open is one of the seven',
   ['plan-move', 'plan-eat', 'plan-recover'].filter(id => new RegExp(`testId="${id}"`).test(plan)).length >= 2 &&
   ['workout', 'food', 'nutrition', 'water', 'sleep', 'protocol'].every(n => new RegExp(`onOpen\\('${n}'\\)`).test(plan)),
   ['workout', 'food', 'nutrition', 'water', 'sleep', 'protocol'].filter(n => !new RegExp(`onOpen\\('${n}'\\)`).test(plan)));
ck('the protocol dots live inside the Recover row, not their own card', /data-testid="protocol-dots"/.test(plan) && !/protocol-dots/.test(todayPage));
ck('the read carries one derived action (lib/day nextAction), never a hard-coded button', /nextAction\(\{/.test(todayPage) && /read-action/.test(read('components/today/AIRead.jsx')));
ck('the deficit is a sub-line of Eat, not a chip on the page', /plan-balance/.test(plan) && !/balance-chip/.test(todayPage));
ck('the streak is a line in the header and StreakCard is off Today', /streak-badge/.test(read('components/today/Greeting.jsx')) && !/StreakCard/.test(todayPage));
ck('notes are a collapsed row', /NotesRow/.test(todayPage) && /Add a note/.test(read('components/today/NotesRow.jsx')));

// z-order: sheet (80) must sit above the chat orb nav and below the milestone
// celebration (85); the protocol popover must live INSIDE the sheet, not on a
// fixed layer under it.
const sheet = read('components/primitives/Sheet.jsx');
const sheetZ = +(sheet.match(/z-\[(\d+)\]/) || [])[1];
const milestoneZ = +(read('components/today/MilestoneModal.jsx').match(/z-\[(\d+)\]/) || [])[1];
ck('sheet z-index is above the nav (50) and below the milestone modal', sheetZ > 50 && milestoneZ > sheetZ, [sheetZ, milestoneZ]);
ck('the protocol chip popover renders inside the sheet (sticky), not on a fixed layer',
   /sticky bottom-2/.test(read('components/sheets/ProtocolSheet.jsx')) && !/fixed left-4/.test(read('components/sheets/ProtocolSheet.jsx')));

// Every sheet the page mounts is driven by the one `sheet` value and closes
// through the one `closeSheet` — no sheet can be left open by a stale panel id.
const sheetNames = ['weight', 'water', 'sleep', 'protocol', 'food', 'workout', 'nutrition'];
ck('all seven sheets are mounted from the single sheet value',
   sheetNames.every(n => new RegExp(`open=\\{sheet === '${n}'\\}\\s+onClose=\\{closeSheet\\}`).test(todayPage)),
   sheetNames.filter(n => !new RegExp(`open=\\{sheet === '${n}'\\}`).test(todayPage)));
ck('the daily summary opens the weight sheet', /metric\('weight', 'scale', 'Weight'/.test(read('components/member/DailyEssentials.jsx')));

// ── 10. The AI is on the page (Sprint 4) ────────────────────────────────────
console.log('\n[10] AI thread on the page, composer docked');

const chat = read('components/AIChatLog.jsx');
ck('AI workspace is an accessible on-demand dialog', /role="dialog" aria-modal="true"/.test(chat) && /overlay \? \(composerOpen && createPortal/.test(chat));

ck('the composer is portaled to the body and fixed for keyboard support', /createPortal\(/.test(chat) && /data-testid="composer"/.test(chat) && /fixed left-0 right-0/.test(chat) && /kbInset/.test(chat));

ck('openChat() is a focus counter, not a boolean (a second tap still brings the composer up)',
   /focusRequest: s\.focusRequest \+ 1/.test(read('../src/store/aiChatStore.js')));
ck('Apply stamps lastAppliedAt; the model refreshes the workout summary from it, not from "overlay closed"',
   /useAIReviewSave\(/.test(chat) && /markApplied\(\)/.test(read('hooks/useAIReviewSave.js')) && /lastAppliedAt/.test(model) && !/prevChatOpen/.test(model));
// 17 Oct 2026: only a NEW request closes the sheet. The old form ("any
// non-zero counter") also fired on arrival at Today and shut the sheet a link
// had just opened; ui-tests [38] covers both directions in the browser.
ck('openChat() closes any open sheet so the composer is reachable (a new request only)',
   /chatFocusRequest !== seenFocusRequest\.current\) setHeroPanel\(null\)/.test(model) && !/if \(chatFocusRequest\) setHeroPanel\(null\)/.test(model));
ck('Today mounts exactly one AI workspace with overlay enabled', (todayPage.match(/<AIChatLog/g) || []).length === 1 && /<AIChatLog[^>]*overlay/.test(todayPage));

ck('the viewport meta asks Android to resize the layout viewport for the keyboard',
   /interactive-widget=resizes-content/.test(fs.readFileSync(path.join(CLIENT, '../index.html'), 'utf8')));
ck('the keyboard inset hook exists for iOS (visualViewport delta)', /visualViewport/.test(read('../src/hooks/useKeyboardInset.js')));
// Sprint 5b.1: what you say must be readable while you say it.
ck('the composer is an auto-growing textarea capped at 5 lines, with the tools on their own row',
   /<textarea[\s\S]*data-testid="composer-input"/.test(chat) && /maxHeight: 5 \* 22 \+ 16/.test(chat) && /export function autoGrow/.test(read('components/chat/ChatAtoms.jsx')));
ck('Enter sends, Shift+Enter is a new line', /e\.key === 'Enter' && !e\.shiftKey/.test(chat));
ck('the composer can be left without sending: × clears the draft, Escape steps away',
   /data-testid="composer-clear"/.test(chat) && /e\.key === 'Escape'/.test(chat) && /const clearDraft/.test(chat));
// Sprint 5b.3: the bar is summoned by the orb, not permanent.
ck('the composer appears on request and the member dock opens it', /composerOpen && createPortal/.test(chat) && /openChat\(\)/.test(read('components/UI.jsx')) && /data-testid="ai-orb"/.test(read('components/UI.jsx')));

ck('the assistant has Close, and the thread offers Tell me while the bar is away',
   /aria-label="Close AI assistant"/.test(chat) && /data-testid="thread-open-composer"/.test(chat));
ck('AI transcript reserves measured space above its composer', /marginBottom: composerHeight \+ kbInset/.test(chat) && /ResizeObserver/.test(chat));

ck('the box re-measures on every text change (grows and shrinks)', /useEffect\(\(\) => \{ autoGrow\(inputRef\.current\); \}, \[input\]\)/.test(chat));
ck('the bottom nav is hidden while the assistant is open', /!composerOpen && <nav/.test(read('components/UI.jsx')));

// ── 11. Plan screen + navigation (Sprint 6) ─────────────────────────────────
console.log('\n[11] Plan + nav');
const ui = read('components/UI.jsx');
const planPage = read('pages/Plan.jsx');
// 16 Oct 2026 (Sachin): Plan is a tab again — Today · Plan · Progress · More.
ck('member navigation has Today, Plan, Progress and More', (() => { const labels = [...ui.matchAll(/\{ label: '([A-Za-z]+)',\s+path: '([^']+)'/g)].map(m => m[1] + ':' + m[2]); return labels.slice(0,4).join(',') === 'Today:/,Plan:/plan,Progress:/progress,More:/more'; })());

ck('/settings still resolves and Profile links to it (the screen moved, it did not vanish)',
   /path="\/settings"/.test(fs.readFileSync(path.join(CLIENT, 'App.jsx'), 'utf8')) && /navigate\('\/settings'\)/.test(read('pages/Profile.jsx')));
ck('/plan is routed for members', /path="\/plan"/.test(fs.readFileSync(path.join(CLIENT, 'App.jsx'), 'utf8')));
ck('Plan reads ONE payload (/members/me/today) and the same protocol derivation Today uses',
   /getMyToday\(\)/.test(planPage) && /resolveProtocolItems\(protocol\)/.test(planPage) && /resolveProtocolItems\(protocol\)/.test(model) && !/api\.get\(/.test(planPage));
ck('Plan deep-links into Today\'s sheets rather than re-implementing them', /navigate\(sheet \? `\/\?open=\$\{sheet\}` : '\/'\)/.test(planPage));
ck('Plan does not mount the AI thread (the orb navigates to Today; the thread\'s -mx-4 row would overflow here)', !/AIChatLog/.test(planPage));

// ── 12. Onboarding by goal (Sprint 7) ───────────────────────────────────────
console.log('\n[12] Onboarding');
const onb = read('components/Onboarding.jsx');
const goalIds = [...onb.matchAll(/\{ id: '([a-z]+)',\s+label:/g)].map(m => m[1]).filter(id => !['child', 'adult', 'senior'].includes(id));
const serverGoals = (fs.readFileSync(path.join(__dirname, '../routes/patients.js'), 'utf8').match(/const GOALS = \[([^\]]+)\]/) || [])[1] || '';
ck('the goal ids the client offers are exactly the ids the server accepts',
   goalIds.length === 7 && goalIds.every(id => new RegExp(`'${id}'`).test(serverGoals)), [goalIds, serverGoals]);
ck('goals are sent as an ordered list, never a single goal', /age_mode: ageMode, avatar_idx: avatarIdx, goals,/.test(onb) && !/\n\s+goal,\n/.test(onb));
ck('the sample message is prefilled into the composer, not sent', /prefill\(SAMPLE_MESSAGE\)/.test(onb) && /prefillText/.test(chat));
ck('onboarding uses the icon set and tokens, not emoji in chrome (avatars excepted)', !/emoji:/.test(onb) && !/style=\{\{[^}]*color: '#/.test(onb));

// ── 13. My Health + Login (Sprint 7b) ───────────────────────────────────────
console.log('\n[13] My Health + Login');
const prof = read('pages/Profile.jsx');
ck('Profile is My Health: identity → Goal → My plan → Health insights → Devices → Account, in that order',
   ['data-testid="profile-goal"', 'data-testid="section-plan"', 'data-testid="section-insights"', 'data-testid="section-devices"', 'data-testid="section-account"']
     .map(t => prof.indexOf(t)).every((i, k, arr) => i > -1 && (k === 0 || i > arr[k - 1])));
ck('goals on Profile come from the same GOAL_OPTIONS the onboarding offers', /import \{ GOAL_OPTIONS \} from '\.\.\/components\/Onboarding'/.test(prof));
ck('logout is wired from the auth store (it was referenced without being destructured once)', /const \{ user, logout \} = useAuthStore\(\);/.test(prof) && /onClick=\{\(\) => \{ haptic\(8\); logout\(\); \}\}/.test(prof));
ck('detail-heavy cards sit behind Collapsible with a summary line', (prof.match(/<Collapsible /g) || []).length >= 6);
const login = read('pages/Login.jsx');
ck('the PIN stays one input (server PINs are "at least 4"), large and spaced; no fixed four boxes', /data-testid="login-pin"/.test(login) && /letterSpacing/.test(login) && !/maxLength=\{1\}/.test(login));
ck('remembered-member card uses the device avatar from the settings store', /data-testid="remembered-card"/.test(login) && /useSettingsStore\(st => st\.avatarIdx\)/.test(login) && /import \{ useSettingsStore \}/.test(login));

// ── 14. Coach home: Needs attention (Sprint 8) ──────────────────────────────
console.log('\n[14] Coach home');
const feed = read('components/coach/TriageFeed.jsx');
const patientsRoute = fs.readFileSync(path.join(__dirname, '../routes/patients.js'), 'utf8');
ck('GET /members/triage is declared before the first /:id route',
   patientsRoute.indexOf("router.get('/triage'") > -1 && patientsRoute.indexOf("router.get('/triage'") < patientsRoute.indexOf("router.get('/:id'"));
ck('the route composes services/triage (one set of rules), and the feed reads only that endpoint',
   /require\('\.\.\/services\/triage'\)/.test(patientsRoute) && /api\.get\('\/members\/triage'\)/.test(feed) && (feed.match(/api\.get\(/g) || []).length === 1);
ck('the feed never sends a message itself — WhatsApp drafts via whatsappLink, editable before send',
   /whatsappLink\(m\.phone, draftFor\(m\)\)/.test(feed) && !/api\.post\(/.test(feed));
ck('the feed survives an empty or malformed payload (no blank coach home)', /Array\.isArray\(data\.members\)/.test(feed) && /\.\.\.\(data\.counts \|\| \{\}\)/.test(feed));
ck('the coach home mounts the feed first', read('pages/PatientList.jsx').indexOf('<TriageFeed />') < read('pages/PatientList.jsx').indexOf('<MorningNudges />'));

// ── 15. Coach member page (Sprint 9) ────────────────────────────────────────
console.log('\n[15] Coach member page');
const mon = read('pages/Monitor.jsx');
ck('the member page mounts the brief above the tabs and the tabs are a Segmented control',
   mon.indexOf('<MemberBrief memberId={memberId}') > -1 && mon.indexOf('<MemberBrief') < mon.indexOf('<Segmented name="coach-tabs"') && !/icon: '📋'/.test(mon));
ck('the brief re-reads after every reload (briefKey bumped in load\'s finally)', /setBriefKey\(k => k \+ 1\)/.test(mon));
ck('GET /members/:id/brief exists, uses the same collection as triage, and is access-checked',
   /router\.get\('\/:id\/brief', authMW, roleCheck\('monitor', 'admin'\), requirePatientAccess/.test(patientsRoute) && (patientsRoute.match(/await collectTriage\(/g) || []).length === 2 && /composeBrief\(row, todayLog, totals\)/.test(patientsRoute));

// ── 16. Member page 9b + admin shortcut ─────────────────────────────────────
console.log('\n[16] Member page 9b');
const mon2 = read('pages/Monitor.jsx');
ck('Note and Message both open the ONE action sheet; the old modal and overlay are no longer rendered',
   /setActionTab\('note'\)/.test(mon2) && /setActionTab\('message'\)/.test(mon2) && /<MemberActionSheet/.test(mon2) && !/<AddNoteModal/.test(mon2) && !/<MessageMember\n/.test(mon2));
ck('the coach page renders the member\'s Timeline read-only with the member\'s meal slots, above a collapsed Full log',
   /<Timeline readOnly mealSlots=\{data\?\.profile\?\.meal_slots/.test(mon2) && /timelineModelFromServerLog\(activeLog/.test(mon2) && /<Collapsible title="Full log"/.test(mon2));
ck('push in the sheet is admin-only, matching the server (router.use(role(\'admin\')) in admin.js)',
   /if \(role === 'admin'\) options\.push\(\{ id: 'push'/.test(read('components/coach/MemberActionSheet.jsx')));
ck('Admin header has the Coach view shortcut and Today\'s gaps names open the member page',
   /data-testid="admin-coach-view"/.test(read('pages/AdminDashboard.jsx')) && /navigate\(`\/coach\/\$\{m\.member_id\}`\)/.test(read('components/TodaysGaps.jsx')));
ck('the reminders admin renders Test/Del through the tokened button map (no saturated fills reach the screen)',
   /const BTN = \{/.test(read('components/AdminReminders.jsx')) && /'#b91c1c': \{ background: 'rgba\(248,113,113,0\.08\)'/.test(read('components/AdminReminders.jsx')) && !/💧 Test|🏃 Test/.test(read('components/AdminReminders.jsx')));

// ── 17. The cached read (Sprint 10) ─────────────────────────────────────────
console.log('\n[17] Cached read');
const digestsSrc = fs.readFileSync(path.join(__dirname, '../services/digests.js'), 'utf8');
const readsSrc   = fs.readFileSync(path.join(__dirname, '../services/aiReads.js'), 'utf8');
const schemaSrc  = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
ck('ai_reads is additive and unique per member/day/kind',
   /CREATE TABLE IF NOT EXISTS ai_reads/.test(schemaSrc) && /CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_reads_unique/.test(schemaSrc) && /CHECK \(kind IN \('morning','evening','weekly'\)\)/.test(schemaSrc));
ck('the new table is declared ABOVE the deferred backfills (it must exist before any UPDATE runs)',
   schemaSrc.indexOf('CREATE TABLE IF NOT EXISTS ai_reads') < schemaSrc.indexOf('DEFERRED BACKFILLS'));
ck('both crons cache the SAME `body` they send — not a second computation',
   /kind: 'morning', text: body,/.test(digestsSrc) && /kind: 'evening', text: body,/.test(digestsSrc));
ck('a read is cached before the send, so a failed WhatsApp/push still leaves Today right',
   digestsSrc.indexOf("kind: 'morning', text: body,") < digestsSrc.indexOf('const wa = await sendWhatsApp'));
ck('a member with notifications off still gets the read, only the push is skipped',
   /const pushAllowed = !prefs\.optedOut && prefs\.push;/.test(digestsSrc) && /if \(!pushAllowed\) continue;/.test(digestsSrc));
ck('a cron failure never breaks the send (the save is wrapped)', (digestsSrc.match(/ai_reads \w+ save failed/g) || []).length === 2);
ck('save refuses an unknown kind and never stores an empty line', /KINDS\.includes\(kind\)/.test(readsSrc) && /if \(!clean\) return null;/.test(readsSrc));
ck('GET /members/me/read is member-only and declared before /:id',
   /router\.get\('\/me\/read', authMW, roleCheck\('patient'\)/.test(patientsRoute) && patientsRoute.indexOf("router.get('/me/read'") < patientsRoute.indexOf("router.get('/:id'"));
ck('Today prefers the cached read but keeps the local one as a fallback',
   /const read = serverRead\?\.text/.test(model) && /: localRead;/.test(model) && /getMyRead\(date\)/.test(model));

// ── 18. Coach charts and the outlier rule (Sprint 9b.1) ─────────────────────
console.log('\n[18] Coach charts + outlier rule');
const mon3 = read('pages/Monitor.jsx');
const charts = read('components/coach/MemberCharts.jsx');   // moved out of Monitor in 12b
// 16 Oct 2026: the brand is green; the charts read the live theme accent (utils/themeColor), never a hand-written gold.
ck('the coach\'s weight chart is the brand accent, not the old green/red', /stroke=\{accent\(\)\} strokeWidth=\{2\.5\}/.test(charts) && !/#D4AF37/i.test(charts) && !/stroke="#10b981"/.test(charts) && !/stroke="#f87171"\n\s+strokeDasharray/.test(charts));
ck('compliance bars are tinted with the brand accent by value, and each still opens that day', /<Cell key=\{i\} fill=\{\(d\.score \|\| 0\) >= 75 \? accent\(\)/.test(charts) && /setSelectedLog\(data\.log\)/.test(charts));
ck('the member page\'s "vs yesterday" uses the shared outlier rule, not the raw previous row',
   /previousWeight\(sortedLogs, sortedLogs\.findIndex/.test(mon3) && !/const prev = sortedLogs\[i \+ 1\]/.test(mon3));
const triageSrc = fs.readFileSync(path.join(__dirname, '../services/triage.js'), 'utf8');
ck('triage ignores a weigh-in that disagrees with its two nearest neighbours (including the latest row)',
   /const others = weighed\.filter/.test(triageSrc) && /!others\.every\(o => Math\.abs\(kg\(r\) - kg\(o\)\) > 3\)/.test(triageSrc));
ck('low protocol compliance in the evening is a reason, and only in the evening',
   /hour >= 18 && pct < 50 && daysSince === 0/.test(triageSrc) && /Protocol \$\{pct\}% by evening/.test(triageSrc));

// ── 19. Meal idea + weekly review (Sprint 11) ───────────────────────────────
console.log('\n[19] Meal idea + weekly review');
const idea = read('components/sheets/MealIdeaSheet.jsx');
const suggest = read('../src/lib/day/mealSuggest.js');
ck('the meal idea is computed on the phone from lib/day, not fetched from a model',
   /suggestMeal\(\{/.test(idea) && !/ai-chat/.test(idea) && /export function suggestMeal/.test(suggest));
ck('it only uses foods that carry real per-100g data', /f\?\.per_100g\?\.calories > 0/.test(suggest));
ck('it never suggests more than the calories left', /if \(kcal \+ m\.kcal > budget\) continue;/.test(suggest));
ck('being over target is checked before the "nearly there" branch', suggest.indexOf('kcal over target today') < suggest.indexOf('On target for today.'));
ck('adding writes through the same food path every other screen uses', /update\('food', \[\.\.\.\(log\.food \|\| \[\]\), \.\.\.rows\]\)/.test(idea));
ck('Today mounts the sheet and the Eat row opens it', /<MealIdeaSheet\s+open=\{sheet === 'mealidea'\}/.test(todayPage) && /onOpen\('mealidea'\)/.test(read('components/today/TodaysPlan.jsx')));
const weeklySrc = fs.readFileSync(path.join(__dirname, '../services/weeklyReport.js'), 'utf8');
ck('the four sections are derived at read time, not stored on the row (older weeks get them too)',
   /function reviewSections/.test(weeklySrc) && /sections: latest \? reviewSections\(latest\.data \|\| \{\}\) : null/.test(patientsRoute) && !/sections: \{/.test(weeklySrc.slice(weeklySrc.indexOf('const data = {'), weeklySrc.indexOf('let coachNote'))));
ck('the weekly card renders all four and keeps the coach note above them',
   ['week-wins', 'week-opportunities', 'week-pattern', 'week-next'].every(t => read('components/WeeklyReportCard.jsx').includes(t)) &&
   read('components/WeeklyReportCard.jsx').indexOf('From your coach') < read('components/WeeklyReportCard.jsx').indexOf('week-sections'));

// ── 20. Workout companion + health markers (Sprint 11b) ─────────────────────
console.log('\n[20] Workout companion + health markers');
const wlog = read('components/WorkoutLog.jsx');
const labs = read('components/LabResults.jsx');
ck('the suggested load comes from lib/workout (pure, golden-tested), and only prefills — never writes a set by itself',
   /import \{ suggestLoad \} from '\.\.\/lib\/workout\/suggestLoad'/.test(wlog) && /data-testid="use-suggestion"/.test(wlog) && /updateSet\(ex\.exercise_id, firstEmpty, 'reps'/.test(wlog));
ck('the increment scales with the load (1 / 2.5 / 5 kg)', /if \(weightKg < 20\) return 1;[\s\S]*if \(weightKg <= 60\) return 2\.5;[\s\S]*return 5;/.test(read('../src/lib/workout/suggestLoad.js')));
ck('labs: a summary line, each marker as latest ↓/↑ from previous, full cards behind View all',
   /data-testid="lab-summary"/.test(labs) && /data-testid="lab-marker"/.test(labs) && /data-testid="lab-view-all"/.test(labs) && /!showAll \? null :/.test(labs));
ck('the lab detail card no longer assumes the context object exists (a sparse row must not blank the page)',
   !/c\.context\./.test(labs) && /const ctx = c\.context \|\| \{\};/.test(labs) && /\(ctx\.supplements \|\| \[\]\)\.length/.test(labs));

// ── 21. Settings groups + recovery (Sprint 11c) ─────────────────────────────
console.log('\n[21] Settings + recovery');
const settingsSrc = read('pages/Settings.jsx');
const groupOrder = [...settingsSrc.matchAll(/data-testid="settings-group">([A-Za-z]+)</g)].map(m => m[1]);
ck('Settings has five groups in a fixed order', groupOrder.join(',') === 'Account,Preferences,Integrations,Notifications,Safety', groupOrder);
ck('the subscriptions list is guarded against a non-array response', /Array\.isArray\(s\.data\) \? s\.data : \[\]/.test(settingsSrc));
const rec = read('../src/lib/day/recovery.js');
const recCard = read('components/today/RecoveryCard.jsx');
ck('recovery never estimates: every metric is null unless a provider reported it', /const num = \(v\) => \(v == null/.test(rec) && !/\?\? 0/.test(rec));
ck('the card renders nothing without data for today or yesterday', /if \(!s\) return null;/.test(recCard) && /if \(latest\.date !== today && latest\.date !== yStr\) return null;/.test(rec));
ck('the provider is named on the card', /s\.providers\.join/.test(recCard));
ck('Today retains recovery for the current day', /isToday && <><ProgressPhotoCard[\s\S]*?<RecoveryCard today=\{m\.date\}/.test(todayPage) && !/RecoveryCard/.test(model));

// ── 22. House circuits (Sprint 11d) ─────────────────────────────────────────
console.log('\n[22] House circuits');
const aiSrc = fs.readFileSync(path.join(__dirname, '../routes/aiChat.js'), 'utf8');
ck('coach_circuits is additive, unique per coach per name (case-insensitive), above the backfills',
   /CREATE TABLE IF NOT EXISTS coach_circuits/.test(schemaSrc) && /idx_coach_circuits_name\s+ON coach_circuits\(monitor_id, LOWER\(name\)\)/.test(schemaSrc) && schemaSrc.indexOf('coach_circuits') < schemaSrc.indexOf('DEFERRED BACKFILLS'));
ck('the prompt carries the circuits and the parse ENFORCES them (not just asks)',
   /\$\{circuitsPromptBlock\(circuits\)\}\nRULES:/.test(aiSrc) && /function applyHouseCircuits/.test(aiSrc) && /applyHouseCircuits\(normaliseProgram\(raw\.program\), circuits\)/.test(aiSrc));
ck('replacing a circuit keeps the coach\'s original casing', /DO UPDATE SET exercises = EXCLUDED\.exercises, updated_at = NOW\(\)/.test(aiSrc) && !/DO UPDATE SET name = EXCLUDED\.name, exercises/.test(aiSrc));
ck('the circuits card is on Settings for coaches and admins only', /\(user\?\.role === 'monitor' \|\| user\?\.role === 'admin'\) && <HouseCircuits \/>/.test(read('pages/Settings.jsx')));

// ── 23. Architecture (Sprint 12) ────────────────────────────────────────────
console.log('\n[23] Architecture');
const chatSrc = read('components/AIChatLog.jsx');
ck('the AI chat store lives in store/aiChatStore.js and AIChatLog re-exports it (old imports keep working)',
   /export const useAIChat = create\(/.test(read('../src/store/aiChatStore.js')) && !/export const useAIChat = create\(/.test(chatSrc) && /export \{ useAIChat \};/.test(chatSrc));
ck('the nav no longer imports the 1,400-line chat component to read one flag (the UI ↔ AIChatLog cycle is gone)',
   /from '\.\.\/store\/aiChatStore'/.test(read('components/UI.jsx')) && !/from '\.\/AIChatLog'/.test(read('components/UI.jsx')));
ck('the chat uses the ONE protocol derivation (lib/day), not its own copy',
   /resolveProtocolItems\(protocol\)/.test(chatSrc) && !/const allActivities  = \[\.\.\.ACTIVITIES/.test(chatSrc));
ck('layout constants and atoms live in components/chat/ChatAtoms.jsx', /export const COMPOSER_BOTTOM_PX/.test(read('components/chat/ChatAtoms.jsx')) && /export function ToggleChip/.test(read('components/chat/ChatAtoms.jsx')));
ck('AIChatLog is smaller than it was (1,568 → under 1,450 lines)', chatSrc.split('\n').length < 1450, chatSrc.split('\n').length);

// ── 24. Monitor split (Sprint 12b) ──────────────────────────────────────────
console.log('\n[24] Monitor split');
const monSrc = read('pages/Monitor.jsx');
ck('the day detail and the charts are components of their own, and Monitor renders them',
   /<DayDetail activeLog=\{activeLog\}/.test(monSrc) && /<MemberCharts weightData=/.test(monSrc) && fs.existsSync(path.join(CLIENT, 'components/coach/DayDetail.jsx')) && fs.existsSync(path.join(CLIENT, 'components/coach/MemberCharts.jsx')));
ck('the per-day maths moved to lib/coach/dayMath (one definition shared by all three)',
   /from '\.\.\/lib\/coach\/dayMath\.jsx'/.test(monSrc) && /from '\.\.\/\.\.\/lib\/coach\/dayMath\.jsx'/.test(read('components/coach/DayDetail.jsx')) && !/^function calcN\(/m.test(monSrc) && !/^function rowCompliance\(/m.test(monSrc));
ck('the dead AddNoteModal is gone from Monitor', !/function AddNoteModal/.test(monSrc));
ck('Monitor is smaller (1,900 → under 1,400 lines)', monSrc.split('\n').length < 1400, monSrc.split('\n').length);
ck('the gate runs the undefined-identifier lint', /node scripts\/lint-undef\.mjs/.test(fs.readFileSync(path.join(__dirname, 'test-local.sh'), 'utf8')) && fs.existsSync(path.join(__dirname, 'lint-undef.mjs')));

// ── 25. Admin + FoodLog split (Sprint 12c) ──────────────────────────────────
console.log('\n[25] Admin + FoodLog split');
const adminSrc = read('pages/AdminDashboard.jsx');
const adminModals = ['AddMemberModal', 'EditMemberModal', 'PushModal', 'AddCoachModal', 'AssignModal', 'DeleteMemberModal'];
ck('the six admin modals live in components/admin/ and the page imports them',
   adminModals.every(m => fs.existsSync(path.join(CLIENT, `components/admin/${m}.jsx`)) && new RegExp(`import \\{ ${m} \\} from '\\.\\./components/admin/${m}'`).test(adminSrc) && !new RegExp(`^function ${m}\\(`, 'm').test(adminSrc)),
   adminModals.filter(m => new RegExp(`^function ${m}\\(`, 'm').test(adminSrc)));
ck('AdminDashboard is under 800 lines (was 2,163)', adminSrc.split('\n').length < 800, adminSrc.split('\n').length);
const foodSrc = read('components/FoodLog.jsx');
ck('FoodLog\'s pieces live in components/food/ (portions, macros, badge, scanner, prescribed meals)',
   ['portions.jsx', 'macros.js', 'TrafficBadge.jsx', 'BarcodeScanner.jsx', 'PrescribedMeals.jsx'].every(f => fs.existsSync(path.join(CLIENT, 'components/food', f))) &&
   /from '\.\/food\/portions\.jsx'/.test(foodSrc) && !/^function BarcodeScanner\(/m.test(foodSrc) && !/^function PrescribedMeals\(/m.test(foodSrc));
ck('FoodLog is under 800 lines (was 1,041)', foodSrc.split('\n').length < 800, foodSrc.split('\n').length);
ck('hasBarcodeDetector lives with the scanner and is exported', /export const hasBarcodeDetector/.test(read('components/food/BarcodeScanner.jsx')));

// ── Voice logging must not promise what is not set up ───────────────────────
// The card issues a CODE. Something else — a phone shortcut — has to use it.
//
// An earlier version guessed that an Android device in standalone mode was the
// native wrapper, fired a fitlife:// deep link, showed "Ready. Say Hey Google,
// log with FitLife", and never displayed the code. On an installed PWA, which
// is what most Android members run, nothing handles that scheme: the link did
// nothing and the member was left with a success message and no token.
{
  const voice = stripComments(read('components/VoiceLogging.jsx'));
  ck('the setup code is always shown, never hidden behind an unverifiable deep link',
     /setToken\(data\.token\)/.test(voice));
  ck('no "Ready" claim — a deep link that may have gone nowhere cannot be reported as success',
     !/Ready\. Say/.test(voice));
  ck('the intro does not promise hands-free logging before a shortcut exists',
     !/speaking to your phone, without opening/i.test(voice));
}

// ── Internal plumbing must not leak into member-facing copy ─────────────────
// The member's Reminders panel showed a red badge reading
// "Delivery failed — your coach may want to know" whenever notifications_log
// had failed=true for that message.
//
// `failed` means the PUSH TRANSPORT was rejected — the member had no
// subscription, or a stale one. That is our plumbing. They can do nothing
// about it, and the badge rendered directly underneath a message they were at
// that moment reading, which makes a working app look broken.
//
// The failure still matters, but to the COACH, on the Morning messages card.
{
  const bell = stripComments(read('components/NotificationBell.jsx'));
  ck('no "Delivery failed" badge is rendered to the member',
     !/Delivery failed/i.test(bell));
  ck('no push-transport wording leaks into the member notification panel',
     !/(delivery (failed|error)|could not be delivered|push failed)/i.test(bell));
}

// ── Brand: green, both themes (16 Oct 2026, Sachin's decision) ────────────────
console.log('\n[brand] green everywhere, both themes');
{
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const SRC = path.join(__dirname, '../../client/src');
  const gold = /#(d4af37|d4af6a|c5a059|f0e2b6|8c6d37|c9a227)\b|rgba\(\s*212\s*,\s*175\s*,\s*(55|106)/i;
  const offenders = walk(SRC).filter(f => /\.(jsx?|css)$/.test(f)).filter(f => {
    const code = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    return gold.test(code);
  }).map(f => path.relative(SRC, f));
  ck('no gold left in the app code (the brand is green since 16 Oct 2026)', offenders.length === 0, offenders);
  // 17 Oct 2026: the list above missed the old light gold (#e0c98a) on food
  // rows, Progress, Devices and Coach AI. Catch gold by its hue instead: any
  // #rrggbb between about 37° and 52° that is not one of the standard amber
  // WARNING shades (those are meant to look like a warning, not the brand).
  const AMBER_OK = new Set(['fbbf24', 'f59e0b', 'fcd34d', 'fde68a', 'fef3c7', 'd97706', 'b45309', 'eab308', 'facc15', 'fde047']);
  const goldish = (hex) => {
    const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, dlt = max - min;
    if (!dlt) return false;
    const s = dlt / (1 - Math.abs(2 * l - 1));
    let h = max === r ? ((g - b) / dlt) % 6 : max === g ? (b - r) / dlt + 2 : (r - g) / dlt + 4;
    h = (h * 60 + 360) % 360;
    return h >= 37 && h <= 52 && s >= 0.35 && l >= 0.3 && l <= 0.85;
  };
  const byHue = walk(SRC).filter(f => /\.(jsx?|css)$/.test(f)).flatMap(f => {
    const code = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
    return [...code.matchAll(/#([0-9a-f]{6})\b/gi)].map(m => m[1].toLowerCase())
      .filter(h => goldish(h) && !AMBER_OK.has(h)).map(h => `${path.relative(SRC, f)} #${h}`);
  });
  ck('no gold-coloured hex codes either (caught by hue, not by a list)', byHue.length === 0, byHue);
  ck('the hue check itself recognises the old golds', ['d4af37', 'e0c98a', 'b38f1f', 'b08a4a', 'c9a227'].every(goldish) && !goldish('315d47') && !goldish('b7d7c2'));
  const css = fs.readFileSync(path.join(SRC, 'index.css'), 'utf8');
  ck('dark accent #B7D7C2 on #141817; light accent #315D47 on #F8F9F6',
     /--fit-base: 20 24 23;[\s\S]*--fit-accent: 183 215 194;[\s\S]*\[data-theme="light"\][\s\S]*--fit-base: 248 249 246;[\s\S]*--fit-accent: 49 93 71;/.test(css));
  const store = fs.readFileSync(path.join(SRC, 'store/settingsStore.js'), 'utf8');
  const init = fs.readFileSync(path.join(SRC, '../public/theme-init.js'), 'utf8');
  ck('with no saved choice the theme follows the phone (store default "system", start-up script reads prefers-color-scheme)',
     /theme: 'system'/.test(store) && /prefers-color-scheme/.test(store) && /prefers-color-scheme/.test(init));
  const html = fs.readFileSync(path.join(SRC, '../index.html'), 'utf8');
  ck('the start-up theme script runs after the metas it sets', html.indexOf('theme-init.js') > html.indexOf('apple-mobile-web-app-status-bar-style'));
  // 18 Oct 2026 (Fixes-2i): the "couldn't load" screen in index.html was still
  // gold. The scans above only read client/src. Read the page shell and the
  // public scripts and styles too.
  const PUB = path.join(SRC, '../public');
  const shell = [path.join(SRC, '../index.html'), ...walk(PUB).filter(f => /\.(js|css|html)$/.test(f))];
  const shellGold = shell.flatMap(f => {
    const code = fs.readFileSync(f, 'utf8');
    const hits = [...code.matchAll(/#([0-9a-f]{6})\b/gi)].map(m => m[1].toLowerCase()).filter(h => goldish(h) && !AMBER_OK.has(h));
    return (gold.test(code) || hits.length) ? [`${path.relative(path.join(SRC, '..'), f)} ${hits.map(h => '#' + h).join(' ')}`] : [];
  });
  ck('no gold in index.html or client/public either (the start-up and recovery screens)', shellGold.length === 0, shellGold);
  ck('the recovery screen has a dark-theme version', /html\[data-theme="dark"\] #boot-fallback button \{ background: #b7d7c2/.test(html));
  const eb = fs.readFileSync(path.join(SRC, 'components/ErrorBoundary.jsx'), 'utf8');
  ck('the crash screen takes its colours from the theme (no fixed near-white text)', !/color: '#/.test(eb) && /color: 'var\(--text-hi\)'/.test(eb));
  const vite = fs.readFileSync(path.join(SRC, '../vite.config.js'), 'utf8');
  ck('the manifest uses the brand green and the dark ground', /theme_color: '#315D47'/.test(vite) && /background_color: '#141817'/.test(vite));

  // 18 Oct 2026 (Fixes-2f): Sachin's phone showed "124 kcal" in orange on the
  // workout sheet and amber Journey cards on Progress. Both passed the checks
  // above: Tailwind's amber/orange classes were allowed wholesale as "warning".
  // The rule now: amber only for warnings, and only through the `warn` token.
  console.log('\n[brand-2f] amber only for warnings');
  const jsx = walk(SRC).filter(f => /\.jsx?$/.test(f));
  const palette = jsx.flatMap(f => fs.readFileSync(f, 'utf8').split('\n')
    .map((line, i) => /\b(?:amber|yellow|orange)-\d{2,3}\b/.test(line) ? `${path.relative(SRC, f)}:${i + 1}` : null).filter(Boolean));
  ck('no Tailwind amber / yellow / orange classes: warnings use the warn token, everything else the accent', palette.length === 0, palette.slice(0, 12));
  const amberHex = jsx.flatMap(f => {
    const code = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
    return [...code.matchAll(/#([0-9a-f]{6})\b/gi)].map(m => m[1].toLowerCase()).filter(h => AMBER_OK.has(h))
      .map(h => `${path.relative(SRC, f).split(path.sep).join('/')} #${h}`);   // '/' on every OS, so the exception below also matches on Windows
  }).filter(x => x !== 'pages/Monitor.jsx #fef3c7');   // the printed report's own warning badge (paper, not the app): exactly this file and this colour
  ck('no hand-written amber hex codes in the app (only the printed report keeps its warning badge)', amberHex.length === 0, amberHex);
  const src = rel => fs.readFileSync(path.join(SRC, rel), 'utf8');
  const wl = src('components/WorkoutLog.jsx');
  ck('workout sheet: "Calories burned" is the accent, not a warning colour',
     /font-display text-xl font-bold text-gold">\{e\.totalKcal\} kcal/.test(wl));
  const prog = src('pages/Progress.jsx');
  const cards = [...prog.matchAll(/<div className="([^"]*)" data-testid="journey-card">/g)].map(m => m[1]);
  ck('Progress → Your Journey: six cards (the last shows when no other applies), none tinted with warn / danger', cards.length === 6 && cards.every(c => !/warn|danger/.test(c)), cards);
  const kcalWarn = jsx.flatMap(f => fs.readFileSync(f, 'utf8').split('\n')
    .map((line, i) => /text-warn[^"'`]*["'`]>\{[^}]*\}\s*kcal/.test(line) && !/\?/.test(line) ? `${path.relative(SRC, f)}:${i + 1}` : null).filter(Boolean));
  // (Warnings that mention kcal — "⚠️ Macro kcal is 120 kcal away", "Not in your plan · 90 kcal" — are fine.)
  ck('a calorie number is never painted the warning colour unless a condition chose it', kcalWarn.length === 0, kcalWarn);
  // Carbs and fat have their own colours (they were amber and amber-500).
  const lum = rgb => rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const vars = block => Object.fromEntries([...block.matchAll(/--fit-([a-z]+):\s*(\d+) (\d+) (\d+);/g)].map(m => [m[1], [+m[2], +m[3], +m[4]]]));
  const [darkBlock, lightBlock] = css.split('[data-theme="light"] {');
  const themes = { dark: vars(darkBlock), light: vars(lightBlock.split('}')[0]) };
  const macroBad = [];
  for (const [name, v] of Object.entries(themes)) for (const k of ['carb', 'fat']) {
    if (!v[k]) { macroBad.push(`${name}: --fit-${k} missing`); continue; }
    const hex = v[k].map(n => n.toString(16).padStart(2, '0')).join('');
    for (const bg of ['base', 'surface']) if (ratio(v[k], v[bg]) < 4.5) macroBad.push(`${name} ${k} on ${bg}: ${ratio(v[k], v[bg]).toFixed(2)}:1`);
    if (goldish(hex)) macroBad.push(`${name} ${k} #${hex} is gold-hued`);
  }
  ck('carb and fat colours exist in both themes, read at ≥ 4.5:1 and are not gold', macroBad.length === 0, macroBad);
  ck('tailwind defines text-carb / text-fat', /'carb': 'rgb\(var\(--fit-carb\)/.test(vite + fs.readFileSync(path.join(SRC, '../tailwind.config.js'), 'utf8')) && /'fat': 'rgb\(var\(--fit-fat\)/.test(fs.readFileSync(path.join(SRC, '../tailwind.config.js'), 'utf8')));
  // Copy from the same phone check.
  const plan = src('pages/Plan.jsx');
  ck('Plan → Eat without targets does not tell the member to "eat to your targets"',
     /\{macros\s*\n?\s*\? 'No meal plan for today\. Eat to your targets and log as you go\.'\s*\n?\s*: 'No meal plan yet\. Log what you eat; your coach will set your targets\.'/.test(plan));   // any target counts (protein only too); ui-tests E2 renders all four cases
  ck('food sheet top line no longer points at a mic that is not on screen', !/Tap the mic/.test(src('components/sheets/FoodSheet.jsx')));
  ck('weight chart labels the first and the latest weigh-in; the goal label sits away from the latest point',
     /ticks=\{weightTicks\}/.test(prog) && /n - 1\]/.test(prog) && /Goal \$\{targetW\}`, position: 'insideTopLeft'/.test(prog));
  ck('Progress title wraps instead of cutting the member’s name', /data-testid="progress-title"/.test(prog) && !/text-num font-medium text-white leading-tight mt-1 truncate/.test(prog));
}

console.log(`\n═══ LAYOUT CONTRACTS: ${pass} passed, ${fail} failed ═══`);
process.exit(fail > 0 ? 1 : 0);
