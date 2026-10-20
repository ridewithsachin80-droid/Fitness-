/**
 * scripts/lib/voice-evidence.mjs — the voice evidence robot's decisions (Fixes-2s).
 *
 * Everything here is pure (or takes its network function as an argument), so
 * each failure case the 2r review listed can be tested without a site:
 * test-voice-evidence-robot.mjs. The robot (robot-voice-evidence.mjs) only
 * drives the browser and the API and hands what it saw to these functions.
 */
import crypto from 'crypto';

// ── 1. Where it may run ──────────────────────────────────────────────────────
export const TEST_ORIGIN = 'https://fitness-test.up.railway.app';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Real runs: exactly the approved HTTPS test origin. Simulation (local, canned
 * providers): only on this computer, and only when asked for explicitly.
 */
export function checkTarget(base, { simulation = false } = {}) {
  let u;
  try { u = new URL(String(base || '')); } catch { return { ok: false, reason: `not a web address: "${base}"` }; }
  if (u.username || u.password) return { ok: false, reason: 'the address must not carry a user name or password' };
  if (simulation) {
    if (!['http:', 'https:'].includes(u.protocol) || !LOOPBACK.has(u.hostname)) return { ok: false, reason: `simulation runs only against this computer (localhost), not ${u.origin}` };
    return { ok: true, mode: 'simulation', origin: u.origin };
  }
  if (u.origin !== TEST_ORIGIN) return { ok: false, reason: `real runs go only to ${TEST_ORIGIN}, not ${u.origin}` };
  return { ok: true, mode: 'real', origin: u.origin };
}

/**
 * The server must report exactly the expected commit. Unknown, unreachable or
 * different after the bounded wait → BLOCKED.
 */
export async function checkDeployment({ origin, expect, fetchImpl = fetch, waitMs = 15 * 60e3, pollMs = 20e3, log = () => {} }) {
  if (!expect) return { ok: false, reason: 'no expected commit was given (GITHUB_SHA / ROBOT_EXPECT_COMMIT), so the deployment cannot be identified' };
  const until = Date.now() + waitMs;
  let last = 'not checked';
  for (;;) {
    try {
      const r = await fetchImpl(`${origin}/health?voice=${Date.now()}`);
      const j = await r.json().catch(() => null);
      const c = j && Object.prototype.hasOwnProperty.call(j, 'commit') ? j.commit : undefined;
      if (c === expect) return { ok: true, commit: c };
      last = c === undefined ? `health answered ${r.status} without a commit field` : c === null ? 'the server does not report its commit' : `the server runs ${String(c).slice(0, 7)}, not ${expect.slice(0, 7)}`;
    } catch (e) { last = `health unreachable (${e.message})`; }
    if (Date.now() + pollMs > until) return { ok: false, reason: `deployment not confirmed: ${last}` };
    log(`waiting for the deployment: ${last}`);
    await new Promise(r => setTimeout(r, pollMs));
  }
}

// ── 2. The test cases and what each must produce ────────────────────────────
const F = {
  idli: { key: 'idli', re: /\bidl[iy]s?\b|ಇಡ್ಲಿ|इडली/i },
  sambar: { key: 'sambar', re: /samb(h)?ar|ಸಾಂಬಾರ್|सांभर/i },
  roti: { key: 'roti', re: /\brot(i|is|ti)\b|chapati|phulka|रोटी/i },
  dal: { key: 'dal', re: /\bda+l\b|dhal|दाल/i },
};
export const CASES = [
  { id: 'S1', lang: 'en-IN', voice: 'en-us', say: 'Two idli, one bowl sambar, weight eighty two point five kilograms.',
    expect: { foods: [{ ...F.idli, n: 2 }, { ...F.sambar, n: 1, unit: 'bowl' }], weight: 82.5 }, save: true,
    plain: '2 idli, 1 bowl sambar, weight 82.5 kg; saved and read back' },
  { id: 'S2', lang: 'kn-IN', voice: 'kn', say: 'ಬೆಳಗ್ಗೆ ಎರಡು ಇಡ್ಲಿ ಮತ್ತು ಒಂದು ಬೌಲ್ ಸಾಂಬಾರ್ ತಿಂದೆ',
    expect: { foods: [{ ...F.idli, n: 2 }, { ...F.sambar, n: 1, unit: 'bowl' }], weight: null }, save: true,
    plain: '2 idli, 1 bowl sambar; saved and read back (or refused)', refusalAllowed: true },
  { id: 'S3', lang: 'hi-IN', voice: 'hi', say: 'दो रोटी और एक कटोरी दाल खाई',
    expect: { foods: [{ ...F.roti, n: 2 }, { ...F.dal, n: 1, unit: 'katori' }], weight: null }, save: true,
    plain: '2 roti, 1 katori dal; saved and read back' },
  { id: 'S4', lang: 'en-IN', kind: 'silence', say: '(6 seconds of silence)',
    expect: { refused: true }, retry: true, plain: 'refused; Retry re-sends the identical recording' },
  { id: 'S5', lang: 'en-IN', voice: 'en-us', kind: 'noisy', say: 'Two idli, weight eighty two point five kilograms.',
    expect: { foods: [{ ...F.idli, n: 2 }], weight: 82.5 }, save: false, refusalAllowed: true,
    plain: 'a correct preview or a refusal; never a wrong weight; never saved' },
];

const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, half: 0.5, ek: 1, do: 2, teen: 3, ondu: 1, eradu: 2, mooru: 3, 'ಒಂದು': 1, 'ಎರಡು': 2, 'एक': 1, 'दो': 2 };
const UNITS = { bowl: 'bowl', bowls: 'bowl', katori: 'katori', katoris: 'katori', cup: 'cup', cups: 'cup', plate: 'plate', plates: 'plate', glass: 'glass', glasses: 'glass', piece: 'piece', pieces: 'piece', pc: 'piece', pcs: 'piece', 'ಬೌಲ್': 'bowl', 'कटोरी': 'katori' };
/** "2 idli" → {n:2}, "1 bowl" → {n:1, unit:'bowl'}, "ek katori" → {n:1, unit:'katori'}. */
export function parseQty(text) {
  const t = String(text || '').toLowerCase();
  const d = t.match(/(\d+(?:\.\d+)?)/);
  let n = d ? Number(d[1]) : null;
  if (n == null) for (const w of t.split(/[^\p{L}\p{M}\p{N}.]+/u)) if (w in NUM) { n = NUM[w]; break; }
  let unit = null;
  for (const w of t.split(/[^\p{L}\p{M}]+/u)) if (w in UNITS) { unit = UNITS[w]; break; }
  return { n, unit };
}

/**
 * Compare structured items (preview from the parse, or entries read back after
 * saving) with a case's expectation. PASS only when every expected food is
 * there with the right count and unit, nothing else is, and the weight matches.
 */
export function evaluateItems(expect, { foods = [], weight_kg = null } = {}) {
  const reasons = []; let fail = false, unverified = false;
  const used = new Set();
  for (const e of expect.foods || []) {
    const i = foods.findIndex((f, k) => !used.has(k) && e.re.test(String(f.name || '')));
    if (i < 0) { fail = true; reasons.push(`missing ${e.key}`); continue; }
    used.add(i);
    const q = parseQty(foods[i].qty_text);
    if (q.n == null) { unverified = true; reasons.push(`${e.key}: amount not stated ("${foods[i].qty_text ?? ''}")`); continue; }
    if (q.n !== e.n) { fail = true; reasons.push(`${e.key}: ${q.n} instead of ${e.n}`); }
    if (e.unit) {
      if (!q.unit) { unverified = true; reasons.push(`${e.key}: no unit ("${foods[i].qty_text}"), expected ${e.unit}`); }
      else if (q.unit !== e.unit) { fail = true; reasons.push(`${e.key}: ${q.unit} instead of ${e.unit}`); }
    }
  }
  foods.forEach((f, k) => { if (!used.has(k)) { fail = true; reasons.push(`unexpected ${f.name}`); } });
  const w = weight_kg == null || weight_kg === '' ? null : Number(weight_kg);
  if (expect.weight != null) {
    if (w == null) { fail = true; reasons.push(`weight missing (expected ${expect.weight} kg)`); }
    else if (Math.abs(w - expect.weight) > 1e-6) { fail = true; reasons.push(`weight ${w} kg instead of ${expect.weight} kg`); }
  } else if (w != null) { fail = true; reasons.push(`unexpected weight ${w} kg`); }
  return { result: fail ? 'FAIL' : unverified ? 'UNVERIFIED' : 'PASS', reasons };
}

export const sha256 = (b64) => crypto.createHash('sha256').update(Buffer.from(String(b64 || ''), 'base64')).digest('hex');

// ── 3. Which evidence belongs to this run ────────────────────────────────────
/** Only the approved pilot recordings: the scripted lines recorded on 19 Oct 2026 (IST). Never free-text lines. */
export function approvedSamples(samples, { date = '2026-10-19' } = {}) {
  const ist = (t) => new Date(new Date(t).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
  return (samples || []).filter(s => s && s.at && ist(s.at) === date && /^k\d+$/.test(String(s.phrase_id || '')));
}
/** Only this account's tries made during this run. */
export function scopeRuns(rows, { userId, since, before = new Set() }) {
  const t0 = new Date(since).getTime();
  return (rows || []).filter(r => r && r.user_id === userId && new Date(r.created_at).getTime() >= t0 - 1000 && !before.has(r.id));
}

// ── 4. Clean-up: only what this run added ────────────────────────────────────
/** JSON with keys sorted: the database returns object keys in its own order. */
export const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v));
/**
 * An entry as it means something: keys in any order, and empty (null) fields
 * left out. When a member's day is saved the app writes every entry back and
 * adds empty fields such as food_id: null to older ones; that is not a change
 * to the entry. Any real value (name, amount, grams, meal, nutrition) counts.
 */
export const entryOf = (f) => canon(f && typeof f === 'object' && !Array.isArray(f) ? Object.fromEntries(Object.entries(f).filter(([, v]) => v != null)) : f);
export const itemKey = (f) => (f && f.id != null ? `id:${f.id}` : `json:${entryOf(f)}`);
/** Items in `after` that were not in `before` (this save's additions). */
export function addedItems(before, after) {
  const left = new Map();
  for (const f of before || []) left.set(itemKey(f), (left.get(itemKey(f)) || 0) + 1);
  const out = [];
  for (const f of after || []) { const k = itemKey(f); if (left.get(k)) left.set(k, left.get(k) - 1); else out.push(f); }
  return out;
}
/** The day to write back: current items minus the ones this run created; the weight as it was. */
export function planCleanup(baseline, current, createdKeys) {
  const created = new Set(createdKeys);
  const food_items = (current?.food_items || []).filter(f => !created.has(itemKey(f)));
  return { food_items, weight_kg: baseline?.weight_kg ?? null, removed: (current?.food_items || []).filter(f => created.has(itemKey(f))).length };
}
/** After clean-up the day must equal the baseline: same items, same weight. */
export function verifyCleanup(baseline, after) {
  const problems = [];
  const b = (baseline?.food_items || []).map(entryOf).sort(), a = (after?.food_items || []).map(entryOf).sort();
  const missing = b.filter(x => !a.includes(x)), extra = a.filter(x => !b.includes(x));
  if (missing.length) problems.push(`${missing.length} entr${missing.length === 1 ? 'y' : 'ies'} from before the run changed or missing`);
  if (extra.length) problems.push(`${extra.length} entr${extra.length === 1 ? 'y' : 'ies'} left over`);
  const bw = baseline?.weight_kg == null ? null : Number(baseline.weight_kg), aw = after?.weight_kg == null ? null : Number(after.weight_kg);
  if (bw !== aw) problems.push(`weight ${aw ?? 'empty'} instead of ${bw ?? 'empty'}`);
  return { ok: problems.length === 0, problems };
}

// ── 5. The verdict ───────────────────────────────────────────────────────────
/**
 * Two separate answers:
 *   run      — did the robot collect complete, trustworthy evidence and leave
 *              the site as it found it?  (FAILED / INCOMPLETE / BLOCKED / COMPLETE)
 *   quality  — what the providers and the app actually did, per case
 *              (PASS / FAIL / UNVERIFIED). A poor transcript, accurately
 *              collected, is a quality FAIL, not a run failure. Never an acceptance.
 */
export function verdict(r) {
  const failures = [], incomplete = [];
  if (r.blocked) return { run: 'BLOCKED', failures: [r.blocked], incomplete, exitCode: 3 };
  const p1 = r.part1;
  if (!p1) incomplete.push('Kannada re-run not collected');
  else {
    if (p1.approved_count !== 2) incomplete.push(`expected the 2 approved 19 Oct recordings, found ${p1.approved_count}`);
    for (const s of p1.samples || []) {
      if (s.original_unchanged === false) failures.push(`original answers of ${s.phrase_id} changed`);
      if (!s.whisper_kn || s.whisper_kn.text == null) incomplete.push(`no Kannada re-run answer for ${s.phrase_id}${s.whisper_kn?.problem ? ` (${s.whisper_kn.problem})` : ''}`);
    }
    if (!p1.export_ok) incomplete.push('the results Excel export was not available');
  }
  const p2 = r.part2 || {};
  if (!p2.collected) incomplete.push('everyday fallback not collected');
  else {
    if ((p2.real || []).length !== 2 * (p1?.approved_count || 0)) incomplete.push(`real-recording tries: ${(p2.real || []).length} of ${2 * (p1?.approved_count || 0)}`);
    for (const c of p2.cases || []) {
      if (!c.collected) incomplete.push(`${c.id}: ${c.error || 'no server answer captured'}`);
      if (c.save_confirmed === false) failures.push(`${c.id}: the app did not confirm the save`);
      if (c.readback && c.readback.result !== 'PASS' && c.saved) failures.push(`${c.id}: saved entries do not match what was previewed (${c.readback.reasons.join('; ')})`);
      if (c.retry && !c.retry.identical) failures.push(`${c.id}: Retry did not re-send the identical recording`);
    }
    if (p2.scope_problem) failures.push(p2.scope_problem);
  }
  if (r.cleanup && !r.cleanup.ok) failures.push(`clean-up: ${r.cleanup.problems.join('; ')}`);
  if (r.switch_off && !r.switch_off.verified) failures.push(`voice backup switch NOT confirmed off (${r.switch_off.detail})`);
  for (const e of r.errors || []) failures.push(e);
  const run = failures.length ? 'FAILED' : incomplete.length ? 'INCOMPLETE' : 'COMPLETE';
  return { run, failures, incomplete, exitCode: run === 'COMPLETE' ? 0 : 1 };
}
