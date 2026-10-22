/**
 * scripts/lib/voice-evidence-shot.mjs — Fixes-2v: screenshots and evidence that
 * can never carry a member's name.
 *
 * Run-2 review, finding 1: the public run-2 artifact had a voice-test card
 * screenshot whose banner said "cropped, names removed" while five member names
 * were readable in its invitation list. The 2u robot replaced names in the page
 * once, the moment the card appeared, and checked the page (not the image). The
 * card's member list arrives from a separate request a moment later, so the
 * real names were rendered after that replacement and before the picture.
 *
 * Now, for any page picture:
 *   1. wait until the network is idle AND the element has stopped changing;
 *   2. mask the name-bearing parts with a style rule (which survives any later
 *      re-render) and keep a watcher that re-replaces names on every change;
 *   3. take the picture to a temporary file and READ IT BACK with OCR
 *      (tesseract); any member/coach/admin name, or any 4+ letter word of one,
 *      found in the image text discards the picture;
 *   4. no name list, or no OCR to check with → no picture.
 * And before anything is published, `publicationCheck` reads every output file
 * (pictures by OCR, text and workbook files directly) and removes or redacts
 * anything identifying.
 *
 * OCR can miss text, so the masking does the protecting and the OCR is a second
 * check; that is also why the robot leaves the admin picture out of the public
 * evidence by default (ROBOT_ADMIN_SHOT=1 to include it).
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function ocrAvailable(bin = process.env.ROBOT_OCR_BIN || 'tesseract') {
  try { execFileSync(bin, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}
/** Text read from an image (two page-layout modes, so scattered short labels are caught too). */
export function ocrText(file, bin = process.env.ROBOT_OCR_BIN || 'tesseract') {
  const run = (psm) => { try { return execFileSync(bin, [file, 'stdout', '--psm', psm], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60e3 }); } catch { return ''; } };
  return `${run('3')}\n${run('11')}`;
}
/**
 * Which names appear in a text: whole names (any case, any spacing) and every
 * word of a name with 4+ letters (any case). Returns COUNTS only, never the names,
 * so a log or report line cannot itself leak one.
 */
export function nameHits(text, names) {
  const t = String(text || ''); let full = 0, words = 0;
  for (const n of names || []) {
    const parts = String(n).trim().split(/\s+/).filter(Boolean);
    if (parts.length && new RegExp(`\\b${parts.map(esc).join('\\s+')}\\b`, 'i').test(t)) full++;
    else if (parts.some(w => w.length >= 4 && new RegExp(`\\b${esc(w)}\\b`, 'i').test(t))) words++;
  }
  return { full, words, any: full + words > 0 };
}
/** Replace whole names and their 4+ letter words with "[member]". → { text, hits } */
export function redactAll(text, names) {
  let out = String(text); let hits = 0;
  const list = [...new Set((names || []).flatMap(n => { const p = String(n).trim().split(/\s+/).filter(Boolean); return [p.join(' '), ...p.filter(w => w.length >= 4)]; }))].sort((a, b) => b.length - a.length);
  for (const n of list) out = out.replace(new RegExp(`\\b${n.split(' ').map(esc).join('\\s+')}\\b`, 'gi'), () => { hits++; return '[member]'; });
  return { text: out, hits };
}

/** Wait until the network is quiet and `selector` has not changed for `quietMs`. */
export async function waitSettled(page, selector, { quietMs = 1500, maxMs = 25e3 } = {}) {
  await page.waitForNetworkIdle({ idleTime: 1000, timeout: maxMs }).catch(() => {});
  return page.evaluate((sel, quiet, max) => new Promise((resolve) => {
    const root = document.querySelector(sel) || document.body; let last = Date.now(); const t0 = Date.now();
    const mo = new MutationObserver(() => { last = Date.now(); });
    mo.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
    const tick = () => { if (Date.now() - last >= quiet || Date.now() - t0 >= max) { mo.disconnect(); resolve(Date.now() - t0 < max); } else setTimeout(tick, 100); };
    tick();
  }), selector, quietMs, maxMs);
}

// The parts of the voice-test card that show a person's name.
export const NAME_AREAS = [
  '[data-testid="vp-members"] li > span:first-child',
  '[data-testid="vp-sample"] > p:first-child',
  'select[aria-label="Member to invite"] option:not([value=""])',
];
/** Mask the name areas (a style rule: survives re-renders) and keep names replaced on every change. */
export async function sanitise(page, names) {
  return page.evaluate((names, areas) => {
    const style = document.getElementById('__robot_mask') || Object.assign(document.createElement('style'), { id: '__robot_mask' });
    style.textContent = `${areas.join(',\n')} { color: transparent !important; text-shadow: none !important; background: #9aa19d !important; border-radius: 4px; }\nselect[aria-label="Member to invite"] option:not([value=""]) { display: none !important; }`;
    document.head.appendChild(style);
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const words = [...new Set(names.flatMap(n => { const p = n.trim().split(/\s+/); return [p.join(' '), ...p.filter(w => w.length >= 4)]; }))].sort((a, b) => b.length - a.length);
    const rx = words.map((w, i) => [new RegExp(`\\b${w.split(' ').map(esc).join('\\s+')}\\b`, 'gi'), `[M${i + 1}]`]);
    const fix = (t) => { let o = String(t); for (const [r, a] of rx) o = o.replace(r, a); return o; };
    const sweep = () => {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n; (n = w.nextNode());) { const t = fix(n.nodeValue); if (t !== n.nodeValue) n.nodeValue = t; }
      for (const el of document.querySelectorAll('input, textarea')) { const t = fix(el.value); if (t !== el.value) el.value = t; }
      for (const el of document.querySelectorAll('[aria-label],[title],[placeholder],[alt]')) for (const a of ['aria-label', 'title', 'placeholder', 'alt']) { const v = el.getAttribute(a); if (v) { const t = fix(v); if (t !== v) el.setAttribute(a, t); } }
    };
    sweep();
    window.__robotNameWatch?.disconnect();
    window.__robotNameWatch = new MutationObserver(() => sweep());
    window.__robotNameWatch.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'title', 'placeholder', 'alt', 'value'] });
    return true;
  }, names, NAME_AREAS);
}
/** Visible text of `selector` that still holds a name (counts only). */
export async function namesLeftInPage(page, selector, names) {
  const text = await page.evaluate((sel) => { const r = sel ? document.querySelector(sel) : document.body; return r ? r.innerText : ''; }, selector || null);
  return nameHits(text, names);
}

/**
 * Take a picture that is known to carry no name.
 * → { taken: true, file } or { taken: false, reason }   (reasons never contain a name)
 */
export async function safeShot(page, { selector, names, file, label, sim = false, quietMs = 1500, afterSanitise, ocrBin } = {}) {
  if (!Array.isArray(names) || !names.length) return { taken: false, reason: 'no list of names to check against, so the picture could not be cleared' };
  if (!ocrAvailable(ocrBin)) return { taken: false, reason: 'no OCR on this machine to check the finished picture, so it was not taken' };
  const el = selector ? await page.$(selector) : null;
  if (selector && !el) return { taken: false, reason: `${selector} not found` };
  await waitSettled(page, selector || 'body', { quietMs });
  await sanitise(page, names);
  if (afterSanitise) await afterSanitise(page);           // tests: a change arriving between sanitising and the picture
  await new Promise(r => setTimeout(r, 400));
  const left = await namesLeftInPage(page, selector, names);
  if (left.any) return { taken: false, reason: `identifying text still on the page (${left.full} name(s), ${left.words} name word(s)); picture not taken` };
  const banner = `${label} · names masked; picture read back by OCR: no names`;
  await page.evaluate((sel, t, sim) => { const d = document.createElement('div'); d.id = '__robot_banner'; d.textContent = t;
    d.style.cssText = `padding:4px 8px;font:600 11px sans-serif;text-align:center;color:#fff;background:${sim ? '#8a1c1c' : '#1f4d39'}${sel ? '' : ';position:fixed;left:0;right:0;top:0;z-index:2147483647'}`;
    (sel ? document.querySelector(sel) : document.body)[sel ? 'prepend' : 'appendChild'](d); }, selector || null, banner, sim);
  // How many name areas are actually masked at the moment of the picture (recorded as evidence).
  const masked = await page.evaluate((areas, sel) => { const root = sel ? document.querySelector(sel) : document; const els = areas.flatMap(a => [...root.querySelectorAll(a)]).filter(e => e.offsetParent !== null);
    return { areas: els.length, masked: els.filter(e => getComputedStyle(e).color === 'rgba(0, 0, 0, 0)').length, style: !!document.getElementById('__robot_mask') }; }, NAME_AREAS, selector || null);
  const tmp = `${file}.unchecked.png`;
  try {
    if (selector) await (await page.$(selector)).screenshot({ path: tmp }); else await page.screenshot({ path: tmp });
  } finally { await page.evaluate(() => document.getElementById('__robot_banner')?.remove()).catch(() => {}); }
  const hits = nameHits(ocrText(tmp, ocrBin), names);
  if (hits.any) { fs.rmSync(tmp, { force: true }); return { taken: false, reason: `OCR read identifying text in the finished picture (${hits.full} name(s), ${hits.words} name word(s)); picture discarded` }; }
  fs.renameSync(tmp, file);
  return { taken: true, file, masked };
}

/**
 * The last gate before anything is published: every picture is read by OCR
 * (removed if it holds a name, or if there is no OCR or no name list to check
 * with); every text/JSON/CSV/workbook file is redacted in place.
 * → { checked, removed: [{file, reason}], redacted: [{file, hits}] }
 */
export function publicationCheck(dir, names, { ocrBin } = {}) {
  const out = { checked: 0, removed: [], redacted: [] };
  const haveNames = Array.isArray(names) && names.length > 0, ocr = ocrAvailable(ocrBin);
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(dir)) {
    const rel = path.relative(dir, f);
    if (/\.png$/i.test(f)) {
      out.checked++;
      if (!haveNames || !ocr) { fs.rmSync(f); out.removed.push({ file: rel, reason: !haveNames ? 'no name list to check it against' : 'no OCR to read it' }); continue; }
      const h = nameHits(ocrText(f, ocrBin), names);
      if (h.any) { fs.rmSync(f); out.removed.push({ file: rel, reason: `OCR read ${h.full} name(s), ${h.words} name word(s)` }); }
    } else if (/\.(md|json|csv|txt|xlsx)$/i.test(f)) {
      out.checked++;
      if (!haveNames) continue;
      if (/\.xlsx$/i.test(f)) {
        // xlsxLite writes a stored (uncompressed) zip with inline strings: a name would be readable bytes.
        const raw = fs.readFileSync(f).toString('utf8');
        const h = nameHits(raw, names);
        if (h.any) { fs.rmSync(f); out.removed.push({ file: rel, reason: `workbook held ${h.full} name(s), ${h.words} name word(s)` }); }
        continue;
      }
      const r = redactAll(fs.readFileSync(f, 'utf8'), names);
      if (r.hits) { fs.writeFileSync(f, r.text); out.redacted.push({ file: rel, hits: r.hits }); }
    }
  }
  return out;
}
