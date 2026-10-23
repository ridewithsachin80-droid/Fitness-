/**
 * services/voiceCalibration.js — Fixes-2x: the voice calibration kit (B18/B19), TEST SERVER ONLY.
 *
 * Round 1 of the calibration plan (claude/FitLife-Voice-Calibration-Plan-2026-10-23.md):
 *   Part A  does the live speech check refuse real speech (missed speech) or accept
 *           non-speech, on real phones? And at six candidate settings, computed
 *           OFFLINE from each take's stored raw measurements with the live check's own
 *           decision function (services/speechPresence.decide) — the live server keeps 200 ms.
 *   Part B  which words, numbers and units does each engine keep, miss or get wrong?
 *   Part C  the everyday logging path end to end (32 planned tries), with the engine
 *           that ACTUALLY answered each try recorded (a "Gemini" try Whisper answered is shown).
 *
 * Bounds fixed in code: 6 volunteers (3 Kannada, 2 Hindi, 1 English), 144 planned
 * recording slots (28 / 22 / 16 each), 6 offline settings, 32 Part C tries.
 * Nothing here changes what a member gets from everyday voice logging.
 *
 * Every take is kept: a retake needs a reason and never replaces the earlier take
 * (which stays, marked superseded). Every engine call is recorded with what was asked
 * and what answered (model requested and reported, attempts, language, prompt hash).
 * A language's lines cannot be recorded until a fluent speaker's check of the exact
 * wording is recorded; changing a line's text voids that check (its hash changes).
 */
const crypto = require('crypto');
const axios = require('axios');
const SP = require('./speechPresence');
const fallbackTest = require('./voiceFallbackTest');
const { voiceTranscriptionPrompt, whisperTranscriptionPrompt, whisperFallbackSettings, reviewWhisper, generatedText } = require('./voiceLanguage');
const { kannadaToLatin, reason: providerReason } = require('./voicePilot');

const CONSENT_VERSION = 'calibration-v1';
/** The script is frozen for round 1: changing any line voids that language's fluent-speaker check (scriptSha). */
const SCRIPT_VERSION = 'round1-script-v1';
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ── The script ───────────────────────────────────────────────────────────────
// items: what is scored in a transcript. kind 'count' (number [unit] food), 'weight'
// (number + kg; pounds are a wrong unit), 'presence' (the food word is heard).
// unitAlias: a container the accepted dal rule treats as the same family (katori/bowl).
// word: the spoken Kannada number word, for the number-word table.
const LINES = {
  e01: { lang: 'en', say: 'Two idli, one bowl sambar, weight eighty two point five kilos', means: '2 idli, 1 bowl sambar, weight 82.5 kg',
    items: [{ kind: 'count', label: '2 idli', n: 2, food: 'idli' }, { kind: 'count', label: '1 bowl sambar', n: 1, unit: 'bowl', food: 'sambar' }, { kind: 'weight', label: 'weight 82.5 kg', n: 82.5 }] },
  e02: { lang: 'en', say: 'Three chapati and one katori dal for lunch', means: '3 chapati, 1 katori dal',
    items: [{ kind: 'count', label: '3 chapati', n: 3, food: 'chapati' }, { kind: 'count', label: '1 katori dal', n: 1, unit: 'katori', unitAlias: 'bowl', food: 'dal' }] },
  e03: { lang: 'en', say: 'Walked forty minutes and drank two litres of water', means: 'walk 40 min, 2 litres water',
    items: [{ kind: 'count', label: 'walk 40 min', n: 40, unit: 'minute' }, { kind: 'count', label: '2 litres water', n: 2, unit: 'litre', food: 'water' }] },
  k01: { lang: 'kn', say: 'Belagge eradu idli mattu ondu bowl sambar thinde', means: 'This morning I ate two idli and a bowl of sambar',
    items: [{ kind: 'count', label: '2 idli', n: 2, food: 'idli', word: 'eradu' }, { kind: 'count', label: '1 bowl sambar', n: 1, unit: 'bowl', food: 'sambar', word: 'ondu' }] },
  k02: { lang: 'kn', say: 'Breakfast-ge ondu plate upma, ondu cup coffee', means: 'For breakfast, a plate of upma and a cup of coffee',
    items: [{ kind: 'count', label: '1 plate upma', n: 1, unit: 'plate', food: 'upma', word: 'ondu' }, { kind: 'count', label: '1 cup coffee', n: 1, unit: 'cup', food: 'coffee', word: 'ondu' }] },
  k04: { lang: 'kn', say: 'Lunch-ge eradu chapati, ondu katori dal mattu mosaru', means: 'For lunch, two chapati, a katori of dal and curd',
    items: [{ kind: 'count', label: '2 chapati', n: 2, food: 'chapati', word: 'eradu' }, { kind: 'count', label: '1 katori dal', n: 1, unit: 'katori', unitAlias: 'bowl', food: 'dal', word: 'ondu' }, { kind: 'presence', label: 'curd', food: 'curd' }] },
  k06: { lang: 'kn', say: 'Ivattu mooru litre neeru kudide', means: 'I drank three litres of water today',
    items: [{ kind: 'count', label: '3 litres water', n: 3, unit: 'litre', food: 'water', word: 'mooru' }] },
  k11: { lang: 'kn', say: 'Ivattu belagge nanna tooka eppattu eradu point aidu kg', means: 'My weight this morning is 72.5 kg',
    items: [{ kind: 'weight', label: 'weight 72.5 kg', n: 72.5, word: 'eppattu eradu point aidu' }] },
  k13: { lang: 'kn', say: 'Gym-alli squat mooru set, hattu reps maadide', means: 'At the gym, squats: three sets of ten',
    items: [{ kind: 'presence', label: 'squats', food: 'squat' }, { kind: 'count', label: '3 sets', n: 3, unit: 'set', word: 'mooru' }, { kind: 'count', label: '10 reps', n: 10, unit: 'rep', word: 'hattu' }] },
  h01: { lang: 'hi', say: 'Do roti aur ek katori dal khaya', means: '2 roti, 1 katori dal',
    items: [{ kind: 'count', label: '2 roti', n: 2, food: 'roti' }, { kind: 'count', label: '1 katori dal', n: 1, unit: 'katori', unitAlias: 'bowl', food: 'dal' }] },
  h02: { lang: 'hi', say: 'Subah ek glass doodh aur do ande khaye', means: '1 glass milk, 2 eggs',
    items: [{ kind: 'count', label: '1 glass milk', n: 1, unit: 'glass', food: 'milk' }, { kind: 'count', label: '2 eggs', n: 2, food: 'egg' }] },
  h03: { lang: 'hi', say: 'Aaj mera wazan bayaasi point paanch kilo hai', means: 'weight 82.5 kg',
    items: [{ kind: 'weight', label: 'weight 82.5 kg', n: 82.5 }] },
  // Short lines (about half a second of speech), one per language.
  sk1: { lang: 'kn', say: 'Eradu idli', means: '2 idli (short)', items: [{ kind: 'count', label: '2 idli', n: 2, food: 'idli', word: 'eradu' }] },
  sh1: { lang: 'hi', say: 'Do roti', means: '2 roti (short)', items: [{ kind: 'count', label: '2 roti', n: 2, food: 'roti' }] },
  se1: { lang: 'en', say: 'Two idli', means: '2 idli (short)', items: [{ kind: 'count', label: '2 idli', n: 2, food: 'idli' }] },
};
const CONTROLS = {
  x01: { say: 'Stay silent for 6 seconds, phone on the table', means: 'silence (no speech)' },
  x02: { say: 'Record 6 seconds of the room as it is (fan, kitchen, TV or road); nobody speaks to the phone', means: 'background alone (no speech)' },
  x03: { say: 'Record 6 seconds of non-speech sounds: tapping, utensils or a clap', means: 'non-speech sounds (no speech)' },
};
const PLACES = { q: 'quiet', n: 'everyday noise' };
const LANG_HINT = { kn: 'kn-IN', hi: 'hi-IN', en: 'en-IN' };
const LANG_NAME = { kn: 'Kannada', hi: 'Hindi', en: 'English' };
const GROUPS = { kn: { quota: 3, name: 'Kannada speaker' }, hi: { quota: 2, name: 'Hindi speaker' }, en: { quota: 1, name: 'English speaker' } };
const MAX_PARTICIPANTS = 6;
const GROUP_LINES = { kn: ['k01', 'k02', 'k04', 'k06', 'k11', 'k13'], hi: ['h01', 'h02', 'h03'], en: [] };
const SHORT = { kn: 'sk1', hi: 'sh1', en: 'se1' };
const SOFT = { kn: 'k01', hi: 'h01', en: 'e01' };

/**
 * A volunteer's planned slots, in recording order: the quiet set, the noisy set, then the controls.
 * Slot ids: '<line>-<place>' for read lines, 'short-<place>', 'soft-<place>', '<control>-<place>'.
 */
function slotPlan(group) {
  if (!GROUPS[group]) return [];
  const read = ['e01', 'e02', 'e03', ...GROUP_LINES[group]];
  const out = [];
  for (const place of ['q', 'n']) {
    for (const line of read) out.push({ slot: `${line}-${place}`, kind: 'speech', line, place, lang: LINES[line].lang, label: 'speech' });
    out.push({ slot: `short-${place}`, kind: 'short', line: SHORT[group], place, lang: group, label: 'speech' });
    out.push({ slot: `soft-${place}`, kind: 'soft', line: SOFT[group], place, lang: group, label: 'speech' });
  }
  for (const c of Object.keys(CONTROLS)) for (const place of ['q', 'n']) out.push({ slot: `${c}-${place}`, kind: 'control', line: c, place, lang: null, label: 'no-speech' });
  return out;
}
const PLANNED_PER_GROUP = Object.fromEntries(Object.keys(GROUPS).map(g => [g, slotPlan(g).length]));
const PLANNED_TOTAL = Object.entries(GROUPS).reduce((n, [g, x]) => n + x.quota * PLANNED_PER_GROUP[g], 0);   // 144

/** What a slot asks the volunteer to say, and how its takes are scored. */
function slotInfo(slot, group) {
  const s = slotPlan(group).find(x => x.slot === slot);
  if (!s) return null;
  if (s.kind === 'control') return { ...s, say: CONTROLS[s.line].say, means: CONTROLS[s.line].means, items: [], lang_hint: LANG_HINT[group] };
  const L = LINES[s.line];
  return { ...s, say: s.kind === 'soft' ? `${L.say} (say it quietly, phone at arm's length)` : L.say, means: L.means, items: L.items, lang_hint: LANG_HINT[s.lang] };
}

// ── Wording checks: a language's lines are recorded only after a fluent speaker's check ──
const linesFor = (lang) => Object.entries(LINES).filter(([, l]) => l.lang === lang).map(([id, l]) => ({ id, say: l.say, means: l.means, items: l.items.map(i => i.label) }));
/** The hash of exactly what a fluent speaker confirmed: every line's words and what is scored. */
const scriptSha = (lang) => sha256(JSON.stringify(linesFor(lang)));

// ── Offline candidate settings (fixed before any data) ──────────────────────
const GRID = Object.freeze([
  { id: 'v200-r60', min_voiced_ms: 200, min_run_ms: 60, min_f0_spread_hz: 6, live: true },
  { id: 'v200-r40', min_voiced_ms: 200, min_run_ms: 40, min_f0_spread_hz: 6 },
  { id: 'v160-r60', min_voiced_ms: 160, min_run_ms: 60, min_f0_spread_hz: 6 },
  { id: 'v160-r40', min_voiced_ms: 160, min_run_ms: 40, min_f0_spread_hz: 6 },
  { id: 'v120-r60', min_voiced_ms: 120, min_run_ms: 60, min_f0_spread_hz: 6 },
  { id: 'v120-r40', min_voiced_ms: 120, min_run_ms: 40, min_f0_spread_hz: 6 },
]);
/** A stored take's raw measurements, as the live check computed them. null if the check did not measure. */
function featuresOf(t) {
  if (t.voiced_frames == null || t.hop_ms == null) return null;
  return { voiced_frames: Number(t.voiced_frames), longest_run_frames: Number(t.longest_run_frames), f0_spread_raw: Number(t.f0_spread_raw), hop_ms: Number(t.hop_ms) };
}
/**
 * What a setting would have done with this take: 'accept' | 'refuse' | 'not checked'.
 * A take the live check could not decode/measure is 'not checked' at every setting — exactly what
 * the live server does (it lets such a recording through to the providers).
 */
function decision(t, setting) {
  const f = featuresOf(t);
  if (!f || (t.speech_status !== 'speech' && t.speech_status !== 'no_speech')) return 'not checked';
  return SP.decide(f, setting) ? 'accept' : 'refuse';
}
/** The stored live result vs the replay at the live setting: must be identical for every take. */
function replayMatches(t) {
  if (t.speech_status !== 'speech' && t.speech_status !== 'no_speech') return true;
  const live = t.speech_status === 'speech';
  return featuresOf(t) != null && SP.decide(featuresOf(t), SP.LIVE_LIMITS) === live;
}

// ── Part B: words, numbers and units ─────────────────────────────────────────
const SEP = '|';
const loose = (s) => s.replace(/ee/g, 'i').replace(/oo/g, 'u').replace(/aa/g, 'a').replace(/ii/g, 'i').replace(/uu/g, 'u').replace(/ph/g, 'f').replace(/th/g, 't').replace(/dh/g, 'd');
const FOOD = {
  idli: 'idli|idly|itli|idlis|idlies|ಇಡ್ಲಿ', sambar: 'sambar|sambhar|saambar|sambaru|ಸಾಂಬಾರ್', upma: 'upma|uppittu|uppit|ಉಪ್ಮಾ|ಉಪ್ಪಿಟ್ಟು', coffee: 'coffee|kaafi|kapi|kafi|kaapi|ಕಾಫಿ',
  chapati: 'chapati|chapathi|chappathi|chapatis|chapatti|ಚಪಾತಿ', dal: 'dal|daal|dhal|dhaal|ದಾಲ್|दाल', curd: 'curd|mosaru|dahi|ಮೊಸರು',
  water: 'water|neeru|niru|paani|pani|ನೀರು|पानी', roti: 'roti|rotis|rotti|rottis|chapati|रोटी|रोटियां|रोटियाँ', milk: 'milk|doodh|dudh|haalu|ದೂಧ್|दूध',
  egg: 'egg|eggs|anda|ande|anday|motte|अंडे|अंडा|अण्डे', squat: 'squat|squats|ಸ್ಕ್ವಾಟ್',
};
const UNIT = {
  bowl: 'bowl|bowls|baul|ಬೌಲ್', plate: 'plate|plates|plet|ಪ್ಲೇಟ್', cup: 'cup|cups|kap|ಕಪ್', katori: 'katori|katoris|katora|kathori|कटोरी|ಕಟೋರಿ',
  glass: 'glass|glasses|gilas|lota|गिलास|ग्लास', litre: 'litre|litres|liter|liters|ltr|l|litar|ಲೀಟರ್|लीटर', kg: 'kg|kgs|kilo|kilos|kilogram|kilograms|ಕೆಜಿ|किलो|किलोग्राम',
  pound: 'pound|pounds|lb|lbs', set: 'set|sets|ಸೆಟ್', rep: 'rep|reps|repetitions|ರೆಪ್ಸ್', minute: 'minute|minutes|min|mins|nimisha|ನಿಮಿಷ|मिनट',
};
const NUM = {
  en: { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, hundred: 100 },
  kn: { ondu: 1, eradu: 2, mooru: 3, naalku: 4, nalku: 4, aidu: 5, aaru: 6, elu: 7, yelu: 7, entu: 8, ombattu: 9, hattu: 10, nooru: 100 },
  hi: { ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, saat: 7, aath: 8, nau: 9, das: 10, bayaasi: 82, bayasi: 82, bahattar: 72,
    'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'पाँच': 5, 'बयासी': 82, 'बहत्तर': 72 },
};
const TENS = { en: { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 },
  kn: { ippattu: 20, muvattu: 30, moovattu: 30, nalavattu: 40, aivattu: 50, aravattu: 60, eppattu: 70, embattu: 80, tombattu: 90 }, hi: { chalis: 40, 'चालीस': 40 } };
const POINT = new Set(['point', 'पॉइंट', 'प्वाइंट', 'दशमलव', 'ಪಾಯಿಂಟ್']);
const BREAKS = new Set(['and', 'then', 'mattu', 'aamele', 'amele', 'aur', 'और', 'plus', 'also']);
const FILLERS = new Set(['of', 'full', 'small', 'big', 'medium', 'the', 'a']);
const DEV_DIGITS = /[०-९]/g;

function tokens(text) {
  let t = String(text || '').normalize('NFC');
  if (/[ಀ-೿]/.test(t)) t = kannadaToLatin(t);                // Kannada script spelled out, as the pilot does
  t = t.replace(DEV_DIGITS, d => String(d.charCodeAt(0) - 0x0966)).toLowerCase()
    .replace(/(\d)\.(\d)/g, '$1․$2').replace(/[,;:!?()"“”]|[.।](?=\s|$)/g, ` ${SEP} `).replace(/․/g, '.')
    .replace(/(\d)([a-zऀ-ॿ]+)/g, '$1 $2');                    // "82.5kg" → 82.5 kg
  const out = [];
  for (const w0 of t.split(/\s+/)) {
    if (!w0) continue;
    if (w0 === SEP) { out.push(SEP); continue; }
    for (const w1 of w0.split(/[-–]/)) {                                  // "breakfast-ge" → breakfast, ge
      const w = loose(w1.replace(/[^a-z0-9.ऀ-ॿ]+/g, '').replace(/^\.+|\.+$/g, ''));
      if (!w) continue;
      out.push(BREAKS.has(w) ? SEP : w);
    }
  }
  return out;
}
const variants = (spec) => spec.split('|').map(v => loose(v.toLowerCase().normalize('NFC')));
const isWord = (tok, spec) => tok !== SEP && tok != null && variants(spec).some(v => tok === v || (v.length > 3 && tok.startsWith(v)));
const ALL_UNITS = Object.values(UNIT).join('|');
function numberDicts(lang) {
  const one = { ...NUM.en, ...(lang === 'kn' ? NUM.kn : {}), ...(lang === 'hi' ? NUM.hi : {}) };
  const tens = { ...TENS.en, ...(lang === 'kn' ? TENS.kn : {}), ...(lang === 'hi' ? TENS.hi : {}) };
  const L = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [loose(k), v]));
  return { one: L(one), tens: L(tens) };
}
/** Quantity phrases in a transcript: [{ value, unit, food:[tokens], text }]. Mirrors the pilot's reading (2n). */
function phrasesOf(text, lang) {
  const toks = tokens(text), D = numberDicts(lang);
  const single = (t) => (/^\d+(\.\d+)?$/.test(t) ? Number(t) : D.one[t] ?? null);
  const numberAt = (i) => {
    const t = toks[i]; if (t == null || t === SEP) return null;
    let value = null, len = 0;
    if (D.tens[t] != null) { value = D.tens[t]; len = 1; const u = D.one[toks[i + 1]]; if (u != null && u < 10) { value += u; len = 2; } }
    else if (single(t) != null) { value = single(t); len = 1; }
    else if (t === 'a' && isWord(toks[i + 1], ALL_UNITS)) { value = 1; len = 1; }   // "a bowl of sambar"
    if (value == null) return null;
    if (POINT.has(toks[i + len])) { const d = single(toks[i + len + 1]); if (d != null && d < 10 && Number.isInteger(d)) { value = Number(`${Math.floor(value)}.${d}`); len += 2; } }
    return { value, len };
  };
  const phrases = [];
  let taken = 0;                                                            // a phrase never reaches back into the one before it
  for (let i = 0; i < toks.length; i++) {
    const n = numberAt(i); if (!n) continue;
    let j = i + n.len, unit = null; const food = [];
    while (j < toks.length && FILLERS.has(toks[j]) && toks[j] !== 'of') j++;
    if (j < toks.length && isWord(toks[j], ALL_UNITS)) { unit = toks[j]; j++; }
    while (j < toks.length && FILLERS.has(toks[j])) j++;
    for (let k = 0; k < 2 && j < toks.length && toks[j] !== SEP && !numberAt(j); k++, j++) food.push(toks[j]);
    const weightUnit = unit && (isWord(unit, UNIT.kg) || isWord(unit, UNIT.pound));
    if (!unit && !food.length) {
      for (let b = i - 1; b >= taken && b >= i - 3 && toks[b] !== SEP && !numberAt(b); b--) { if (!unit && isWord(toks[b], ALL_UNITS)) unit = toks[b]; else food.unshift(toks[b]); }
    } else if (unit && !food.length && !weightUnit) {
      for (let b = i - 1; b >= taken && b >= i - 2 && toks[b] !== SEP && !numberAt(b); b--) food.unshift(toks[b]);
    }
    phrases.push({ value: n.value, unit, food, text: toks.slice(i, j).filter(x => x !== SEP).join(' ') });
    taken = j;
    i += n.len - 1;
  }
  return { phrases, toks };
}
// Line outcomes (2x review): complete, so no material error can fall between labels. Item flags coexist.
const LINE_OUTCOMES = ['all correct', 'wrong number', 'wrong unit', 'missing', 'extra', 'empty answer', 'wrong language/script', 'provider error', 'uncertain/unscorable'];
const LINE_PRIORITY = ['provider error', 'empty answer', 'wrong language/script', 'uncertain/unscorable', 'wrong number', 'wrong unit', 'extra', 'missing'];
const ITEM_OUTCOMES = ['correct', 'correct (no amount spoken)', 'unit alias', 'invented amount', 'wrong number', 'wrong unit', 'unit missing', 'conflicting', 'food heard, no number', 'missing'];
const ITEM_FLAG = { 'invented amount': 'extra', 'wrong number': 'wrong number', 'wrong unit': 'wrong unit', 'unit missing': 'missing', 'food heard, no number': 'missing', missing: 'missing', conflicting: 'uncertain/unscorable' };
const OK_ITEM = new Set(['correct', 'correct (no amount spoken)', 'unit alias']);
const SCRIPT_OK = { en: ['latin'], kn: ['latin', 'kannada'], hi: ['latin', 'devanagari'] };
const SCRIPT_RX = { latin: /[A-Za-z]/, kannada: /[ಀ-೿]/, devanagari: /[ऀ-ॿ]/ };
/** True when more than a tenth of the letters are in a script the line's language does not use. */
function scriptProblem(text, lang) {
  const letters = [...String(text || '')].filter(ch => /\p{L}/u.test(ch));
  if (!letters.length) return false;
  const ok = SCRIPT_OK[lang] || ['latin'];
  return letters.filter(ch => !ok.some(s => SCRIPT_RX[s].test(ch))).length / letters.length > 0.1;
}
/** The line's items with the listener's corrections: reference_items [{ label, n }] replaces what the script says was spoken. */
function itemsWithReference(items, reference) {
  if (!Array.isArray(reference) || !reference.length) return items;
  return items.map(it => { const r = reference.find(x => x && x.label === it.label); return r && Number.isFinite(Number(r.n)) ? { ...it, n: Number(r.n), corrected: true } : it; });
}
/**
 * Score one transcript against a line's items.
 * → { line: one of LINE_OUTCOMES (the most serious), flags: every line outcome that applies, items, extra }
 * "all correct" only when no flag at all applies. opts.unscorable: the listener could not establish what was said.
 */
function scoreTranscript(items, transcript, lang, { error = null, unscorable = false } = {}) {
  if (transcript == null) return { line: 'provider error', flags: ['provider error'], items: [], extra: [], error: error || 'no answer' };
  if (!/\S/.test(transcript)) return { line: 'empty answer', flags: ['empty answer'], items: [], extra: [] };
  const flags = new Set();
  if (scriptProblem(transcript, lang)) flags.add('wrong language/script');
  if (unscorable) flags.add('uncertain/unscorable');
  const { phrases, toks } = phrasesOf(transcript, lang);
  const used = new Set();
  const heardText = (list) => list.map(p => p.text).join('; ');
  const res = items.map(it => {
    if (it.kind === 'presence') {
      const withAmount = phrases.filter(p => p.food.some(t => isWord(t, FOOD[it.food])));
      withAmount.forEach(p => used.add(p));
      if (withAmount.length) return { label: it.label, outcome: 'invented amount', heard: heardText(withAmount) };   // no amount was spoken (k04's curd)
      return { label: it.label, outcome: toks.some(t => isWord(t, FOOD[it.food])) ? 'correct (no amount spoken)' : 'missing', heard: '' };
    }
    if (it.kind === 'weight') {
      const mine = phrases.filter(p => (p.unit && (isWord(p.unit, UNIT.kg) || isWord(p.unit, UNIT.pound))) || (!p.unit && p.value === it.n));
      mine.forEach(p => used.add(p));
      const ok = mine.filter(p => p.unit && isWord(p.unit, UNIT.kg) && p.value === it.n);
      const wrongN = mine.filter(p => p.unit && isWord(p.unit, UNIT.kg) && p.value !== it.n);
      const pounds = mine.filter(p => p.unit && isWord(p.unit, UNIT.pound));
      const bare = mine.filter(p => !p.unit);
      const outcome = ok.length && !wrongN.length && !pounds.length ? 'correct' : ok.length ? 'conflicting' : wrongN.length ? 'wrong number' : pounds.length ? 'wrong unit' : bare.length ? 'unit missing' : 'missing';
      return { label: it.label, outcome, heard: heardText(mine) };
    }
    const mine = phrases.filter(p => (it.food ? p.food.some(t => isWord(t, FOOD[it.food])) : (p.unit && isWord(p.unit, UNIT[it.unit]))));
    mine.forEach(p => used.add(p));
    if (!mine.length) return { label: it.label, outcome: it.food && toks.some(t => isWord(t, FOOD[it.food])) ? 'food heard, no number' : 'missing', heard: '' };
    const valueOk = (p) => p.value === it.n;
    const unitState = (p) => (!it.unit ? 'ok' : p.unit && isWord(p.unit, UNIT[it.unit]) ? 'ok' : p.unit && it.unitAlias && isWord(p.unit, UNIT[it.unitAlias]) ? 'alias' : p.unit ? 'wrong' : 'missing');
    const good = mine.filter(valueOk), bad = mine.filter(p => !valueOk(p));
    let outcome;
    if (good.length && bad.length) outcome = 'conflicting';
    else if (bad.length) outcome = 'wrong number';
    else {
      const states = new Set(good.map(unitState));
      outcome = states.size > 1 ? 'conflicting' : states.has('ok') ? 'correct' : states.has('alias') ? 'unit alias' : states.has('wrong') ? 'wrong unit' : 'unit missing';
    }
    return { label: it.label, outcome, heard: heardText(mine) };
  });
  for (const r of res) if (ITEM_FLAG[r.outcome]) flags.add(ITEM_FLAG[r.outcome]);
  const extra = phrases.filter(p => !used.has(p) && (p.unit || p.food.length)).map(p => p.text);
  if (extra.length) flags.add('extra');
  const line = LINE_PRIORITY.find(f => flags.has(f)) || 'all correct';
  return { line, flags: [...flags], items: res, extra };
}

// ── Part A rule 3: the logging parser's preview of a newly admitted take ──────
/** "2 idli" / "1 bowl" / "150 g" → { n, unit }. */
function qtyOf(text, lang) { const { phrases } = phrasesOf(text || '', lang); return phrases[0] ? { n: phrases[0].value, unit: phrases[0].unit } : null; }
const WORKOUT_UNITS = new Set(['set', 'rep', 'minute']);
/**
 * Judge a parser preview against what was spoken (one engine's leg of one take).
 * → { result: 'correct reviewable' | 'explicit refusal' | 'missing/unresolved (visible)' | 'needs a hand check' | 'disqualifying' | 'provider error',
 *     problems: [disqualifying reasons], items: [{ label, outcome, shown }] }
 * Disqualifying: a surfaced wrong number or wrong unit, an invented item, or an unspoken health change.
 */
function judgePreview(items, preview, lang) {
  if (!preview || preview.error) return { result: 'provider error', problems: [], items: [], note: preview?.error || 'no preview' };
  if (preview.question || preview.safety || preview.amount_clarification || preview.evaluation_note) return { result: 'explicit refusal', problems: [], items: [], note: preview.evaluation_note || (preview.safety ? `safety reply: ${preview.safety}` : 'asked a question; no log card') };
  const foods = Array.isArray(preview.foods) ? preview.foods : [], unresolved = Array.isArray(preview.unresolved_foods) ? preview.unresolved_foods : [];
  const nameOf = (f) => `${f?.name || ''} ${f?.qty_text || ''}`;
  const matches = (f, food) => tokens(nameOf(f)).some(t => isWord(t, FOOD[food]));
  const used = new Set(), out = [], problems = [];
  let missing = false, hand = false;
  const has = { weight: items.some(i => i.kind === 'weight'), water: items.some(i => i.food === 'water'), workout: items.some(i => WORKOUT_UNITS.has(i.unit) || i.food === 'squat') };
  for (const it of items) {
    if (it.kind === 'weight') {
      const got = preview.weight_kg;
      const o = got == null ? 'missing' : Number(got) === it.n ? 'correct' : 'wrong number';
      out.push({ label: it.label, outcome: o, shown: got == null ? '' : `${got} kg` }); if (o === 'wrong number') problems.push(`weight shown as ${got} kg`); if (o === 'missing') missing = true; continue;
    }
    if (it.food === 'water') {
      const got = preview.water_ml_add;
      const o = got == null ? 'missing' : Number(got) === it.n * 1000 ? 'correct' : 'wrong number';
      out.push({ label: it.label, outcome: o, shown: got == null ? '' : `${got} ml` }); if (o === 'wrong number') problems.push(`water shown as ${got} ml`); if (o === 'missing') missing = true; continue;
    }
    if (!it.food || it.food === 'squat') { out.push({ label: it.label, outcome: 'check by hand', shown: JSON.stringify(preview.workouts || preview.activities || []).slice(0, 120) }); hand = true; continue; }
    const fs = foods.filter((f, k) => !used.has(k) && matches(f, it.food));
    foods.forEach((f, k) => { if (fs.includes(f)) used.add(k); });
    if (!fs.length) { const u = unresolved.some(f => matches(f, it.food)); out.push({ label: it.label, outcome: u ? 'unresolved (shown)' : 'missing', shown: '' }); missing = true; continue; }
    const f = fs[0];
    if (it.kind === 'presence') { out.push({ label: it.label, outcome: 'present (amount not spoken: check it is shown as an estimate)', shown: f.qty_text || `${f.grams ?? ''} g` }); continue; }
    const q = qtyOf(f.qty_text, lang);
    let o;
    if (!q) o = 'number not shown';
    else if (q.n !== it.n) o = 'wrong number';
    else if (it.unit && !(q.unit && isWord(q.unit, UNIT[it.unit]))) o = q.unit && it.unitAlias && isWord(q.unit, UNIT[it.unitAlias]) ? 'unit alias' : q.unit ? 'wrong unit' : 'unit not shown';
    else o = 'correct';
    if (fs.length > 1) o = 'wrong number';   // the same food twice is a doubled amount
    out.push({ label: it.label, outcome: o, shown: fs.map(x => x.qty_text || `${x.grams ?? ''} g`).join(' + ') });
    if (o === 'wrong number' || o === 'wrong unit') problems.push(`${it.label} shown as ${fs.map(x => `${x.qty_text || ''} ${x.name || ''}`.trim()).join(' + ')}`);
    if (o === 'number not shown' || o === 'unit not shown') missing = true;
  }
  foods.forEach((f, k) => { if (!used.has(k)) problems.push(`invented item: ${f.name || '?'}${f.qty_text ? ` (${f.qty_text})` : ''}`); });
  if (preview.weight_kg != null && !has.weight) problems.push(`unspoken weight ${preview.weight_kg} kg`);
  if (preview.water_ml_add != null && !has.water) problems.push(`unspoken water ${preview.water_ml_add} ml`);
  if (preview.sleep) problems.push('unspoken sleep');
  for (const k of ['activities', 'acv', 'supplements']) if (Array.isArray(preview[k]) && preview[k].length) problems.push(`unspoken ${k}`);
  if (Array.isArray(preview.workouts) && preview.workouts.length && !has.workout) problems.push('unspoken workout');
  if (Array.isArray(preview.corrections) && preview.corrections.length) problems.push('unspoken correction to an earlier entry');
  const result = problems.length ? 'disqualifying' : missing ? 'missing/unresolved (visible)' : hand ? 'needs a hand check' : 'correct reviewable';
  return { result, problems, items: out };
}
/** The everyday voice route's own verdict on one leg before any preview: refused legs never reach the parser. */
function voiceLeg(t, engine) {
  const text = t[`${engine}_text`];
  if (text == null) return { stage: 'no transcript', reason: t[`${engine}_error`] || 'no answer' };
  if (!/\S/.test(text)) return { stage: 'voice refused', reason: 'empty answer' };
  if (engine === 'gemini' && t.gemini_generated) return { stage: 'voice refused', reason: 'generated text' };
  if (engine === 'whisper' && t.whisper_review && !t.whisper_review.accepted) return { stage: 'voice refused', reason: t.whisper_review.reason };
  return { stage: 'to parser', text };
}

// ── The engines: exactly the everyday requests, every call recorded ───────────
const geminiModels = (env = process.env) => [env.GEMINI_MODEL || 'gemini-2.5-flash-lite', env.GEMINI_FALLBACK_MODEL || 'gemini-2.5-flash'].filter(Boolean);
const geminiUrlFor = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
const short = (h) => h.slice(0, 16);
/**
 * Gemini, as everyday voice logging asks it (routes/aiChat.js voice-transcribe): the same prompt,
 * models in the same order, the same settings. Every model tried is recorded.
 */
async function geminiTake(audio, mt, langHint, env = process.env) {
  const prompt = voiceTranscriptionPrompt(langHint);
  const prov = { engine: 'gemini', lang_hint: langHint, prompt_sha256: short(sha256(prompt)), attempts: [], model_used: null, model_version: null, response_id: null };
  if (!env.GEMINI_API_KEY) return { text: null, error: 'GEMINI_API_KEY is not set', provenance: prov };
  let lastErr = null;
  for (const model of geminiModels(env)) {
    const t0 = Date.now();
    try {
      const response = await axios.post(`${geminiUrlFor(model)}?key=${env.GEMINI_API_KEY}`,
        { contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mt, data: audio } }] }], generationConfig: { temperature: 0, maxOutputTokens: 500 } },
        { headers: { 'content-type': 'application/json' }, timeout: 25000 });
      const cand = response.data?.candidates?.[0];
      const text = (cand?.content?.parts?.map(p => p.text).join('') || '').trim();
      prov.attempts.push({ model, outcome: 'answer', ms: Date.now() - t0, model_version: response.data?.modelVersion || null, finish_reason: cand?.finishReason || null });
      prov.model_used = model; prov.model_version = response.data?.modelVersion || null; prov.response_id = response.data?.responseId || null;
      return { text: text.slice(0, 1000), generated_text: generatedText(text), error: null, provenance: prov };
    } catch (e) { lastErr = e; prov.attempts.push({ model, outcome: 'error', ms: Date.now() - t0, status: e.response?.status || e.code || null, error: providerReason(e) }); }
  }
  return { text: null, error: providerReason(lastErr), provenance: prov };
}
/** Whisper on Groq, as the everyday fallback asks it; plus the fallback's own accept/refuse decision on the answer. */
async function whisperTake(audio, mt, langHint, env = process.env) {
  const { language } = whisperFallbackSettings(langHint);
  const prompt = whisperTranscriptionPrompt(langHint);
  const prov = { engine: 'whisper', model: 'whisper-large-v3', lang_hint: langHint, language_sent: language || null, prompt_sha256: short(sha256(prompt)), attempts: [], language_reported: null, request_id: null };
  if (!env.GROQ_API_KEY) return { text: null, error: 'GROQ_API_KEY is not set', provenance: prov };
  const ext = mt.includes('mp4') ? 'mp4' : mt.includes('ogg') ? 'ogg' : 'webm';
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from(audio, 'base64')], { type: mt }), `voice.${ext}`);
  fd.append('model', 'whisper-large-v3');
  fd.append('temperature', '0');
  fd.append('response_format', 'verbose_json');
  if (language) fd.append('language', language);
  fd.append('prompt', prompt);
  const t0 = Date.now();
  try {
    const r = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', fd, { headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` }, timeout: 25000 });
    const review = reviewWhisper(r.data, langHint);
    prov.attempts.push({ outcome: 'answer', ms: Date.now() - t0 });
    prov.language_reported = r.data?.language ? String(r.data.language).slice(0, 20) : null;
    prov.request_id = r.data?.x_groq?.id || r.headers?.['x-request-id'] || null;
    const segments = Array.isArray(r.data?.segments) ? r.data.segments.slice(0, 50).map(s => ({ start: s?.start ?? null, end: s?.end ?? null, avg_logprob: s?.avg_logprob ?? null, no_speech_prob: s?.no_speech_prob ?? null, compression_ratio: s?.compression_ratio ?? null })) : null;
    return { text: String(r.data?.text || '').trim().slice(0, 1000), review: { accepted: !!review.ok, reason: review.ok ? null : review.reason }, segments, error: null, provenance: prov };
  } catch (e) {
    prov.attempts.push({ outcome: 'error', ms: Date.now() - t0, status: e.response?.status || e.code || null, error: providerReason(e) });
    return { text: null, error: providerReason(e), provenance: prov };
  }
}
async function transcribeTake(audio, mt, langHint) {
  const [g, w] = await Promise.all([geminiTake(audio, mt, langHint), whisperTake(audio, mt, langHint)]);
  return { gemini: g, whisper: w };
}

// ── Part C: the everyday path, 32 planned controlled tries + natural observations ──
const PARTC_LINES = [
  { line: 'e01', lang: 'en', say: LINES.e01.say, expect: '2 idli, 1 bowl sambar, 82.5 kg; Apply; the day shows them' },
  { line: 'k01', lang: 'kn', say: LINES.k01.say, expect: '2 idli, 1 bowl sambar' },
  { line: 'k11', lang: 'kn', say: LINES.k11.say, expect: 'weight 72.5 kg, or Retry / type' },
  { line: 'k04', lang: 'kn', say: LINES.k04.say, expect: '2 chapati, 1 katori dal, curd' },
  { line: 'h01', lang: 'hi', say: LINES.h01.say, expect: '2 roti, 1 katori dal' },
  { line: 'sk1', lang: 'kn', say: LINES.sk1.say, expect: '2 idli, or Retry / type' },
  { line: 'x01', lang: 'en', say: '5 seconds of silence', expect: '"Didn\'t catch any speech", with Retry; nothing to Apply' },
  { line: 'k01', lang: 'kn', say: `${LINES.k01.say} (fan on full and the TV on)`, expect: 'correct, or Retry / type; never a wrong quantity', noisy: true },
];
const PARTC_SPEAKERS = ['C1', 'C2'];
const PARTC_PATHS = ['gemini', 'whisper'];
/** 2 operators × 8 lines × 2 provider legs = 32 planned CONTROLLED tries (1–32). One Retry each after a refusal: up to 64 attempts. */
const PARTC_PLAN = Object.freeze(PARTC_SPEAKERS.flatMap((speaker, si) => PARTC_LINES.flatMap((l, li) => PARTC_PATHS.map((path, pi) => ({
  trial: si * 16 + li * 2 + pi + 1, speaker, path, route: 'controlled', ...l, items: (LINES[l.line]?.items || []).map(i => i.label) })))));
/** Natural observations (33–40): the ordinary microphone path as it behaves on the phone, on-device dictation included. */
const NATURAL_SLOTS = 8;
const NATURAL_PLAN = Object.freeze(Array.from({ length: NATURAL_SLOTS }, (_, i) => ({ trial: 33 + i, route: 'natural', speaker: '', path: 'as it happens', line: '', lang: '', say: 'any line, the ordinary way', expect: 'what the phone actually does', items: [] })));
const trialInfo = (n) => PARTC_PLAN.find(t => t.trial === n) || NATURAL_PLAN.find(t => t.trial === n) || null;
const ARM_MINUTES = 30;
const available = () => fallbackTest.available();

/** The armed Part C try for this account ({ trial_no, route }), or null. Never throws; no database read off the test server. */
async function armedFor(user, db = require('../db/pool')) {
  if (!available() || !user?.id) return null;
  try {
    const { rows: [a] } = await db.query(`SELECT trial_no, route FROM voice_calibration_partc_armed WHERE id=1 AND user_id=$1 AND armed_at > NOW() - INTERVAL '${ARM_MINUTES} minutes'`, [user.id]);
    return a || null;
  } catch (e) { console.warn('voice calibration: arm check failed:', e.message); return null; }
}
const speechRecord = (s) => (s ? { status: s.status, version: s.version || null, voiced_ms: s.voiced_ms ?? null, longest_run_ms: s.longest_run_ms ?? null, f0_spread_hz: s.f0_spread_hz ?? null,
  duration_ms: s.duration_ms ?? null, features: s.features || null, live_decision: s.status === 'speech' ? 'accept' : s.status === 'no_speech' ? 'refuse' : 'not checked', error: s.error || null } : null);
/** Who actually produced the words (or the refusal) of a server recording, from the route's own trail. Never inferred from the switch. */
function answeredBy(trail, body) {
  if (body?.rejected === 'no_speech_detected') return 'none (speech check refused; no provider asked)';
  const last = [...(trail || [])].reverse().find(x => x.outcome === 'answer' || x.outcome === 'accepted' || String(x.outcome).startsWith('refused'));
  if (!last) return 'none (no provider answered)';
  return last.engine === 'gemini' ? `gemini/${last.model}` : 'groq/whisper-large-v3';
}
const actualPath = (c) => (c.kind === 'on-device dictation' ? 'browser/on-device (no upload)' : c.kind === 'server recording' ? c.answered_by : '');
async function appendCapture(trialNo, route, build, db) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO voice_calibration_partc (trial_no, route, updated_at) VALUES ($1,$2,NOW()) ON CONFLICT (trial_no) DO NOTHING`, [trialNo, route]);
    const { rows: [r] } = await client.query(`SELECT captures FROM voice_calibration_partc WHERE trial_no=$1 FOR UPDATE`, [trialNo]);
    const caps = r.captures || [];
    if (caps.length < 40) {
      const cap = build(caps);
      await client.query(`UPDATE voice_calibration_partc SET captures = captures || $2::jsonb, updated_at = NOW() WHERE trial_no=$1`, [trialNo, JSON.stringify(cap)]);
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
}
const attemptsIn = (caps) => caps.filter(c => c.kind === 'server recording' || c.kind === 'on-device dictation');
/** A server recording of an armed try (voice-transcribe). A recording identical to an earlier one is a Retry of it. Never throws. */
async function recordTrial(armed, { body, status, speech, langHint, audioSha, fbTest, trail }, db = require('../db/pool')) {
  try {
    await appendCapture(armed.trial_no, armed.route, (caps) => {
      const prev = attemptsIn(caps);
      const same = prev.find(c => c.audio_sha256 && c.audio_sha256 === audioSha);
      const cap = { kind: 'server recording', at: new Date().toISOString(), route: armed.route, attempt: prev.length + 1, retry_of: same ? same.attempt : null, upload: true,
        http_status: status || 200, lang_hint: langHint || null, audio_sha256: audioSha || null, voice_backup_switch: !!fbTest, speech: speechRecord(speech),
        trail: trail || [], answered_by: answeredBy(trail, body), engine_reported: body?.engine || null,
        transcript: typeof body?.transcript === 'string' ? body.transcript.slice(0, 1000) : null, rejected: body?.rejected || null, error: body?.error || null };
      cap.actual_path = actualPath(cap);
      return cap;
    }, db);
  } catch (e) { console.warn('voice calibration: Part C capture failed:', e.message); }
}
/** On-device dictation used with NO upload (reported by the app only while a try is armed for the account). Never labelled Gemini or Whisper. */
async function recordDeviceDictation(armed, { text, lang }, db = require('../db/pool')) {
  await appendCapture(armed.trial_no, armed.route, (caps) => {
    const cap = { kind: 'on-device dictation', at: new Date().toISOString(), route: armed.route, attempt: attemptsIn(caps).length + 1, upload: false, lang_hint: lang || null,
      transcript: String(text || '').slice(0, 1000), answered_by: 'browser/on-device (no upload)' };
    cap.actual_path = actualPath(cap);
    return cap;
  }, db);
}
const previewSummary = (r) => (r ? { foods: (r.foods || []).slice(0, 20).map(f => ({ name: f.name, qty_text: f.qty_text || null, grams: f.grams ?? null, meal: f.meal || null })),
  unresolved_foods: (r.unresolved_foods || []).slice(0, 10).map(f => ({ name: f.name || f.query || null, qty_text: f.qty_text || null })),
  weight_kg: r.weight_kg ?? null, water_ml_add: r.water_ml_add ?? null, sleep: r.sleep || null, activities: (r.activities || []).map(a => a.id || a), acv: (r.acv || []).map(a => a.id || a),
  supplements: (r.supplements || []).map(a => a.id || a), workouts: (r.workouts || []).length, corrections: (r.corrections || []).length, question: !!r.question, safety: r.safety || null,
  reply: typeof r.reply === 'string' ? r.reply.slice(0, 300) : null, error: r.error || null } : null);
/** The preview (parse) of an armed try, linked to the attempt whose text it used; text edited before the preview is flagged. Never throws. */
async function recordPreview(armed, { message, result }, db = require('../db/pool')) {
  try {
    await appendCapture(armed.trial_no, armed.route, (caps) => {
      const last = attemptsIn(caps).slice(-1)[0];
      const msg = String(message || '').trim();
      const source = !last ? 'typed or unknown (no recording in this try)' : (last.transcript || '').trim() === msg ? `unedited text of attempt ${last.attempt}` : `EDITED before the preview (attempt ${last.attempt} said "${(last.transcript || '').slice(0, 120)}")`;
      return { kind: 'preview', at: new Date().toISOString(), route: armed.route, attempt: last ? last.attempt : null, message: msg.slice(0, 1000), text_source: source, edited: !!last && (last.transcript || '').trim() !== msg, preview: previewSummary(result) };
    }, db);
  } catch (e) { console.warn('voice calibration: Part C preview capture failed:', e.message); }
}

// ── The test account's day: baseline at arming, read-back, restore ───────────
const canonJ = (v) => (Array.isArray(v) ? `[${v.map(canonJ).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonJ(v[k])}`).join(',')}}` : JSON.stringify(v ?? null));
const noNullsObj = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.entries(o).filter(([, v]) => v != null)) : o ?? {});
const blankSleep = (s) => { const o = noNullsObj(s); const k = Object.keys(o); return k.length === 0 || (k.length === 3 && o.bedtime === '' && o.waketime === '' && o.quality === 0); };
const DAY_FIELDS = ['weight_kg', 'water_ml', 'sleep', 'activities', 'acv', 'supplements', 'notes'];
/** Every field of the day a Save can reach, and the day's workouts with their sets (raw, for restoring). */
async function dayState(db, userId, date) {
  const { rows: [d] } = await db.query(`SELECT weight_kg, activities, acv, food_items, water_ml, supplements, sleep, notes FROM daily_logs WHERE patient_id=$1 AND log_date=$2`, [userId, date]);
  const { rows: ws } = await db.query(`SELECT s.id, s.duration_min, s.notes, s.program_id,
      COALESCE(json_agg(json_build_object('id', ss.id, 'exercise_id', ss.exercise_id, 'set_number', ss.set_number, 'reps', ss.reps, 'weight_kg', ss.weight_kg) ORDER BY ss.id) FILTER (WHERE ss.id IS NOT NULL), '[]') AS sets
    FROM workout_sessions s LEFT JOIN session_sets ss ON ss.session_id = s.id WHERE s.patient_id=$1 AND s.session_date=$2 GROUP BY s.id ORDER BY s.id`, [userId, date]);
  return { date, exists: !!d, day: d ? { ...d, weight_kg: d.weight_kg == null ? null : Number(d.weight_kg) } : null, workouts: ws.map(w => ({ ...w, sets: (w.sets || []).map(x => ({ ...x, weight_kg: Number(x.weight_kg) })) })) };
}
const normDay = (s) => { const d = s?.day || {}; return { food_items: (d.food_items || []).map(canonJ).sort(), weight_kg: d.weight_kg ?? null, water_ml: Number(d.water_ml) || 0,
  sleep: blankSleep(d.sleep) ? {} : noNullsObj(d.sleep), activities: noNullsObj(d.activities), acv: noNullsObj(d.acv), supplements: noNullsObj(d.supplements), notes: typeof d.notes === 'string' ? d.notes : '' }; };
/** What changed since the baseline: food entries added/removed (duplicates counted), other fields, workouts. */
function dayDiff(base, now) {
  const a = normDay(base), b = normDay(now);
  const bag = (list) => { const m = new Map(); for (const x of list) m.set(x, (m.get(x) || 0) + 1); return m; };
  const minus = (x, y) => { const m = bag(y), out = []; for (const e of x) { if (m.get(e)) m.set(e, m.get(e) - 1); else out.push(JSON.parse(e)); } return out; };
  const added = minus(b.food_items, a.food_items), removed = minus(a.food_items, b.food_items);
  const fields = DAY_FIELDS.filter(k => canonJ(a[k]) !== canonJ(b[k])).map(k => ({ field: k, before: a[k], after: b[k] }));
  const workouts = canonJ((base?.workouts || []).map(w => ({ ...w, id: undefined, sets: w.sets.map(x => ({ ...x, id: undefined })) }))) !== canonJ((now?.workouts || []).map(w => ({ ...w, id: undefined, sets: w.sets.map(x => ({ ...x, id: undefined })) })));
  return { same: !added.length && !removed.length && !fields.length && !workouts, added_foods: added, removed_foods: removed, changed_fields: fields, workouts_changed: workouts };
}
/** Put the day back exactly as the baseline (this try's changes only), then compare the whole day again. */
async function restoreDay(db, userId, base) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    if (!base.exists) await client.query(`DELETE FROM daily_logs WHERE patient_id=$1 AND log_date=$2`, [userId, base.date]);
    else {
      const d = base.day;
      const { rowCount } = await client.query(`UPDATE daily_logs SET weight_kg=$3, activities=$4, acv=$5, food_items=$6, water_ml=$7, supplements=$8, sleep=$9, notes=$10 WHERE patient_id=$1 AND log_date=$2`,
        [userId, base.date, d.weight_kg, JSON.stringify(d.activities ?? {}), JSON.stringify(d.acv ?? {}), JSON.stringify(d.food_items ?? []), d.water_ml, JSON.stringify(d.supplements ?? {}), JSON.stringify(d.sleep ?? {}), d.notes]);
      if (!rowCount) await client.query(`INSERT INTO daily_logs (patient_id, log_date, weight_kg, activities, acv, food_items, water_ml, supplements, sleep, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [userId, base.date, d.weight_kg, JSON.stringify(d.activities ?? {}), JSON.stringify(d.acv ?? {}), JSON.stringify(d.food_items ?? []), d.water_ml, JSON.stringify(d.supplements ?? {}), JSON.stringify(d.sleep ?? {}), d.notes]);
    }
    const keepSessions = base.workouts.map(w => w.id), keepSets = base.workouts.flatMap(w => w.sets.map(x => x.id));
    await client.query(`DELETE FROM workout_sessions WHERE patient_id=$1 AND session_date=$2 AND NOT (id = ANY($3::int[]))`, [userId, base.date, keepSessions]);
    if (keepSessions.length) await client.query(`DELETE FROM session_sets WHERE session_id = ANY($1::int[]) AND NOT (id = ANY($2::int[]))`, [keepSessions, keepSets]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
  const after = await dayState(db, userId, base.date);
  const diff = dayDiff(base, after);
  return { ok: diff.same, diff };
}

// ── The export ───────────────────────────────────────────────────────────────
const yes = (b) => (b === true ? 'yes' : b === false ? 'no' : '');
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 19).replace('T', ' ') + ' UTC' : '');
const pct = (n, d) => (d ? `${Math.round(n / d * 100)}%` : '');
/** How a take is counted in Part A, from the fluent listener's label: speech, no-speech, uncertain, protocol deviation (heard ≠ intended) or unlabelled. */
function truth(t, intended) {
  if (!t.heard) return 'unlabelled';
  if (t.heard === 'uncertain') return 'uncertain';
  const heard = t.heard === 'speech' ? 'speech' : 'no-speech';
  return heard === intended ? heard : 'protocol deviation';
}
/** A take's line result for one engine, with the listener's reference applied. */
function takeScore(t, info, engine) {
  const unscorable = t.heard === 'uncertain' || (t.spoken_as_script === false && !(Array.isArray(t.reference_items) && t.reference_items.length));
  return scoreTranscript(itemsWithReference(info.items || [], t.reference_items), t[`${engine}_text`], info.lang, { error: t[`${engine}_error`], unscorable });
}
/** The takes a candidate setting would newly admit (live refuses, the candidate accepts). */
const newlyAdmitted = (t, g) => decision(t, g) === 'accept' && decision(t, SP.LIVE_LIMITS) === 'refuse';
const engineCalls = (t) => (t.gemini_provenance?.attempts?.length || 0) + (t.whisper_provenance?.attempts?.length || 0);
/**
 * The workbook's sheets, from database rows. Pure (unit-tested). No names and no audio:
 * volunteers appear by code (P1…), Part C operators as C1/C2.
 */
function workbookSheets({ participants = [], takes = [], wording = [], partc = [], evals = [], generatedAt = new Date() }) {
  const active = participants.filter(p => !p.withdrawn_at);
  const byId = new Map(participants.map(p => [p.id, p]));
  const current = takes.filter(t => !t.superseded_at);
  const enrich = (t) => { const p = byId.get(t.participant_id) || {}; return { t, p, info: slotInfo(t.slot_code, p.grp) || {} }; };
  const mismatches = takes.filter(t => !replayMatches(t)).length;
  const remeasureMismatch = takes.filter(t => t.remeasure && t.remeasure.match === false).length;
  const wordingRow = (lang) => { const w = wording.find(x => x.lang === lang); const ok = w && w.script_sha256 === scriptSha(lang); return { w, ok }; };
  const attempts = partc.flatMap(r => (r.captures || []).filter(c => c.kind === 'server recording' || c.kind === 'on-device dictation').map(c => ({ ...c, trial: r.trial_no })));

  const about = [['item', 'value'],
    ['what this is', 'FitLife voice calibration round 1 (B18/B19). TEST SERVER ONLY. Volunteers appear as codes (P1–P6); no names, no audio.'],
    ['script version', `${SCRIPT_VERSION} (frozen for the round; any wording change voids that language's fluent-speaker check)`],
    ['generated', iso(generatedAt)],
    ['detector', SP.VERSION],
    ['live setting (unchanged)', `voiced >= ${SP.LIVE_LIMITS.min_voiced_ms} ms, run >= ${SP.LIVE_LIMITS.min_run_ms} ms, pitch spread >= ${SP.LIVE_LIMITS.min_f0_spread_hz} Hz`],
    ['offline settings (screening only)', GRID.map(g => `${g.id}${g.live ? ' (live)' : ''}`).join(', ')],
    ['volunteers', `${active.length} of ${MAX_PARTICIPANTS} (Kannada ${active.filter(p => p.grp === 'kn').length}/${GROUPS.kn.quota}, Hindi ${active.filter(p => p.grp === 'hi').length}/${GROUPS.hi.quota}, English ${active.filter(p => p.grp === 'en').length}/${GROUPS.en.quota})`],
    ['planned recording slots', `${PLANNED_TOTAL} for the full cohort: 108 speech, 36 no-speech controls (Kannada ${PLANNED_PER_GROUP.kn}, Hindi ${PLANNED_PER_GROUP.hi}, English ${PLANNED_PER_GROUP.en} each)`],
    ['slots recorded', `${new Set(current.map(t => `${t.participant_id}|${t.slot_code}`)).size}`],
    ['takes kept (all)', `${takes.length}: ${current.length} current, ${takes.length - current.length} superseded by a technical retake (reasons in Takes)`],
    ['budget: initial transcription calls', `planned ${PLANNED_TOTAL * 2} (both engines × ${PLANNED_TOTAL} recordings); made so far ${current.reduce((n, t) => n + engineCalls(t), 0)} on current takes`],
    ['budget: retakes and provider retries (counted separately)', `${takes.filter(t => t.superseded_at).reduce((n, t) => n + engineCalls(t), 0)} calls on superseded takes; ${takes.reduce((n, t) => n + Math.max(0, (t.gemini_provenance?.attempts?.length || 0) - 1), 0)} extra Gemini model attempts after a failure`],
    ['budget: rule 3 parser calls (separate)', `${evals.reduce((n, e) => n + (e.parser_calls || 0), 0)} (at most 2 per newly admitted take, deduplicated by take)`],
    ['budget: Part C attempts', `${attempts.length} of 64 planned (32 tries + one Retry each), before technical retakes`],
    ['replay check: stored live decision vs offline replay at the live setting', mismatches ? `${mismatches} MISMATCH(ES): do not use the offline settings until explained` : `0 mismatches over ${takes.length} take(s)`],
    ['re-measure check: stored measurements vs measuring the stored audio again', remeasureMismatch ? `${remeasureMismatch} MISMATCH(ES)` : `${takes.filter(t => t.remeasure).length} take(s) re-measured, 0 mismatches`],
    ...['kn', 'hi', 'en'].map(l => { const { w, ok } = wordingRow(l); return [`wording check: ${LANG_NAME[l]}`, ok ? `confirmed by ${w.confirmed_by}, ${iso(w.confirmed_at)}` : w ? 'VOID: the lines changed after the check' : 'NOT CONFIRMED: these lines cannot be recorded yet']; }),
    ['Part C', `${PARTC_PLAN.length} planned controlled tries (2 operators × 8 lines × 2 provider legs) and up to ${NATURAL_SLOTS} natural observations; ${partc.filter(r => (r.captures || []).length).length} with a recorded event`],
    ['counting rule', 'Part A counts current takes by the fluent listener\'s label. Uncertain labels, protocol deviations (heard ≠ intended, e.g. a TV voice in a control), unlabelled takes, retakes and capture failures are counted and shown, never dropped silently.'],
    ['what this round cannot do', 'Descriptive counts for six people and their phones. It cannot choose an engine or certify a threshold; a zero count is not a guaranteed rate. Any candidate setting is a proposal for review.'],
  ];

  const plan = [['group', 'slot', 'kind', 'place', 'language', 'line', 'say', 'intended label']];
  for (const g of Object.keys(GROUPS)) for (const s of slotPlan(g)) { const i = slotInfo(s.slot, g); plan.push([GROUPS[g].name, s.slot, s.kind, PLACES[s.place], s.lang ? LANG_NAME[s.lang] : '', s.line, i.say, s.label]); }
  const lines = [['line', 'language', 'say', 'means', 'items scored', 'wording check', 'script sha256']];
  for (const [id, l] of Object.entries(LINES)) { const { w, ok } = wordingRow(l.lang); lines.push([id, LANG_NAME[l.lang], l.say, l.means, l.items.map(i => i.label).join(' · '), ok ? `confirmed by ${w.confirmed_by}` : w ? 'void (lines changed)' : 'not confirmed', scriptSha(l.lang).slice(0, 16)]); }
  const slots = [['volunteer', 'group', 'slot', 'kind', 'place', 'language', 'status', 'takes', 'current take']];
  for (const p of active) for (const s of slotPlan(p.grp)) {
    const mine = takes.filter(t => t.participant_id === p.id && t.slot_code === s.slot);
    const cur = mine.find(t => !t.superseded_at);
    const { ok } = s.lang ? wordingRow(s.lang) : { ok: true };
    slots.push([p.code, GROUPS[p.grp].name, s.slot, s.kind, PLACES[s.place], s.lang ? LANG_NAME[s.lang] : '', cur ? 'recorded' : ok ? 'not recorded' : 'locked (wording not confirmed)', mine.length, cur ? cur.take_no : '']);
  }

  const G = GRID.map(g => `decision ${g.id}${g.live ? ' (live)' : ''}`);
  const takesSheet = [['volunteer', 'slot', 'take', 'current', 'retake reason', 'superseded at', 'recorded at', 'kind', 'place', 'language', 'intended', 'heard (listener)', 'said as written', 'reference transcript', 'corrected numbers', 'counted as',
    'phone', 'browser', 'installed app', 'seconds', 'audio type', 'audio sha256', 'speech check', 'detector', 'voiced frames', 'longest run frames', 'pitch spread (raw Hz)', 'hop ms', 'voiced ms', 'longest run ms',
    'live decision (stored)', 'replay at live setting', 'replay matches', 're-measure', ...G,
    'gemini words', 'gemini line result', 'gemini flags', 'gemini model used', 'gemini model reported', 'gemini attempts', 'gemini generated-text guard', 'gemini problem',
    'whisper words', 'whisper line result', 'whisper flags', 'whisper language sent', 'whisper language reported', 'whisper fallback decision', 'whisper problem', 'prompt sha256 (gemini / whisper)']];
  for (const t of [...takes].sort((a, b) => String(byId.get(a.participant_id)?.code).localeCompare(String(byId.get(b.participant_id)?.code), undefined, { numeric: true }) || a.slot_code.localeCompare(b.slot_code) || a.take_no - b.take_no)) {
    const { p, info } = enrich(t);
    const live = t.speech_status === 'speech' ? 'accept' : t.speech_status === 'no_speech' ? 'refuse' : 'not checked';
    const gp = t.gemini_provenance || {}, wp = t.whisper_provenance || {};
    const gs = info.items?.length ? takeScore(t, info, 'gemini') : null, ws = info.items?.length ? takeScore(t, info, 'whisper') : null;
    takesSheet.push([p.code, t.slot_code, t.take_no, yes(!t.superseded_at), t.retake_reason ? `${t.retake_reason}${t.retake_note ? `: ${t.retake_note}` : ''}` : '', iso(t.superseded_at), iso(t.created_at),
      info.kind || '', PLACES[info.place] || '', info.lang ? LANG_NAME[info.lang] : '', info.label || '', t.heard || '', yes(t.spoken_as_script), t.reference_text || '',
      Array.isArray(t.reference_items) ? t.reference_items.map(r => `${r.label} → ${r.n}`).join('; ') : '', truth(t, info.label),
      t.phone_type || p.phone_type || '', t.browser || p.browser || '', yes(t.installed_app ?? p.installed_app), t.duration_ms ? (Number(t.duration_ms) / 1000).toFixed(1) : '', t.mime_type || '', (t.audio_sha256 || '').slice(0, 16),
      t.speech_status || '', t.detector_version || '', t.voiced_frames ?? '', t.longest_run_frames ?? '', t.f0_spread_raw ?? '', t.hop_ms ?? '', t.voiced_ms ?? '', t.longest_run_ms ?? '',
      live, decision(t, SP.LIVE_LIMITS), replayMatches(t) ? 'yes' : 'NO', t.remeasure ? (t.remeasure.match ? 'same' : 'DIFFERENT') : '', ...GRID.map(g => decision(t, g)),
      t.gemini_text ?? '', gs ? gs.line : '', gs ? gs.flags.join('; ') : '', gp.model_used || '', gp.model_version || '', (gp.attempts || []).map(a => `${a.model}: ${a.outcome}${a.status ? ` ${a.status}` : ''}`).join('; '),
      t.gemini_text == null ? '' : t.gemini_generated ? 'would refuse (generated text)' : 'passes', t.gemini_text == null ? (t.gemini_error || 'no answer') : !/\S/.test(t.gemini_text) ? 'empty answer' : '',
      t.whisper_text ?? '', ws ? ws.line : '', ws ? ws.flags.join('; ') : '', wp.language_sent || 'not set', wp.language_reported || '', t.whisper_review ? (t.whisper_review.accepted ? 'accepted' : `refused: ${t.whisper_review.reason}`) : '',
      t.whisper_text == null ? (t.whisper_error || 'no answer') : !/\S/.test(t.whisper_text) ? 'empty answer' : '', `${gp.prompt_sha256 || ''} / ${wp.prompt_sha256 || ''}`]);
  }

  // Part B: every current speech take × engine × item.
  const items = [['volunteer', 'slot', 'line', 'language', 'place', 'kind', 'phone', 'engine', 'line result', 'line flags', 'item', 'expected (after listener corrections)', 'outcome', 'heard', 'listener confirmed what was said', 'recheck needed', 'kannada number word']];
  const scored = [];
  for (const t of current) {
    const { p, info } = enrich(t);
    if (!info.items?.length) continue;
    const eff = itemsWithReference(info.items, t.reference_items);
    for (const engine of ['gemini', 'whisper']) {
      const s = takeScore(t, info, engine);
      scored.push({ t, p, info, engine, s });
      const base = [p.code, t.slot_code, info.line, LANG_NAME[info.lang], PLACES[info.place], info.kind, p.phone_type || '', engine, s.line, s.flags.join('; ')];
      if (!s.items.length) items.push([...base, '', '', '', '', yes(t.spoken_as_script), '', '']);
      s.items.forEach((r, k) => items.push([...base, r.label, eff[k]?.n ?? '', r.outcome, r.heard, yes(t.spoken_as_script), r.outcome === 'wrong number' && t.spoken_as_script !== true ? 'yes: listen again before calling it an engine error' : '', info.items[k]?.word || '']));
      for (const x of s.extra) items.push([...base, '(not said)', '', 'extra', x, yes(t.spoken_as_script), '', '']);
    }
  }

  // Part A summary: every setting, per slice and per volunteer, with the real denominators.
  const all = takes.map(t => { const e = enrich(t); return { ...e, truth: truth(t, e.info.label), cur: !t.superseded_at }; });
  const evalOf = (id) => evals.filter(e => e.take_id === id);
  const partA = [['setting', 'slice', 'current takes', 'retakes (superseded, not counted)', 'capture failures (not checked)', 'speech takes (listener)', 'missed speech (refused)', 'missed %', 'no-speech takes (listener)', 'accepted non-speech (absolute)',
    'protocol deviations (heard ≠ intended)', 'uncertain labels', 'unlabelled', 'newly accepted speech vs live', 'newly accepted non-speech vs live', 'rule 3: newly accepted takes with both legs judged', 'rule 3: disqualified takes', 'rule 3: not yet judged', 'screening result (all slice; a proposal, never a release)']];
  const slices = [['all', () => true], ...['kn', 'hi', 'en'].map(l => [`language ${LANG_NAME[l]}`, (x) => x.info.lang === l]), ...Object.entries(PLACES).map(([k, v]) => [`place ${v}`, (x) => x.info.place === k]),
    ['short lines', (x) => x.info.kind === 'short'], ['soft lines', (x) => x.info.kind === 'soft'], ...Object.keys(CONTROLS).map(c => [`control ${c}`, (x) => x.info.line === c]),
    ...['android_budget', 'android_mid', 'iphone'].map(ph => [`phone ${ph}`, (x) => (x.t.phone_type || x.p.phone_type) === ph]),
    ...active.map(p => [`volunteer ${p.code}`, (x) => x.p.id === p.id])];
  const liveMissed = all.filter(x => x.cur && x.truth === 'speech' && decision(x.t, SP.LIVE_LIMITS) === 'refuse').length;
  for (const g of GRID) for (const [name, fn] of slices) {
    const xs = all.filter(fn), cur = xs.filter(x => x.cur);
    const sp = cur.filter(x => x.truth === 'speech'), ns = cur.filter(x => x.truth === 'no-speech');
    const missed = sp.filter(x => decision(x.t, g) === 'refuse').length;
    const newly = cur.filter(x => x.info.label === 'speech' && x.truth !== 'no-speech' && newlyAdmitted(x.t, g));
    const newlyNs = ns.filter(x => newlyAdmitted(x.t, g)).length;
    const judged = newly.filter(x => ['gemini', 'whisper'].every(e => evalOf(x.t.id).some(v => v.engine === e)));
    const disq = newly.filter(x => evalOf(x.t.id).some(v => v.judgment?.result === 'disqualifying'));
    let screen = '';
    if (name === 'all' && !g.live) {
      const fails = [], open = [];
      if (newlyNs > 0) fails.push(`rule 1: ${newlyNs} more non-speech accepted`);
      const recovered = sp.filter(x => decision(x.t, SP.LIVE_LIMITS) === 'refuse' && decision(x.t, g) === 'accept').length;
      if (!(recovered >= 3 && recovered * 2 >= liveMissed)) fails.push(`rule 2: recovers ${recovered} of ${liveMissed} missed (needs ≥ half and ≥ 3)`);
      if (disq.length) fails.push(`rule 3: ${disq.length} newly admitted take(s) disqualified`);
      if (newly.length - judged.length) open.push(`rule 3: ${newly.length - judged.length} newly admitted take(s) not yet judged`);
      screen = fails.length ? `fails screen: ${fails.join('; ')}` : open.length ? `incomplete: ${open.join('; ')}` : 'passes the screen (rule 4, the gate, still to run); a proposal for review only';
    }
    partA.push([`${g.id}${g.live ? ' (live)' : ''}`, name, cur.length, xs.length - cur.length, cur.filter(x => decision(x.t, g) === 'not checked').length, sp.length, missed, pct(missed, sp.length), ns.length,
      ns.filter(x => decision(x.t, g) === 'accept').length, cur.filter(x => x.truth === 'protocol deviation').length, cur.filter(x => x.truth === 'uncertain').length, cur.filter(x => x.truth === 'unlabelled').length,
      newly.length, newlyNs, judged.length, disq.length, newly.length - judged.length, screen]);
  }
  // Rule 3: each newly admitted take's two legs through the logging parser's preview.
  const rule3 = [['volunteer', 'slot', 'take', 'settings that newly admit it', 'engine', 'stage', 'preview judgment', 'disqualifying problems', 'items', 'parser calls', 'judged at']];
  for (const e of evals) {
    const t = takes.find(x => x.id === e.take_id); if (!t) continue;
    const { p } = enrich(t);
    rule3.push([p.code, t.slot_code, t.take_no, GRID.filter(g => newlyAdmitted(t, g)).map(g => g.id).join(', '), e.engine, e.stage, e.judgment?.result || '', (e.judgment?.problems || []).join('; '),
      (e.judgment?.items || []).map(i => `${i.label}: ${i.outcome}${i.shown ? ` (${i.shown})` : ''}`).join('; '), e.parser_calls || 0, iso(e.created_at)]);
  }

  // Part B summary: every line outcome, per engine × language × place and per volunteer.
  const partB = [['engine', 'slice', 'lines', ...LINE_OUTCOMES, 'quantities exact', 'quantities scored', 'wrong numbers not yet confirmed by the listener']];
  const bRow = (engine, name, xs) => {
    const q = xs.flatMap(x => x.s.items.map((r, k) => ({ r, it: x.info.items[k] }))).filter(({ it }) => it && it.kind !== 'presence');
    partB.push([engine, name, xs.length, ...LINE_OUTCOMES.map(o => xs.filter(x => x.s.line === o).length), q.filter(({ r }) => OK_ITEM.has(r.outcome)).length, q.length,
      xs.filter(x => x.s.flags.includes('wrong number') && x.t.spoken_as_script !== true).length]);
  };
  for (const engine of ['gemini', 'whisper']) {
    for (const l of ['kn', 'hi', 'en']) for (const pl of ['q', 'n']) bRow(engine, `${LANG_NAME[l]}, ${PLACES[pl]}`, scored.filter(x => x.engine === engine && x.info.lang === l && x.info.place === pl));
    for (const p of active) bRow(engine, `volunteer ${p.code}`, scored.filter(x => x.engine === engine && x.p.id === p.id));
  }
  const words = [['kannada number word', 'value', 'items with this word', 'gemini: number kept', 'gemini: wrong number', 'whisper: number kept', 'whisper: wrong number']];
  const kept = (o) => ['correct', 'unit alias', 'wrong unit', 'unit missing'].includes(o);
  const allWords = [...new Set(Object.values(LINES).flatMap(l => l.items.filter(i => i.word).map(i => `${i.word}=${i.n}`)))];
  for (const wv of allWords) {
    const [w, v] = wv.split('=');
    const rows = (engine) => scored.filter(x => x.engine === engine).flatMap(x => x.s.items.map((r, k) => ({ r, it: x.info.items[k] }))).filter(({ it }) => it && it.word === w && String(it.n) === v);
    const gq = rows('gemini'), wq = rows('whisper');
    words.push([w, Number(v), gq.length, gq.filter(({ r }) => kept(r.outcome)).length, gq.filter(({ r }) => r.outcome === 'wrong number').length, wq.filter(({ r }) => kept(r.outcome)).length, wq.filter(({ r }) => r.outcome === 'wrong number').length]);
  }
  const ctl = [['volunteer', 'slot', 'place', 'heard (listener)', 'counted as', 'live decision', 'gemini words', 'whisper words', 'whisper fallback decision']];
  for (const t of current) { const { p, info } = enrich(t); if (info.kind !== 'control') continue;
    ctl.push([p.code, t.slot_code, PLACES[info.place] || '', t.heard || '', truth(t, 'no-speech'), decision(t, SP.LIVE_LIMITS), t.gemini_text ?? '(no answer)', t.whisper_text ?? '(no answer)', t.whisper_review ? (t.whisper_review.accepted ? 'accepted' : `refused: ${t.whisper_review.reason}`) : '']); }

  // Part C: one row per try, and a ledger of every event.
  const pc = [['try', 'route', 'operator', 'line', 'voice language', 'say', 'expected', 'planned provider leg', 'attempts', 'retries', 'actual paths', 'counts as a test of the planned provider', 'previews', 'previews from EDITED text',
    'latest read-back', 'restore: whole day equal to the baseline', 'voice backup switch verified off', 'items marked right', 'items marked wrong', 'applied', 'day correct', 'notes', 'finished']];
  for (const t of [...PARTC_PLAN, ...NATURAL_PLAN]) {
    const r = partc.find(x => x.trial_no === t.trial) || {};
    const caps = r.captures || [];
    const att = caps.filter(c => c.kind === 'server recording' || c.kind === 'on-device dictation');
    const prev = caps.filter(c => c.kind === 'preview');
    const planned = (c) => c.kind === 'server recording' && (t.path === 'gemini' ? /^gemini\//.test(c.answered_by) && !c.voice_backup_switch : /whisper/.test(c.answered_by) && c.voice_backup_switch);
    if (t.route === 'natural' && !caps.length && !r.trial_no) continue;
    const marks = Array.isArray(r.items) ? r.items : [];
    const rb = (r.readbacks || []).slice(-1)[0];
    pc.push([t.trial, t.route, t.speaker, t.line, t.lang ? LANG_NAME[t.lang] : '', t.say, t.expect, t.route === 'natural' ? 'none (natural observation)' : t.path === 'gemini' ? 'Gemini (switch off)' : 'Whisper fallback (switch on)',
      att.length, att.filter(c => c.retry_of).length, [...new Set(att.map(c => c.actual_path))].join('; '),
      t.route === 'natural' ? 'no (natural observation)' : att.some(planned) ? 'yes' : att.length ? 'NO: the planned provider never answered (see actual paths)' : '',
      prev.length, prev.filter(c => c.edited).length,
      rb ? (rb.diff.same ? 'no change' : `added ${rb.diff.added_foods.length} food(s); fields ${rb.diff.changed_fields.map(f => f.field).join(', ') || 'none'}; workouts ${rb.diff.workouts_changed ? 'changed' : 'same'}`) : '',
      r.cleanup ? (r.cleanup.ok ? 'yes' : `NO: ${JSON.stringify(r.cleanup.diff).slice(0, 160)}`) : '', yes(r.switch_off_verified),
      marks.filter(m => m.ok === true).map(m => m.label).join('; '), marks.filter(m => m.ok === false).map(m => m.label).join('; '), yes(r.applied), yes(r.day_correct), r.notes || '', iso(r.finished_at)]);
  }
  const ledger = [['try', 'event', 'kind', 'at', 'attempt', 'retry of attempt', 'audio uploaded', 'actual path', 'engines tried', 'voice backup switch', 'speech check', 'words or refusal', 'preview', 'preview text source']];
  for (const r of partc) (r.captures || []).forEach((c, i) => ledger.push([r.trial_no, i + 1, c.kind, iso(c.at), c.attempt ?? '', c.retry_of ?? '', c.upload == null ? '' : yes(c.upload), c.actual_path || '',
    (c.trail || []).map(x => `${x.engine}${x.model ? `/${x.model}` : ''}: ${x.outcome}`).join('; '), c.kind === 'server recording' ? yes(c.voice_backup_switch) : '',
    c.speech ? `${c.speech.status} (${c.speech.voiced_ms ?? '—'} ms voiced)` : '', c.kind === 'preview' ? c.message : c.rejected ? `refused: ${c.rejected}` : c.transcript ?? c.error ?? '',
    c.preview ? [...(c.preview.foods || []).map(f => `${f.qty_text || ''} ${f.name}`.trim()), c.preview.weight_kg != null ? `weight ${c.preview.weight_kg}` : '', c.preview.water_ml_add ? `water ${c.preview.water_ml_add} ml` : '', c.preview.question ? 'question / no log card' : ''].filter(Boolean).join('; ') : '',
    c.text_source || '']));
  const vols = [['volunteer', 'group', 'profile', 'phone', 'browser', 'installed app', 'consented', 'consent version', 'slots planned', 'slots recorded', 'takes kept']];
  for (const p of active) vols.push([p.code, GROUPS[p.grp].name, p.profile_note || '', p.phone_type || '', p.browser || '', yes(p.installed_app), iso(p.consented_at), p.consent_version || '', PLANNED_PER_GROUP[p.grp],
    new Set(current.filter(t => t.participant_id === p.id).map(t => t.slot_code)).size, takes.filter(t => t.participant_id === p.id).length]);

  return [
    { name: 'About', rows: about }, { name: 'Volunteers', rows: vols }, { name: 'Plan', rows: plan }, { name: 'Lines', rows: lines }, { name: 'Slots', rows: slots },
    { name: 'Takes', rows: takesSheet }, { name: 'Items', rows: items }, { name: 'Part A summary', rows: partA }, { name: 'Rule 3 previews', rows: rule3 }, { name: 'Part B summary', rows: partB },
    { name: 'Number words', rows: words }, { name: 'Controls', rows: ctl }, { name: 'Part C tries', rows: pc }, { name: 'Part C events', rows: ledger },
  ];
}

module.exports = {
  CONSENT_VERSION, SCRIPT_VERSION, LINES, CONTROLS, PLACES, LANG_HINT, LANG_NAME, GROUPS, MAX_PARTICIPANTS, slotPlan, slotInfo, PLANNED_PER_GROUP, PLANNED_TOTAL,
  linesFor, scriptSha, GRID, featuresOf, decision, replayMatches, newlyAdmitted, tokens, phrasesOf, scoreTranscript, itemsWithReference, scriptProblem, ITEM_OUTCOMES, LINE_OUTCOMES,
  judgePreview, voiceLeg, geminiModels, geminiTake, whisperTake, transcribeTake,
  PARTC_PLAN, PARTC_LINES, NATURAL_PLAN, NATURAL_SLOTS, trialInfo, ARM_MINUTES, available, armedFor, recordTrial, recordDeviceDictation, recordPreview, answeredBy, speechRecord, actualPath,
  dayState, dayDiff, restoreDay, workbookSheets, truth, takeScore,
};
