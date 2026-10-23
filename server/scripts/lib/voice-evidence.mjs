/**
 * scripts/lib/voice-evidence.mjs — the voice evidence robot's decisions (Fixes-2s, 2t, 2u).
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
  // Fixes-2v: S5 recipe v2. The voice is at 0.45 under the same pink noise (amplitude 0.5, seed 7), so the
  // voice in a recording can be verified (runs 1 and 2 used 0.12: too buried for any recording to prove its voice).
  { id: 'S5', lang: 'en-IN', voice: 'en-us', kind: 'noisy', voiceVolume: 0.45, recipe: 'S5 v2 (2v): voice 0.45 under pink noise 0.5, seed 7', say: 'Two idli, weight eighty two point five kilograms.',
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

// ── Fixes-2u: food-specific portion rules (first-run review, S3) ─────────────
// The app's parse prompt says "1 katori/bowl dal≈150g", and a member's own
// learned portions (GET /api/ai-chat/portions) come before any generic value.
// So "1 katori dal" previewed as "1 bowl dal" at the same estimate is accepted
// FOR DAL ONLY; katori and bowl are not equal for every food or every member.
// Units outside a family (a cup is not a bowl) still fail as before.
export const PORTION_RULES = Object.freeze([
  { food: 'dal', spoken: 'katori', shown: 'bowl', grams_each: 150, source: 'the app\'s parse prompt: "1 katori/bowl dal≈150g"' },
]);
const UNIT_FAMILIES = [['katori', 'bowl']];
const sameFamily = (a, b) => UNIT_FAMILIES.some(f => f.includes(a) && f.includes(b));
const FOOD_WORDS = { dal: /^(?:dal|daal|dhal)$/ };
/**
 * Fixes-2v (run-2 review, finding 3): the member's own learned grams for ONE
 * container of this food, e.g. "katori dal". Every matching row is read, never
 * just the first, so the answer cannot depend on the order the rows arrive in.
 * → { grams: n } when all matching rows agree, { conflict: [..] } when they
 *   disagree, or null when the member has no row for that container.
 */
export function memberContainerGrams(portions, food, unit) {
  const words = FOOD_WORDS[food]; if (!words || !Array.isArray(portions)) return null;
  const gs = portions.filter(p => { const [u, ...rest] = String(p?.phrase || '').toLowerCase().trim().split(/\s+/); return u === unit && words.test(rest.join(' ')); })
    .map(p => Number(p?.grams)).filter(g => Number.isFinite(g) && g > 0);
  if (!gs.length) return null;
  const set = [...new Set(gs)];
  return set.length === 1 ? { grams: set[0] } : { conflict: set.sort((a, b) => a - b) };
}
/**
 * The amounts that apply to the spoken container (katori) and the shown one
 * (bowl): the member's own learned value, else the app's generic default. The
 * alias is allowed only when the two applicable amounts are demonstrably equal.
 * → { ok: true, grams, basis } | { ok: false, result: 'FAIL'|'UNVERIFIED', reason }
 */
export function portionAlias(portions, rule) {
  const spoken = memberContainerGrams(portions, rule.food, rule.spoken), shown = memberContainerGrams(portions, rule.food, rule.shown);
  const name = (u) => `${u} ${rule.food}`;
  for (const [u, x] of [[rule.spoken, spoken], [rule.shown, shown]]) if (x?.conflict) return { ok: false, result: 'UNVERIFIED', reason: `the member has different learned sizes for "${name(u)}" (${x.conflict.join(' g, ')} g), so the amount cannot be settled` };
  if (spoken && shown) {
    if (spoken.grams !== shown.grams) return { ok: false, result: 'FAIL', reason: `the member's own "${name(rule.spoken)}" is ${spoken.grams} g but their "${name(rule.shown)}" is ${shown.grams} g: different sizes, so ${rule.spoken} and ${rule.shown} are not the same amount` };
    return { ok: true, grams: spoken.grams, basis: `the member's own ${name(rule.spoken)} and ${name(rule.shown)} (both ${spoken.grams} g)` };
  }
  if (spoken) return { ok: true, grams: spoken.grams, basis: `the member's own ${name(rule.spoken)} (${spoken.grams} g); the shown amount must equal it` };
  if (shown) {
    if (shown.grams === rule.grams_each) return { ok: true, grams: rule.grams_each, basis: `the member's own ${name(rule.shown)} (${shown.grams} g), equal to the ${rule.grams_each} g default for a ${rule.spoken}` };
    return { ok: false, result: 'UNVERIFIED', reason: `the member's own "${name(rule.shown)}" is ${shown.grams} g and they have no learned "${name(rule.spoken)}"; a learned ${rule.shown} does not define their ${rule.spoken}, so the equivalence is unresolved` };
  }
  return { ok: true, grams: rule.grams_each, basis: `the ${rule.grams_each} g default (${rule.source})` };
}
/** Kept for callers of Fixes-2u; now order-independent (the spoken container first, never "whichever row came first"). */
export function memberPortionGrams(portions, food, rule) {
  const a = portionAlias(portions, rule); return a.ok && a.basis.startsWith('the member') ? a.grams : null;
}

/**
 * Compare structured items (preview from the parse, or entries read back after
 * saving) with a case's expectation. PASS only when every expected food is
 * there with the right count and unit, nothing else is, and the weight matches.
 * opts.portions: the member's own learned portions (Fixes-2u, for PORTION_RULES).
 */
export function evaluateItems(expect, { foods = [], weight_kg = null } = {}, opts = {}) {
  const reasons = [], notes = []; let fail = false, unverified = false;
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
      else if (q.unit !== e.unit && sameFamily(q.unit, e.unit)) {
        const rule = PORTION_RULES.find(r => r.food === e.key && r.spoken === e.unit && r.shown === q.unit);
        if (!rule) { unverified = true; reasons.push(`${e.key}: ${q.unit} instead of ${e.unit}, and no portion rule maps these for ${e.key}`); }
        else {
          // Fixes-2v: spoken and shown containers resolved separately; conflicts fail, unresolved stays unverified.
          const a = portionAlias(opts.portions, rule);
          if (!a.ok) { if (a.result === 'FAIL') fail = true; else unverified = true; reasons.push(`${e.key}: shown as ${q.unit}, said ${e.unit}: ${a.reason}`); }
          else {
            const want = a.grams * e.n;
            const g = foods[i].grams == null || foods[i].grams === '' ? null : Number(foods[i].grams);
            if (g == null || !Number.isFinite(g)) { unverified = true; reasons.push(`${e.key}: shown as ${q.unit} with no grams, so the ${want} g portion cannot be checked`); }
            else if (Math.abs(g - want) > 0.5) { fail = true; reasons.push(`${e.key}: ${q.n} ${q.unit} at ${g} g, not ${want} g (${a.basis})`); }
            else notes.push(`${e.key}: said "${e.n} ${e.unit}", shown "${q.n} ${q.unit}" at ${g} g — accepted by the dal portion rule using ${a.basis}; an app estimate, not a measurement of the member's bowl`);
          }
        }
      }
      else if (q.unit !== e.unit) { fail = true; reasons.push(`${e.key}: ${q.unit} instead of ${e.unit}`); }
    }
  }
  foods.forEach((f, k) => { if (!used.has(k)) { fail = true; reasons.push(`unexpected ${f.name}`); } });
  const w = weight_kg == null || weight_kg === '' ? null : Number(weight_kg);
  if (expect.weight != null) {
    if (w == null) { fail = true; reasons.push(`weight missing (expected ${expect.weight} kg)`); }
    else if (Math.abs(w - expect.weight) > 1e-6) { fail = true; reasons.push(`weight ${w} kg instead of ${expect.weight} kg`); }
  } else if (w != null) { fail = true; reasons.push(`unexpected weight ${w} kg`); }
  return { result: fail ? 'FAIL' : unverified ? 'UNVERIFIED' : 'PASS', reasons, notes };
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
// ── 3b. What a Save may change (Fixes-2t) ───────────────────────────────────
/**
 * The parse result is everything the app's Save would apply: water, sleep,
 * activities, ACV, supplements, notes, corrections to earlier entries,
 * workouts, foods, weight. The robot allows ONLY the expected new foods (and
 * the weight where it was said). Any other change → FAIL, never saved.
 * Fields the robot does not recognise, or something heard but not included,
 * → UNVERIFIED, never saved.
 */
const KNOWN_PARSE_KEYS = new Set(['advice', 'reply', 'weight_kg', 'activities', 'acv', 'supplements', 'water_ml_add', 'sleep', 'unresolved_sleep', 'notes', 'foods',
  'unresolved_foods', 'corrections', 'workouts', 'totals', 'aiProvider', 'aiModel', 'question', 'mixed_question', 'mixed_answer', 'coach_message', 'sent_to_coach', 'draft_edit']);
const filled = (v) => (Array.isArray(v) ? v.length > 0 : v && typeof v === 'object' ? Object.values(v).some(filled) : v != null && v !== '' && v !== false && v !== 0);
export function unexpectedChanges(parsed = {}) {
  const changes = [];
  if (Number(parsed.water_ml_add) > 0) changes.push(`water +${parsed.water_ml_add} ml`);
  for (const k of ['activities', 'acv', 'supplements', 'corrections', 'workouts']) if (filled(parsed[k])) changes.push(`${k} (${parsed[k].length})`);
  if (parsed.sleep && (parsed.sleep.bedtime || parsed.sleep.waketime)) changes.push('sleep');
  if (typeof parsed.notes === 'string' && parsed.notes.trim()) changes.push('notes');
  if (parsed.sent_to_coach) changes.push('a message sent to the coach');
  if (filled(parsed.draft_edit)) changes.push('an edit to an earlier draft');
  const unknown = Object.keys(parsed).filter(k => !KNOWN_PARSE_KEYS.has(k) && filled(parsed[k]));
  const unresolved = filled(parsed.unresolved_foods) || parsed.unresolved_sleep === true;
  return { changes, unknown, unresolved };
}
/** The whole preview: the expected items AND nothing else that Save would apply. */
export function evaluatePreview(expect, parsed = {}, opts = {}) {
  const base = evaluateItems(expect, { foods: parsed.foods || [], weight_kg: parsed.weight_kg ?? null }, opts);
  const u = unexpectedChanges(parsed);
  let result = base.result; const reasons = [...base.reasons];
  if (u.changes.length) { result = 'FAIL'; reasons.push(...u.changes.map(c => `unexpected change: ${c}`)); }
  if (result !== 'FAIL' && u.unknown.length) { result = 'UNVERIFIED'; reasons.push(`unrecognised field(s): ${u.unknown.join(', ')}`); }
  if (result !== 'FAIL' && u.unresolved) { result = 'UNVERIFIED'; reasons.push('something was heard but not included'); }
  return { result, reasons, notes: base.notes };
}

// ── 3c. Outcomes that are not a preview (Fixes-2u) ──────────────────────────
/** An explicit refusal (HTTP 200, no words, a reason). */
export function judgeRefusal(spec) {
  if (spec.expect?.refused) return { result: 'PASS', reasons: ['refused as expected'] };
  if (spec.refusalAllowed) return spec.id === 'S5' ? { result: 'PASS', reasons: ['refused (allowed; nothing recognised to check)'] } : { result: 'UNVERIFIED', reasons: ['refused (allowed; nothing recognised to check)'] };
  return { result: 'FAIL', reasons: ['refused clear speech'] };
}
/**
 * The transcript was accepted and the AI answered in chat with no new log card
 * (first run, S4: "Nothing new to log there…"). A real outcome, recorded with
 * the reply, but never a refusal and never a pass for a case that expected one.
 */
export function judgeChatReply(spec) {
  if (spec.expect?.refused) return { result: 'FAIL', reasons: ['the recording should have been refused; words were accepted and the AI answered in chat instead (a chat reply is not a refusal)'] };
  return { result: 'FAIL', reasons: ['no preview: the AI answered in chat instead of showing the items'] };
}

// ── 4b. The whole day, as Save can change it (Fixes-2t) ─────────────────────
const noNulls = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.entries(o).filter(([, v]) => v != null)) : {});
/**
 * Fixes-2u: the app's own "no sleep recorded" value. A day the member has never
 * saved loads as {bedtime:'', waketime:'', quality:0} (client emptyLog / mapServerLog),
 * and any save writes that back; the coach view shows quality 0 as "—". For
 * comparison ONLY that exact template (and {}) counts as empty: real times, a
 * non-zero quality or any other field are compared as they are. Raw values are kept.
 */
export const BLANK_SLEEP = Object.freeze({ bedtime: '', waketime: '', quality: 0 });
export function isBlankSleep(s) {
  if (s == null) return true;
  if (typeof s !== 'object' || Array.isArray(s)) return false;
  const o = noNulls(s), k = Object.keys(o);
  return k.length === 0 || (k.length === 3 && o.bedtime === '' && o.waketime === '' && o.quality === 0);
}
/** Every field of the day a permitted Save can reach, normalised for comparison (raw sleep kept as sleep_raw). */
export function daySnapshot(d = {}) {
  return {
    food_items: JSON.parse(JSON.stringify(d.food_items || [])),
    weight_kg: d.weight_kg == null || d.weight_kg === '' ? null : Number(d.weight_kg),
    water_ml: Number(d.water_ml) || 0,
    sleep: isBlankSleep(d.sleep) ? {} : noNulls(d.sleep), activities: noNulls(d.activities), acv: noNulls(d.acv), supplements: noNulls(d.supplements),
    notes: typeof d.notes === 'string' ? d.notes : '',
    sleep_raw: d.sleep === undefined ? null : JSON.parse(JSON.stringify(d.sleep)),
  };
}
/** A note when the blank-sleep rule made two different raw values compare equal (for the report). */
export function sleepNormalisation(before, after) {
  const rb = canon(noNulls(before?.sleep_raw)), ra = canon(noNulls(after?.sleep_raw));
  if (rb === ra || canon(before?.sleep) !== canon(after?.sleep)) return null;
  return `sleep: the app's blank template {bedtime:'', waketime:'', quality:0} was treated as empty (raw ${rb} → ${ra}); no real sleep value changed`;
}
/**
 * Fixes-2u: read-back after a save, with the two different failures kept apart:
 * the saved items differ from their preview, or an unrelated day field changed.
 */
export function readbackResult(expect, { created = [], weight_kg = null, lost = [], unrelated = [] } = {}, opts = {}) {
  const items = evaluateItems(expect, { foods: created, weight_kg }, opts);
  const extra = [...lost.map(f => `earlier entry changed or removed: ${f.name}`), ...unrelated];
  const result = items.result !== 'PASS' ? items.result : extra.length ? 'FAIL' : 'PASS';
  return { result, items, unrelated: extra, reasons: [...items.reasons, ...extra.map(x => `also changed: ${x}`)], notes: items.notes };
}
const counts = (list) => { const m = new Map(); for (const f of list || []) { const k = entryOf(f); m.set(k, (m.get(k) || 0) + 1); } return m; };
/** Entries of `a` missing from `b`, counting duplicates (two identical entries are two). */
export function missingEntries(a, b) {
  const have = counts(b); const out = [];
  for (const f of a || []) { const k = entryOf(f); if (have.get(k)) have.set(k, have.get(k) - 1); else out.push(f); }
  return out;
}
/** Fields other than the food list that differ between two snapshots. */
export function changedFields(before, after, { except = [] } = {}) {
  const out = [];
  for (const k of ['weight_kg', 'water_ml', 'sleep', 'activities', 'acv', 'supplements', 'notes']) {
    if (except.includes(k)) continue;
    if (canon(before[k]) !== canon(after[k])) out.push(`${k} ${canon(before[k])} → ${canon(after[k])}`);
  }
  return out;
}
/**
 * The day to write back: the current entries minus exactly the ones this run
 * created (one per recorded creation, newest first, so an identical earlier
 * entry survives), and every other field as it was before the run.
 */
export function planCleanup(baseline, current, createdKeys) {
  const want = new Map(); for (const k of createdKeys || []) want.set(k, (want.get(k) || 0) + 1);
  const items = [...(current?.food_items || [])], kept = []; let removed = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    const k = itemKey(items[i]);
    if (want.get(k)) { want.set(k, want.get(k) - 1); removed++; } else kept.unshift(items[i]);
  }
  const b = daySnapshot(baseline);
  // Sleep goes back exactly as it was (the raw value; the blank template stays the template).
  const sleep = b.sleep_raw && typeof b.sleep_raw === 'object' && !Array.isArray(b.sleep_raw) ? noNulls(b.sleep_raw) : b.sleep;
  return { food_items: kept, removed, weight_kg: b.weight_kg, water_ml: b.water_ml, sleep, activities: b.activities, acv: b.acv, supplements: b.supplements, notes: b.notes };
}
/** After clean-up the whole day must equal the baseline, duplicates counted. */
export function verifyCleanup(baseline, after) {
  const b = daySnapshot(baseline), a = daySnapshot(after), problems = [];
  const missing = missingEntries(b.food_items, a.food_items), extra = missingEntries(a.food_items, b.food_items);
  if (missing.length) problems.push(`${missing.length} entr${missing.length === 1 ? 'y' : 'ies'} from before the run changed or missing`);
  if (extra.length) problems.push(`${extra.length} entr${extra.length === 1 ? 'y' : 'ies'} left over`);
  problems.push(...changedFields(b, a).map(x => x.replace(/^weight_kg /, 'weight ')));
  return { ok: problems.length === 0, problems };
}

// ── 4c. Did the intended sound reach the recording? (Fixes-2u) ─────────────
// First run, S5: Whisper heard nothing of what was played, and nothing showed
// whether the sound ever reached the app's recording. A different hash or a
// plausible length proves nothing. Now the ACTUAL uploaded recording is decoded
// and compared with the source sound: their loudness envelopes (20 ms frames,
// dB, floor -60) must line up (Pearson r >= 0.6 at the best delay, 0-4 s late
// or up to 0.5 s early) over at least 90% of the source's sounding part, where the recording must be sounding too. Silence
// must arrive as silence. Transcoding changes bytes, not the envelope.
const FLOOR_DB = -60;
/** Loudness per frame (dB, clamped at -60) of 16 kHz mono samples. */
export function envelopeDb(pcm, rate = 16000, frameMs = 20) {
  const n = Math.round(rate * frameMs / 1000), out = [];
  for (let i = 0; i + n <= pcm.length; i += n) {
    let e = 0; for (let j = 0; j < n; j++) { const v = pcm[i + j] / 32768; e += v * v; }
    const db = e > 0 ? 10 * Math.log10(e / n) : -120; out.push(Math.max(FLOOR_DB, db));
  }
  return out;
}
const pearson = (a, b) => {
  const n = Math.min(a.length, b.length); if (n < 5) return null;
  let sa = 0, sb = 0; for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n; let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : null;
};
/**
 * source / captured: { env (envelopeDb), duration_ms, speech (speechPresence.analyse) }.
 * → { valid, reasons, correlation, lag_ms, coverage }
 */
export function captureCheck({ source, captured, kind, voice, noise } = {}) {
  if (!captured || !Array.isArray(captured.env) || !captured.env.length) return { valid: false, reasons: ['no captured recording to check'], correlation: null, lag_ms: null, coverage: 0 };
  const loud = (env) => env.some(x => x > -45);
  if (kind === 'silence') {
    const ok = !loud(captured.env) && !(captured.speech && captured.speech.speech);
    return { valid: ok, reasons: ok ? ['silence was played and silence was captured'] : ['silence was played but the recording has sound in it'], correlation: null, lag_ms: null, coverage: ok ? 1 : 0 };
  }
  const s = source?.env || [];
  const active = s.map((x, i) => (x > -45 ? i : -1)).filter(i => i >= 0);
  if (!active.length) return { valid: false, reasons: ['the source sound is silent (nothing to compare)'], correlation: null, lag_ms: null, coverage: 0 };
  const first = active[0], last = active[active.length - 1];
  let best = { r: -2, lag: 0 };
  for (let lag = -25; lag <= 200; lag++) {            // frames of 20 ms: -0.5 s … +4 s
    const a = [], b = [];
    for (let i = 0; i < s.length; i++) { const j = i + lag; if (j >= 0 && j < captured.env.length) { a.push(s[i]); b.push(captured.env[j]); } }
    const r = pearson(a, b); if (r != null && r > best.r) best = { r, lag };
  }
  // Covered = the capture is actually SOUNDING where the source sounds (its own level: within 40 dB of its peak).
  const capPeak = Math.max(...captured.env), capOn = Math.max(-58, capPeak - 40);
  const covered = active.filter(i => { const j = i + best.lag; return j >= 0 && j < captured.env.length && captured.env[j] > capOn; }).length / active.length;
  const reasons = [];
  if (best.r < 0.6) reasons.push(`the recording does not follow the source sound (best match r = ${best.r < -1 ? 'none' : best.r.toFixed(2)})`);
  if (covered < 0.9) reasons.push(`the recording carries only ${Math.round(covered * 100)}% of the source sound (it stopped early, started late or went quiet)`);
  if (!reasons.length) reasons.push(`the recording follows the source sound (r = ${best.r.toFixed(2)}, ${best.lag * 20} ms later, ${Math.round(covered * 100)}% covered)`);
  let valid = best.r >= 0.6 && covered >= 0.9, voiceCheck = null;
  // Fixes-2v: for a sound with a background, the envelope can match on the noise alone; the voice itself must be shown.
  if (kind === 'noisy') {
    voiceCheck = voiceComponentCheck({ source: source?.pcm, voice: voice?.pcm, noise: noise?.pcm, captured: captured?.pcm, lagSamples: best.lag * 320 });
    if (!voiceCheck.valid) { valid = false; reasons.push(...voiceCheck.reasons); } else reasons.push(...voiceCheck.reasons);
  }
  return { valid, reasons, correlation: best.r < -1 ? null : Number(best.r.toFixed(3)), lag_ms: best.lag * 20, coverage: Number(covered.toFixed(3)),
    source_span_ms: (last - first + 1) * 20, voice_check: voiceCheck };
}

// ── 4e. Did the VOICE reach the recording, not just the noise? (Fixes-2v) ───
// Run-2 review, finding 2: S5's loudness envelope is dominated by its loud
// background, so a capture of the background alone (no voice) matched the
// source better (r = 0.998) than the real upload. The envelope check cannot see
// the voice. This check compares the recording with the source in the places
// where the VOICE dominates: short-time spectra (512-point frames, 32 ms, half
// overlap, 150-4000 Hz); a time-frequency point is a voice marker when the
// voice track alone is at least 6 dB above the noise track alone there. In those
// points a faithful recording carries the voice's extra energy above the noise;
// the noise alone does not. score = (recording − noise) / (source − noise),
// averaged over the markers, after levelling the recording on noise-dominated
// points. ≈ 1: the voice is there; ≈ 0: only the noise.
// When a source has too few markers (the voice is buried too deep, like the
// 0.12-level S5 recipe of runs 1 and 2: 156 points), no recording can prove its
// voice: the capture is INVALID ("not verifiable"), never valid.
export const VOICE_CHECK = Object.freeze({ N: 512, HOP: 256, LO_HZ: 150, HI_HZ: 4000, MARKER_DB: 6, MIN_MARKERS: 500, MIN_FRAMES: 40, MIN_SCORE: 0.7 });
function fftMag2(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}
/** Short-time spectra in dB of 16 kHz samples (Int16Array or numbers in −32768…32767): frames × bins. */
export function spectraDb(pcm, rate = 16000) {
  const { N, HOP } = VOICE_CHECK, w = Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
  const out = [];
  for (let s = 0; s + N <= pcm.length; s += HOP) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = (pcm[s + i] / 32768) * w[i];
    fftMag2(re, im);
    const row = new Float64Array(N / 2 + 1);
    for (let k = 0; k <= N / 2; k++) row[k] = 10 * Math.log10(re[k] * re[k] + im[k] * im[k] + 1e-10);
    out.push(row);
  }
  return out;
}
const median = (a) => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
/**
 * source, voice, noise, captured: 16 kHz sample arrays (voice + noise = source).
 * lagSamples: how late the recording is (from the envelope match).
 * → { verifiable, valid, score, markers, marker_frames, gain_db, reasons }
 */
export function voiceComponentCheck({ source, voice, noise, captured, lagSamples = 0, rate = 16000 } = {}) {
  const C = VOICE_CHECK;
  if (!source || !voice || !noise || !captured) return { verifiable: false, valid: false, score: null, markers: 0, reasons: ['no separate voice and noise tracks for this sound, so the voice in the recording cannot be verified'] };
  const n = Math.min(source.length, voice.length, noise.length);
  const cap = new Float64Array(n);
  for (let i = 0; i < n; i++) { const j = i + lagSamples; cap[i] = j >= 0 && j < captured.length ? captured[j] : 0; }
  const S = spectraDb(source.subarray ? source.subarray(0, n) : source.slice(0, n), rate), V = spectraDb(voice.subarray ? voice.subarray(0, n) : voice.slice(0, n), rate),
    Z = spectraDb(noise.subarray ? noise.subarray(0, n) : noise.slice(0, n), rate), R = spectraDb(cap, rate);
  const binHz = rate / C.N, k0 = Math.ceil(C.LO_HZ / binHz), k1 = Math.floor(C.HI_HZ / binHz);
  const markers = [], noiseBins = []; const frames = new Set();
  for (let t = 0; t < S.length; t++) for (let k = k0; k <= k1; k++) {
    if (V[t][k] - Z[t][k] >= C.MARKER_DB && V[t][k] > -60) { markers.push([t, k]); frames.add(t); }
    else if (Z[t][k] - V[t][k] >= C.MARKER_DB && Z[t][k] > -60) noiseBins.push([t, k]);
  }
  if (markers.length < C.MIN_MARKERS || frames.size < C.MIN_FRAMES)
    return { verifiable: false, valid: false, score: null, markers: markers.length, marker_frames: frames.size,
      reasons: [`the voice in this sound is buried too deep to verify in any recording (${markers.length} voice-dominated points in ${frames.size} frames; at least ${C.MIN_MARKERS} in ${C.MIN_FRAMES} needed)`] };
  // Level the recording on noise-dominated points (a recorder may be louder or quieter); none (no noise) → 0 dB.
  const gain = noiseBins.length >= 200 ? Math.max(-20, Math.min(20, median(noiseBins.map(([t, k]) => R[t][k] - S[t][k])))) : 0;
  let exp = 0, got = 0;
  for (const [t, k] of markers) { const ref = Math.max(Z[t][k], -60); exp += S[t][k] - ref; got += (R[t][k] - gain) - ref; }
  const score = exp > 0 ? got / exp : 0;
  const ok = score >= C.MIN_SCORE;
  return { verifiable: true, valid: ok, score: Number(score.toFixed(3)), markers: markers.length, marker_frames: frames.size, gain_db: Number(gain.toFixed(2)),
    reasons: [ok ? `the voice itself is in the recording (voice check ${score.toFixed(2)} over ${markers.length} voice-dominated points)`
      : `the recording does not carry the voice (voice check ${score.toFixed(2)} over ${markers.length} voice-dominated points; at least ${C.MIN_SCORE} needed): it holds the background, not the speech`] };
}

// ── 4d. Names never leave the robot (Fixes-2u, first-run review item 7) ─────
// The first run's admin screenshot showed members' names and went into a public
// artifact. Every output is now checked against the names the admin can see.
const escRe = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A name of several words matches in any case; a one-word name only as written
 * (a member called "Test" must not turn the report's word "test" into "[member]"). */
export function nameRe(n) { return new RegExp(`\\b${escRe(n)}\\b`, /\s/.test(n) ? 'gi' : 'g'); }
/** Names to watch: unique, 2+ characters, longest first, the robot's own account excluded. */
export function nameList(names, own) {
  return [...new Set((names || []).map(n => String(n || '').trim()).filter(n => n.length >= 2 && n !== own))].sort((a, b) => b.length - a.length);
}
/** Replace every listed name with "[member]". → { text, hits } */
export function redactNames(t, names) {
  let out = String(t); let hits = 0;
  for (const n of names || []) out = out.replace(nameRe(n), () => { hits++; return '[member]'; });
  return { text: out, hits };
}

// ── 5. The verdict ───────────────────────────────────────────────────────────
/**
 * Two separate answers:
 *   run      — did the robot collect complete, trustworthy evidence and leave
 *              the site as it found it?  (FAILED / INCOMPLETE / BLOCKED / COMPLETE)
 *   quality  — what the providers and the app actually did, per case
 *              (PASS / FAIL / UNVERIFIED). A poor transcript, accurately
 *              collected, is a quality FAIL, not a run failure. Never an acceptance.
 * Fixes-2t: every expected case must pass through each of its stages —
 * transcription; a preview or an EXPLICIT refusal (an HTTP or provider error
 * is not a refusal); a quality judgement; then save + read-back, or a verified
 * no-save; Retry where required. An error at any stage keeps the run from COMPLETE.
 */
export function verdict(r) {
  const failures = [], incomplete = [];
  if (r.blocked) return { run: 'BLOCKED', failures: [r.blocked], incomplete, exitCode: 3 };
  // Fixes-2v: a TARGETED run (scope: listed cases only) repeats just those cases; Part 1 and the real recordings are not repeated.
  const scope = Array.isArray(r.scope?.cases) && r.scope.cases.length ? r.scope.cases : null;
  const p1 = r.part1;
  if (scope) { if (p1) incomplete.push('a targeted run must not repeat the Kannada re-run'); }
  else if (!p1) incomplete.push('Kannada re-run not collected');
  else {
    if (p1.approved_count !== 2) incomplete.push(`expected the 2 approved 19 Oct recordings, found ${p1.approved_count}`);
    for (const s of p1.samples || []) {
      if (s.original_unchanged === false) failures.push(`original answers of ${s.phrase_id} changed`);
      // An EMPTY answer ('' — Whisper replied with no words) is evidence of a recognition failure, not missing collection.
      if (!s.whisper_kn || s.whisper_kn.text == null) incomplete.push(`no Kannada re-run answer for ${s.phrase_id}${s.whisper_kn?.problem ? ` (${s.whisper_kn.problem})` : ''}`);
    }
    if (p1.unapproved_touched?.length) failures.push(`re-run reached unapproved recording(s): ${p1.unapproved_touched.join(', ')}`);
    if (!p1.export_ok) incomplete.push('the results Excel export was not available');
  }
  const p2 = r.part2 || {};
  if (!p2.collected) incomplete.push('everyday fallback not collected');
  else {
    const want = scope ? 0 : 2 * (p1?.approved_count || 0);
    if ((p2.real || []).length !== want) incomplete.push(`real-recording tries: ${(p2.real || []).length} of ${want}`);
    for (const t of p2.real || []) if (t.status !== 200 || (!t.transcript && !t.rejected)) incomplete.push(`real recording ${t.phrase_id} (${t.voice_language}): ${t.status !== 200 ? `HTTP ${t.status}` : 'empty answer without a reason'} — not a refusal`);
    const byId = new Map((p2.cases || []).map(c => [c.id, c]));
    if (scope) for (const c of p2.cases || []) if (!scope.includes(c.id)) failures.push(`${c.id} ran outside the targeted scope (${scope.join(', ')})`);
    for (const spec of CASES.filter(x => !scope || scope.includes(x.id))) {
      const c = byId.get(spec.id);
      if (!c) { incomplete.push(`${spec.id}: case missing`); continue; }
      // Fixes-2u: a case whose every attempt had an INVALID capture has no evidence; it is excluded from the quality totals.
      if (c.invalid) { incomplete.push(`${spec.id}: capture INVALID on every attempt (${(c.invalid_reasons || []).join('; ')}) — no valid evidence; not counted in the quality totals`); continue; }
      if (c.error) incomplete.push(`${spec.id}: ${c.error}${c.transcribed ? ' (after transcription)' : ''}`);
      if (!c.transcribed) { if (!c.error) incomplete.push(`${spec.id}: no transcription answer`); continue; }
      if (c.outcome === 'error') { incomplete.push(`${spec.id}: ${c.status !== 200 ? `HTTP ${c.status}` : 'empty answer without a reason'} — a provider error, not a refusal`); continue; }
      if (c.outcome === 'chat_reply' && c.reply == null) { incomplete.push(`${spec.id}: the AI's chat reply was not recorded`); continue; }
      if (!['preview', 'refused', 'chat_reply'].includes(c.outcome)) { incomplete.push(`${spec.id}: no preview, no chat reply and no explicit refusal`); continue; }
      if (!c.quality) incomplete.push(`${spec.id}: no quality judgement`);
      const mustSave = c.outcome === 'preview' && spec.save && c.quality === 'PASS';
      if (mustSave) {
        if (c.save_confirmed === false) failures.push(`${spec.id}: the app did not confirm the save`);
        else if (c.save_confirmed !== true) incomplete.push(`${spec.id}: save not completed`);
        // Fixes-2u: the two different read-back failures are reported apart.
        if (c.readback) {
          const items = c.readback.items || { result: c.readback.result, reasons: c.readback.reasons || [] };
          if (items.result !== 'PASS') failures.push(`${spec.id}: saved items differ from their preview (${items.reasons.join('; ')})`);
          if (c.readback.items && c.readback.unrelated?.length) failures.push(`${spec.id}: an unrelated day field changed (${c.readback.unrelated.join('; ')})`);
        } else if (c.save_confirmed !== false) incomplete.push(`${spec.id}: no read-back`);
      } else if (c.no_save_verified === false) failures.push(`${spec.id}: the day changed although nothing was saved (${(c.no_save_detail || []).join('; ')})`);
      else if (c.no_save_verified !== true) incomplete.push(`${spec.id}: not verified that nothing was saved`);
      if (spec.retry && c.outcome === 'refused') {
        if (!c.retry) incomplete.push(`${spec.id}: Retry not exercised`);
        else if (!c.retry.identical) failures.push(`${spec.id}: Retry did not re-send the identical recording`);
      }
    }
    if (p2.scope_problem) failures.push(p2.scope_problem);
  }
  if (r.cleanup && !r.cleanup.ok) failures.push(`clean-up: ${r.cleanup.problems.join('; ')}`);
  if (r.switch_off && !r.switch_off.verified) failures.push(`voice backup switch NOT confirmed off (${r.switch_off.detail})`);
  for (const e of r.errors || []) failures.push(e);
  // Fixes-2v: the last gate before publishing. A picture with a name in it is a failure even though it was removed.
  // Fixes-2w: the publication check labels each removal; 'unchecked' (no OCR, no name list, or an OCR read that
  // did not complete) is INCOMPLETE, never a pass. Entries without a label keep the 2v reading of the reason.
  for (const x of r.publication?.removed || []) ((x.kind ? x.kind === 'identifying' : /OCR read|workbook held/.test(x.reason)) ? failures : incomplete).push(`evidence file ${x.file} removed before publishing: ${x.reason}`);
  if (r.publication && r.publication.complete === false && !(r.publication.removed || []).some(x => x.kind === 'unchecked')) incomplete.push('publication check did not complete for every picture');
  const run = failures.length ? 'FAILED' : incomplete.length ? 'INCOMPLETE' : 'COMPLETE';
  return { run, failures, incomplete, exitCode: run === 'COMPLETE' ? 0 : 1 };
}
