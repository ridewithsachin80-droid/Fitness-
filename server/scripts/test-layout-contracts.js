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

ck('the name block beside it is allowed to shrink instead',
   /<div className="min-w-0">\s*\n\s*<p className="text-\[10px\] font-bold tracking-widest uppercase text-\[#F0E2B6\]/.test(admin),
   'name block missing min-w-0');

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

const PAGES = ['pages/AdminDashboard.jsx', 'pages/AdminFoods.jsx', 'pages/Monitor.jsx',
               'pages/PatientList.jsx', 'pages/Settings.jsx', 'pages/Profile.jsx',
               'pages/Progress.jsx', 'pages/DailyLog.jsx', 'pages/Login.jsx'];

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
const whiteOnGold = [];
for (const f of PAGES) {
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
const KNOWN_TABS = new Set(['today', 'nutrition', 'training', 'labs']);
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
ck('all four tab groups are actually used',
   [...KNOWN_TABS].every(t => monitor.includes(`{tab === '${t}' && (<>`)), 'a tab group renders nothing');

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

// ── 8. No light-theme class without a dark-theme rule ───────────────────────
console.log('\n[8] palette coverage');

/**
 * The app is dark, but ~390 Tailwind `stone-*` and `emerald-*` classes are
 * still written in the JSX. That is fine — `index.css` remaps them, which is
 * one rule instead of 390 edits. It only works while the map is COMPLETE.
 *
 * Nine of them had no rule and rendered Tailwind's light-theme default:
 * `bg-emerald-600` made seven primary buttons green, `hover:text-stone-600`
 * turned a member's name #57534e on charcoal — near-invisible — the moment you
 * touched the row, and `hover:bg-stone-50` flashed near-white.
 *
 * They survived a colour sweep because none of them is visible at rest. So the
 * check is not "look at the colours", it is: every stone/emerald class the JSX
 * uses must have a rule in index.css. There is no allowlist — a gap is either
 * fixed or it is red.
 *
 * Alpha variants (`bg-emerald-400/10`) are skipped: Tailwind emits those as
 * their own classes, a bare rule would not reach them, and they are the
 * semantic status greens on lab values and confidence badges, which should
 * stay green.
 */
const jsxFiles = [];
for (const dir of ['pages', 'components']) {
  for (const f of fs.readdirSync(path.join(CLIENT, dir))) {
    if (f.endsWith('.jsx')) jsxFiles.push(dir + '/' + f);
  }
}
ck('the client source tree was found', jsxFiles.length > 10, jsxFiles.length);

const cssSrc  = read('index.css');
const hasRule = (tok) => {
  const esc = tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:/g, '\\\\:');
  return new RegExp('\\.' + esc + '(?=[\\s,{:>])').test(cssSrc);
};
const PALETTE = /^(?:hover:|focus:|active:|disabled:|group-hover:)?(?:bg|text|border|divide|from|to|ring|placeholder|accent|fill|stroke)-(?:stone|emerald)-\d{2,3}$/;

const unmapped = new Map();
for (const f of jsxFiles) {
  const src = read(f);
  const re = /className=\{?[`"']([\s\S]*?)[`"']/g;
  let m;
  while ((m = re.exec(src))) {
    for (const tok of m[1].split(/[\s`"'{}$?]+/)) {
      if (!tok || tok.includes('/') || !PALETTE.test(tok) || hasRule(tok)) continue;
      if (!unmapped.has(tok)) unmapped.set(tok, f);
    }
  }
}
ck('every stone/emerald class the JSX uses has a rule in index.css',
   unmapped.size === 0, [...unmapped].map(([t, f]) => t + ' (' + f + ')'));

console.log(`\n═══ LAYOUT CONTRACTS: ${pass} passed, ${fail} failed ═══`);
process.exit(fail > 0 ? 1 : 0);
