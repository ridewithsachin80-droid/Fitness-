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
 *
 * Fixes-2w (2v review): an OCR read that FAILS is not a clean read. `ocrRead`
 * returns { ok:false, reason } when either required pass exits non-zero, times
 * out, cannot start, or the picture is missing/empty; only { ok:true, text } can
 * clear a picture. Pictures are taken into a holding folder OUTSIDE the upload
 * folder and only `publicationCheck` moves a cleared one in, so a crash, a block
 * or a kill can never leave an unchecked picture where the workflow uploads from.
 * It also writes CLEARED_LIST (SHA-256 of every cleared picture); the workflow
 * deletes any picture not on it before uploading.
 */
import { execFileSync, spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

/** File in the upload folder listing the SHA-256 of every picture the publication check cleared. */
export const CLEARED_LIST = 'cleared-pictures.sha256';
/** Both OCR page-layout passes must complete before a picture can be cleared. */
export const OCR_PASSES = ['3', '11'];
const ocrTimeout = () => Number(process.env.ROBOT_OCR_TIMEOUT_MS) || 60e3;

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function ocrAvailable(bin = process.env.ROBOT_OCR_BIN || 'tesseract') {
  try { execFileSync(bin, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}
/**
 * Read an image with OCR: every pass in OCR_PASSES (two page-layout modes, so
 * scattered short labels are caught too) must complete.
 * → { ok: true, text }  — a completed read; empty text is a genuine "no text"
 * → { ok: false, reason } — the read did not complete (reason names no person and no file)
 */
export function ocrRead(file, { bin = process.env.ROBOT_OCR_BIN || 'tesseract', timeoutMs = ocrTimeout(), passes = OCR_PASSES } = {}) {
  let size = 0; try { size = fs.statSync(file).size; } catch { return { ok: false, reason: 'the picture file is missing' }; }
  if (!size) return { ok: false, reason: 'the picture file is empty' };
  const texts = [];
  for (const psm of passes) {
    const r = spawnSync(bin, [file, 'stdout', '--psm', psm], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: timeoutMs, killSignal: 'SIGKILL' });
    if (r.error?.code === 'ETIMEDOUT') return { ok: false, reason: `OCR pass ${psm} timed out after ${Math.round(timeoutMs / 100) / 10} s` };
    if (r.error) return { ok: false, reason: `OCR pass ${psm} could not run (${r.error.code || 'error'})` };
    if (r.signal) return { ok: false, reason: `OCR pass ${psm} was stopped (${r.signal})` };
    if (r.status !== 0) return { ok: false, reason: `OCR pass ${psm} failed (exit code ${r.status})` };
    texts.push(r.stdout || '');
  }
  return { ok: true, text: texts.join('\n') };
}
/** Text read from an image. Throws when the read did not complete: a failed read is never "no text". */
export function ocrText(file, bin = process.env.ROBOT_OCR_BIN || 'tesseract') {
  const r = ocrRead(file, { bin });
  if (!r.ok) throw new Error(`OCR could not finish reading the picture: ${r.reason}`);
  return r.text;
}
const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const moveFile = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); try { fs.renameSync(from, to); } catch { fs.copyFileSync(from, to); fs.rmSync(from, { force: true }); } };
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
 * → { taken: true, file } or { taken: false, reason, unchecked? }   (reasons never contain a name)
 * The unchecked picture is written to `quarantine` (default: the system temp folder), never next to
 * `file`, and is always deleted unless a completed OCR read clears it. The robot passes a `file`
 * inside its holding folder too, so even a cleared picture reaches the upload folder only through
 * `publicationCheck`.
 */
export async function safeShot(page, { selector, names, file, label, sim = false, quietMs = 1500, afterSanitise, ocrBin, ocrTimeoutMs, quarantine } = {}) {
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
  const holdDir = fs.mkdtempSync(path.join(quarantine || os.tmpdir(), 'unchecked-'));
  const tmp = path.join(holdDir, `${path.basename(file)}.unchecked.png`);
  try {
    try {
      if (selector) await (await page.$(selector)).screenshot({ path: tmp }); else await page.screenshot({ path: tmp });
    } finally { await page.evaluate(() => document.getElementById('__robot_banner')?.remove()).catch(() => {}); }
    const read = ocrRead(tmp, { bin: ocrBin, ...(ocrTimeoutMs ? { timeoutMs: ocrTimeoutMs } : {}) });
    if (!read.ok) return { taken: false, unchecked: true, reason: `OCR could not finish reading the finished picture (${read.reason}); picture discarded` };
    const hits = nameHits(read.text, names);
    if (hits.any) return { taken: false, reason: `OCR read identifying text in the finished picture (${hits.full} name(s), ${hits.words} name word(s)); picture discarded` };
    moveFile(tmp, file);
    return { taken: true, file, masked };
  } finally { fs.rmSync(holdDir, { recursive: true, force: true }); }
}

/**
 * The last gate before anything is published.
 * Pictures: every PNG in `dir` and in the holding folder `quarantine` is read by OCR. A picture is
 * cleared only by a COMPLETED read with no name in it; a cleared picture from the holding folder is
 * moved into `dir` (same relative path). Everything else is deleted:
 *   kind 'identifying' — OCR read a name                       → the run is FAILED
 *   kind 'unchecked'   — no name list, no OCR, or the read did not complete → INCOMPLETE
 * The SHA-256 of every cleared picture is written to `dir/CLEARED_LIST`, and the holding folder is emptied.
 * Text/JSON/CSV files are redacted in place; a workbook holding a name is removed ('identifying').
 * → { checked, cleared, complete, removed: [{file, reason, kind}], redacted: [{file, hits}] }
 */
export function publicationCheck(dir, names, { ocrBin, ocrTimeoutMs, quarantine } = {}) {
  const out = { checked: 0, cleared: 0, complete: true, removed: [], redacted: [] };
  const haveNames = Array.isArray(names) && names.length > 0, ocr = ocrAvailable(ocrBin);
  const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);
  const cleared = [];
  const pictures = [...walk(dir).filter(f => /\.png$/i.test(f)).map(f => ({ f, rel: path.relative(dir, f), held: false })),
    ...(quarantine ? walk(quarantine).filter(f => /\.png$/i.test(f)).map(f => ({ f, rel: path.relative(quarantine, f), held: true })) : [])];
  for (const { f, rel, held } of pictures) {
    out.checked++;
    const drop = (reason, kind) => { fs.rmSync(f, { force: true }); out.removed.push({ file: rel, reason, kind }); if (kind === 'unchecked') out.complete = false; };
    if (!haveNames || !ocr) { drop(!haveNames ? 'no name list to check it against' : 'no OCR to read it', 'unchecked'); continue; }
    const read = ocrRead(f, { bin: ocrBin, ...(ocrTimeoutMs ? { timeoutMs: ocrTimeoutMs } : {}) });
    if (!read.ok) { drop(`OCR could not finish reading it (${read.reason})`, 'unchecked'); continue; }
    const h = nameHits(read.text, names);
    if (h.any) { drop(`OCR read ${h.full} name(s), ${h.words} name word(s)`, 'identifying'); continue; }
    const dest = held ? path.join(dir, rel) : f;
    if (held) moveFile(f, dest);
    cleared.push(sha256(dest)); out.cleared++;
  }
  fs.writeFileSync(path.join(dir, CLEARED_LIST), cleared.length ? cleared.join('\n') + '\n' : '');
  if (quarantine) fs.rmSync(quarantine, { recursive: true, force: true });
  for (const f of walk(dir).filter(f => /\.(md|json|csv|txt|xlsx)$/i.test(f))) {
    const rel = path.relative(dir, f);
    out.checked++;
    if (!haveNames) continue;
    if (/\.xlsx$/i.test(f)) {
      // xlsxLite writes a stored (uncompressed) zip with inline strings: a name would be readable bytes.
      const raw = fs.readFileSync(f).toString('utf8');
      const h = nameHits(raw, names);
      if (h.any) { fs.rmSync(f); out.removed.push({ file: rel, reason: `workbook held ${h.full} name(s), ${h.words} name word(s)`, kind: 'identifying' }); }
      continue;
    }
    const r = redactAll(fs.readFileSync(f, 'utf8'), names);
    if (r.hits) { fs.writeFileSync(f, r.text); out.redacted.push({ file: rel, hits: r.hits }); }
  }
  return out;
}
