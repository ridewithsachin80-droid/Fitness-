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
 *
 * Fixes-2y (the 2x kit review, 24 Oct): screening passes only on completed, valid evidence with full
 * coverage; the transcript and preview judges catch count-unit errors, unnumbered extras, unexplained
 * words (a hand check, never "all correct") and every saveable field; the fluent listener's reference
 * is frozen and versioned BEFORE transcripts are shown, and a changed reference makes the earlier
 * judgments stale (kept, never reused); Part C tries are sessions that stay recoverable until the day
 * is back to its baseline and the Voice backup switch is verified off; devices are recorded per take;
 * the export uses reviewer codes, keeps every history and removes registered names from free text.
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
/** The judges' rules (scoreTranscript, judgePreview). Stored with every judgment; a change makes earlier judgments stale. */
const JUDGE_VERSION = 'judge-3a.1';   // Fixes-3a: every weight shown AND the amount that would be saved are judged (judgments under judge-2y.1 are stale)

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
/** Fixes-2z: authorised replacements of excluded takes, agreed before collection: at most 12 for the round (two per volunteer on
 *  average, a third of the 36 controls). Past that, no more are authorised: the round stays incomplete until it is reviewed. */
const REPLACEMENT_BUDGET = 12;
/** Fixes-3a: the ledger's round (voice_calibration_replacement_grants.round; the database allows grant numbers 1..12 per round). */
const REPLACEMENT_ROUND = 'round1';

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
// Fixes-2y: foods the script never names, so an unnumbered extra ("… and banana") is caught. Not a complete
// list: any other unexplained word goes to a hand check instead of "all correct".
const EXTRA_FOODS = {
  rice: 'rice|chawal|chaval|annam|ಅನ್ನ|चावल', dosa: 'dosa|dosai|dosey|ದೋಸೆ|डोसा', vada: 'vada|vadai|wada|vade|ವಡೆ|वड़ा|वडा', banana: 'banana|bananas|kela|baalehannu|balehannu|ಬಾಳೆಹಣ್ಣು|केला',
  apple: 'apple|apples|seb|सेब', bread: 'bread|pav|bun|buns|toast', tea: 'tea|chai|chaha|ಚಹಾ|चाय', sugar: 'sugar|sakkare|cheeni|chini|चीनी', poha: 'poha|avalakki|aval',
  paratha: 'paratha|parotta|parantha|पराठा', curry: 'curry|sabzi|sabji|palya|सब्ज़ी|सब्जी', chicken: 'chicken|koli|मुर्गा', fish: 'fish|meenu|machli|मछली', paneer: 'paneer|पनीर',
  biscuit: 'biscuit|biscuits|cookie|cookies', juice: 'juice|jus', ragi: 'ragi|mudde', chutney: 'chutney|chatni|चटनी', pongal: 'pongal', khichdi: 'khichdi|khichri|खिचड़ी',
  lassi: 'lassi|majjige|buttermilk|chaas|छाछ', ghee: 'ghee|tuppa|घी', fruit: 'fruit|fruits|phal|hannu|फल', salad: 'salad', sweet: 'sweet|sweets|mithai|halwa|ladoo|laddu',
};
const ALL_FOODS = { ...FOOD, ...EXTRA_FOODS };
const UNIT = {
  bowl: 'bowl|bowls|baul|ಬೌಲ್', plate: 'plate|plates|plet|ಪ್ಲೇಟ್', cup: 'cup|cups|kap|ಕಪ್', katori: 'katori|katoris|katora|kathori|कटोरी|ಕಟೋರಿ',
  glass: 'glass|glasses|gilas|lota|गिलास|ग्लास', litre: 'litre|litres|liter|liters|ltr|l|litar|ಲೀಟರ್|लीटर', kg: 'kg|kgs|kilo|kilos|kilogram|kilograms|ಕೆಜಿ|किलो|किलोग्राम',
  pound: 'pound|pounds|lb|lbs', set: 'set|sets|ಸೆಟ್', rep: 'rep|reps|repetitions|ರೆಪ್ಸ್', minute: 'minute|minutes|min|mins|nimisha|ನಿಮಿಷ|मिनट',
  // Fixes-2y: count words. Neutral for a counted food ("2 pieces idli" is 2 idli); any other unit on a counted food is a wrong unit.
  piece: 'piece|pieces|pc|pcs|nos',
  gram: 'gram|grams|gm|gms|g|ग्राम', ml: 'ml|millilitre|millilitres|milliliter|milliliters',
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
// Fixes-2y: words that carry no item (articles, "ate", "today", meal names, the common Hindi/Kannada glue words,
// in Roman and Devanagari). Anything else not in the line's own words, its meaning or the listener's
// reference text is "unexplained" and sends the line to a hand check.
const GENERIC_WORDS = ('a an the of i me my mine is was were are am it its this that these today tonight yesterday morning evening night afternoon noon '
  + 'ate eat eaten eating had have has having drank drink drunk drinking did do done took take taken for at in on with to from also then so ok okay um uh hmm please log add '
  + 'just around about some little bit approximately nearly breakfast lunch dinner supper snack snacks meal weight weighs weighed today\'s i\'m i\'ve '
  + 'maine mai main mera meri mere aaj subah shaam sham raat khaya khaye khayi khana piya piye pi hai tha thi hain ki ka ke ko bhi abhi wazan vajan '
  + 'naanu nanu nanna nange ivattu ivathu belagge beligge belige sanje ratri ratre tinde tindiddu tindide kudide kudidde madide maadide ge alli utakke uta tindi tindige tuka tooka '
  + 'मैंने मैं मेरा मेरी आज सुबह शाम रात खाया खाए खाये खायी पिया है था थी हैं की का के को भी वजन वज़न').split(/\s+/);
const GENERIC = new Set(GENERIC_WORDS.map(w => loose(w.toLowerCase().normalize('NFC').replace(/[^a-z0-9.\u0900-\u097f]+/g, ''))).filter(Boolean));

function tokens(text, keepBreaks = false) {
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
      out.push(BREAKS.has(w) && !keepBreaks ? SEP : w);   // keepBreaks: same positions, joining words kept (Fixes-2z)
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
    phrases.push({ value: n.value, unit, food, text: toks.slice(i, j).filter(x => x !== SEP).join(' '), start: i, end: j });
    taken = j;
    i += n.len - 1;
  }
  return { phrases, toks };
}
// Line outcomes (2x review): complete, so no material error can fall between labels. Item flags coexist.
const LINE_OUTCOMES = ['all correct', 'wrong number', 'wrong unit', 'missing', 'extra', 'empty answer', 'wrong language/script', 'provider error', 'uncertain/unscorable'];
const LINE_PRIORITY = ['provider error', 'empty answer', 'wrong language/script', 'uncertain/unscorable', 'wrong number', 'wrong unit', 'extra', 'missing'];
/** Fixes-2y: a PENDING state, not a tenth outcome. Unexplained words (or a stray number) with no other error:
 *  the listener records one of the nine outcomes by hand; until then the line is never "all correct". */
const HAND_CHECK = 'needs a hand check';
const LINE_STATES = [...LINE_OUTCOMES, HAND_CHECK];
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
/** The food dictionaries a token belongs to, matched STRICTLY (the word itself or a plural): used to find extras,
 *  so "minutes" is never taken for "meenu" by a loose prefix. Items keep the dictionaries' usual reading (isWord). */
const foodKeysOf = (tok) => (tok === SEP || tok == null ? [] : Object.keys(ALL_FOODS).filter(k => variants(ALL_FOODS[k]).some(v => tok === v || tok === `${v}s` || tok === `${v}es`)));
/** A count word ("2 pieces") is neutral for a counted food. */
const pieceUnit = (u) => !!u && isWord(u, UNIT.piece);
/** Fixes-2z: a weight or volume (grams, ml) that can accompany a count ("2 idli, 100 g"): it describes the portion, it is not a second count. */
const isMass = (p) => !!p?.unit && (isWord(p.unit, UNIT.gram) || isWord(p.unit, UNIT.ml));
/** Fixes-2z: the same food counted more than once with the same number: a stutter or a second serving. Only a person can tell. */
const REPEATED = 'repeated (check by hand)';
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
/** A spelling of an allowed word (transliteration varies): same first three letters and at most 1 edit (2 for long words). */
const near = (a, t) => a.length >= 4 && t.length >= 4 && a.slice(0, 3) === t.slice(0, 3) && lev(a, t) <= (Math.max(a.length, t.length) >= 7 ? 2 : 1);

/**
 * Fixes-2y: the listener's reference, as items.
 *  - mode 'as_script' (or no reference yet): the line's own items;
 *  - mode 'corrected': the listener's COMPLETE list of what was said ({ kind, n?, unit?, food? }), which may
 *    add, drop or change foods and units; the 2x form [{ label, n }] (new numbers on the script's items) is still read;
 *  - mode 'unscorable': a deviation the item list cannot describe → every line is "uncertain/unscorable".
 */
function itemsWithReference(items, reference, mode) {
  if (mode === 'unscorable') return items;
  if (!Array.isArray(reference) || !reference.length) return items;
  if (reference.every(r => r && r.kind)) return reference.map(r => ({ ...r, corrected: true }));
  return items.map(it => { const r = reference.find(x => x && x.label === it.label); return r && Number.isFinite(Number(r.n)) ? { ...it, n: Number(r.n), corrected: true } : it; });
}
/** Validate a listener's complete item list. → { items } or { error }. Foods and units must be ones the judges can read. */
function validReferenceItems(list) {
  if (!Array.isArray(list) || !list.length || list.length > 12) return { error: 'List every item actually said (1 to 12).' };
  const out = [];
  for (const r of list) {
    const kind = String(r?.kind || '');
    if (!['count', 'weight', 'presence'].includes(kind)) return { error: 'Each item is a count, a weight or a food with no amount.' };
    const food = r.food == null || r.food === '' ? null : String(r.food);
    const unit = r.unit == null || r.unit === '' ? null : String(r.unit);
    if (food && !ALL_FOODS[food]) return { error: `"${food}" is not a food the judges can read: mark the take unscorable instead.` };
    if (unit && !UNIT[unit]) return { error: `"${unit}" is not a unit the judges can read: mark the take unscorable instead.` };
    const n = r.n == null || r.n === '' ? null : Number(r.n);
    if (kind !== 'presence' && !(Number.isFinite(n) && n > 0 && n < 10000)) return { error: 'A count or a weight needs the number actually said.' };
    if (kind === 'presence' && !food) return { error: 'A food with no amount needs the food.' };
    if (kind === 'count' && !food && !unit) return { error: 'A count needs a food or a unit (for example 3 sets).' };
    // Fixes-2z: a count may carry the weight actually said with it ("2 idli, 100 grams"), so that weight is judged, not dropped.
    const grams = r.grams == null || r.grams === '' ? null : Number(r.grams);
    if (grams != null && !(kind === 'count' && Number.isFinite(grams) && grams > 0 && grams < 10000)) return { error: 'A weight said with a count is a number of grams, on a count item.' };
    const label = kind === 'weight' ? `weight ${n} kg` : kind === 'presence' ? food : `${[n, unit, food].filter(Boolean).join(' ')}${grams != null ? ` (${grams} g)` : ''}`;
    out.push(kind === 'weight' ? { kind, n, label } : kind === 'presence' ? { kind, food, label } : { kind, n, ...(unit ? { unit } : {}), ...(food ? { food } : {}), ...(grams != null ? { grams } : {}), label });
  }
  return { items: out };
}
/** The reference's identity: everything scoring depends on. A new version (any change) has a new hash. */
const referenceSha = (r) => sha256(canonJ({ heard: r.heard ?? null, spoken_as_script: r.spoken_as_script ?? null, mode: r.mode ?? null, items: r.items ?? null, text: r.text ?? null }));

/**
 * Score one transcript against a line's items.
 * → { line: one of LINE_OUTCOMES, or 'needs a hand check'; flags: every line outcome that applies; items; extra; unexplained }
 * "all correct" only when no flag applies AND every word is explained. opts.unscorable: the listener could not
 * establish what was said. opts.allowedText: the line's own words, its meaning and the listener's reference text.
 */
function scoreTranscript(items, transcript, lang, { error = null, unscorable = false, allowedText = [] } = {}) {
  if (transcript == null) return { line: 'provider error', flags: ['provider error'], items: [], extra: [], unexplained: [], error: error || 'no answer' };
  if (!/\S/.test(transcript)) return { line: 'empty answer', flags: ['empty answer'], items: [], extra: [], unexplained: [] };
  const flags = new Set();
  if (scriptProblem(transcript, lang)) flags.add('wrong language/script');
  if (unscorable) flags.add('uncertain/unscorable');
  const { phrases, toks } = phrasesOf(transcript, lang);
  const used = new Set();
  const heardText = (list) => list.map(p => p.text).join('; ');
  const res = items.map(it => {
    if (it.kind === 'presence') {
      // A workout count ("squat 3 sets") is not an amount for the exercise: sets, reps and minutes are their own items.
      // …nor is a phrase that belongs to another item ("1 cup coffee chutney": the cup is the coffee's).
      const otherFoods = items.filter(x => x !== it && x.food).map(x => x.food);
      const withAmount = phrases.filter(p => p.food.some(t => isWord(t, ALL_FOODS[it.food])) && !(p.unit && ['set', 'rep', 'minute'].some(u => isWord(p.unit, UNIT[u])))
        && !p.food.some(t => otherFoods.some(f => isWord(t, ALL_FOODS[f]))));
      withAmount.forEach(p => used.add(p));
      if (withAmount.length) return { label: it.label, outcome: 'invented amount', heard: heardText(withAmount) };   // no amount was spoken (k04's curd)
      return { label: it.label, outcome: toks.some(t => isWord(t, ALL_FOODS[it.food])) ? 'correct (no amount spoken)' : 'missing', heard: '' };
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
    const mine = phrases.filter(p => (it.food ? p.food.some(t => isWord(t, ALL_FOODS[it.food])) : (p.unit && isWord(p.unit, UNIT[it.unit]))));
    mine.forEach(p => used.add(p));
    if (!mine.length) return { label: it.label, outcome: it.food && toks.some(t => isWord(t, ALL_FOODS[it.food])) ? 'food heard, no number' : 'missing', heard: '' };
    const valueOk = (p) => p.value === it.n;
    // Fixes-2y: a counted food with no spoken unit ("2 idli") takes no unit but a count word: "2 kg idli" is a wrong unit.
    const unitState = (p) => (!it.unit ? (!p.unit || pieceUnit(p.unit) ? 'ok' : 'wrong') : p.unit && isWord(p.unit, UNIT[it.unit]) ? 'ok' : p.unit && it.unitAlias && isWord(p.unit, UNIT[it.unitAlias]) ? 'alias' : p.unit ? 'wrong' : 'missing');
    // Fixes-2z: EVERY mention is judged. A gram/ml mention beside a single count describes that count ("2 idli 100 g idli");
    // two or more counts are either conflicting (different numbers) or repeated (the same number twice) — never simply correct.
    const counts = mine.filter(p => !isMass(p)), judged = counts.length ? counts : mine;
    const good = judged.filter(valueOk), bad = judged.filter(p => !valueOk(p));
    let outcome;
    if (good.length && bad.length) outcome = 'conflicting';
    else if (bad.length) outcome = 'wrong number';
    else {
      const states = new Set(good.map(unitState));
      outcome = states.size > 1 ? 'conflicting' : states.has('ok') ? 'correct' : states.has('alias') ? 'unit alias' : states.has('wrong') ? 'wrong unit' : 'unit missing';
      if (counts.length > 1 && OK_ITEM.has(outcome)) outcome = REPEATED;
    }
    return { label: it.label, outcome, heard: heardText(mine), masses: counts.length ? mine.filter(isMass) : [] };
  });
  for (const r of res) if (ITEM_FLAG[r.outcome]) flags.add(ITEM_FLAG[r.outcome]);
  // Fixes-2z: a weight with no food of its own right after a counted item describes that portion when only punctuation
  // separates them ("2 idli, 100 grams" / "2 idli (100 g)"). After a joining word ("2 idli and 100 grams") whose weight it is
  // cannot be told: a hand check, never an automatic pass.
  const rawToks = tokens(transcript, true), weightAfterJoin = [];
  phrases.forEach((p, k) => {
    const prev = phrases[k - 1];
    if (used.has(p) || !isMass(p) || p.food.length || !prev || !used.has(prev) || isMass(prev) || prev.end > p.start) return;
    const between = rawToks.slice(prev.end, p.start);
    if (between.some(t => t !== SEP && !BREAKS.has(t))) return;
    used.add(p);
    const r = res.find(x => x.heard && x.heard.split('; ').includes(prev.text));
    if (between.some(t => BREAKS.has(t))) weightAfterJoin.push(`"${p.text}" after "${prev.text}": its weight, or something else?`);
    else if (r) { r.heard = `${r.heard}; ${p.text} (its weight)`; (r.masses = r.masses || []).push(p); }
  });
  // Fixes-2z: a weight given WITH a count is judged too, never dropped: it must match the weight the listener recorded for that
  // item (reference grams); with no recorded weight, a person checks it was said.
  const weightNotInReference = [];
  res.forEach((r, k) => {
    const it = items[k]; if (!r.masses?.length || !it) return;
    if (it.grams != null) {
      if (r.masses.some(m => !isWord(m.unit, UNIT.gram) || m.value !== it.grams)) { r.outcome = OK_ITEM.has(r.outcome) || r.outcome === REPEATED ? 'wrong number' : r.outcome; flags.add('wrong number'); }
    } else weightNotInReference.push(`${it.label}: "${r.masses.map(m => m.text).join('; ')}" given with the count, not in the reference: was it said?`);
  });
  res.forEach(r => { delete r.masses; });
  // Extras: an unused phrase with a unit or a food, AND (Fixes-2y) any food word with no number that is not one of the items.
  const extraPhrases = phrases.filter(p => !used.has(p) && (p.unit || p.food.length));
  const itemFoods = new Set(items.filter(i => i.food).map(i => i.food));
  const inExtraPhrase = new Set(extraPhrases.flatMap(p => p.food));
  const itemFood = (t) => [...itemFoods].some(f => isWord(t, ALL_FOODS[f]));
  const extraWords = [...new Set(toks.filter(t => t !== SEP && !inExtraPhrase.has(t) && !itemFood(t)).filter(t => foodKeysOf(t).length))];
  const extra = [...extraPhrases.map(p => p.text), ...extraWords];
  if (extra.length) flags.add('extra');
  // Fixes-2y: every remaining word must be explained (a number, unit, food, glue word, or one of the line's own words).
  const D = numberDicts(lang);
  const allowed = new Set(allowedText.flatMap(x => tokens(x || '')).filter(t => t !== SEP));
  const known = (t) => t === SEP || /^\d+(\.\d+)?$/.test(t) || D.one[t] != null || D.tens[t] != null || POINT.has(t) || FILLERS.has(t) || GENERIC.has(t)
    || isWord(t, ALL_UNITS) || itemFood(t) || foodKeysOf(t).length > 0 || allowed.has(t) || [...allowed].some(a => near(a, t));
  const unexplained = [...new Set(toks.filter(t => !known(t)))];
  for (const p of phrases) if (!used.has(p) && !p.unit && !p.food.length) unexplained.push(`number "${p.text}"`);   // a stray number
  const ambiguous = [...res.filter(r => r.outcome === REPEATED).map(r => `${r.label}: said more than once (${r.heard})`), ...weightAfterJoin, ...weightNotInReference];
  const line = LINE_PRIORITY.find(f => flags.has(f)) || (unexplained.length || ambiguous.length ? HAND_CHECK : 'all correct');
  return { line, flags: [...flags], items: res, extra, unexplained, ambiguous };
}

// ── Part A rule 3: the logging parser's preview of a newly admitted take ──────
/** "2 idli" / "1 bowl" / "150 g" → { n, unit }. */
function qtyOf(text, lang) { const { phrases } = phrasesOf(text || '', lang); return phrases[0] ? { n: phrases[0].value, unit: phrases[0].unit } : null; }
const WORKOUT_UNITS = new Set(['set', 'rep', 'minute']);
/** Fields a Save can write. Fixes-2y: every one is inspected; a refusal flag counts only when none has content. */
const SAVEABLE = ['foods', 'weight_kg', 'water_ml_add', 'sleep', 'activities', 'acv', 'supplements', 'workouts', 'corrections', 'notes', 'draft_edit'];
/** Fields that are shown but never saved. Any OTHER field with content sends the leg to a hand check. */
const NOT_SAVED = new Set(['reply', 'advice', 'question', 'safety', 'amount_clarification', 'evaluation_note', 'sent_to_coach', 'unresolved_foods', 'unresolved_sleep', 'totals', 'aiProvider', 'aiModel', 'error']);
const hasContent = (v) => v != null && v !== false && v !== '' && v !== 0 && !(Array.isArray(v) && !v.length) && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
const saveableIn = (p) => SAVEABLE.filter(k => hasContent(p?.[k]));
/** The preview results; the agreed rule 3 accepts only the first two on every leg. */
const PREVIEW_RESULTS = ['correct reviewable', 'explicit refusal', 'missing/unresolved (visible)', 'needs a hand check', 'disqualifying', 'provider error'];
/**
 * Judge a parser preview against what was spoken (one engine's leg of one take).
 * → { result: one of PREVIEW_RESULTS, problems: [disqualifying reasons], hand: [reasons a person must look], items: [{ label, outcome, shown }], saveable }
 * Disqualifying: a surfaced wrong number or wrong unit (a counted food shown in kg included), an invented item,
 * or an unspoken health change in ANY saveable field. A question or safety reply is a refusal only with nothing saveable.
 */
/**
 * Fixes-3a: the weights of one counted food in a preview. shownPh: every phrase in its qty_text; food: the preview row, whose
 * numeric `grams` is what Save writes to the day.
 *  - The listener recorded a weight said with the count (it.grams): every gram figure shown AND the saved amount must equal
 *    it; any other → a surfaced wrong number. A figure in another unit (ml) cannot be compared → a hand check.
 *  - No weight was spoken: a weight is the app's estimate for an otherwise correct count. It must be ONE amount: every figure
 *    shown and the saved amount agree (ml taken as g). Disagreeing figures cannot be an automatic success → a hand check.
 * → { wrong: bool, hand: reason or null }
 */
function weightCheck(it, shownPh, food) {
  const mass = shownPh.filter(isMass);
  const saved = food?.grams == null || food.grams === '' ? null : Number(food.grams);
  const label = mass.map(p => p.text).join(', ');
  if (it.grams != null) {
    const grams = mass.filter(p => isWord(p.unit, UNIT.gram)), other = mass.filter(p => !isWord(p.unit, UNIT.gram));
    if (grams.some(p => p.value !== it.grams) || (saved != null && saved !== it.grams)) return { wrong: true, hand: null };
    if (other.length) return { wrong: false, hand: `the spoken ${it.grams} g is shown as "${other.map(p => p.text).join(', ')}"` };
    return { wrong: false, hand: null };
  }
  const values = new Set([...mass.map(p => p.value), ...(saved != null ? [saved] : [])]);
  if (values.size > 1) return { wrong: false, hand: `no weight was spoken, and the shown weight disagrees with itself (label ${label || 'none'}; saved ${saved ?? 'none'} g)` };
  return { wrong: false, hand: null };
}
const WEIGHT_CHECK = 'weight shown inconsistently (check by hand)';
function judgePreview(items, preview, lang) {
  if (!preview || preview.error) return { result: 'provider error', problems: [], hand: [], items: [], note: preview?.error || 'no preview' };
  const saveable = saveableIn(preview);
  const flagged = !!(preview.question || preview.safety || preview.amount_clarification || preview.evaluation_note);
  if (flagged && !saveable.length) return { result: 'explicit refusal', problems: [], hand: [], items: [], saveable, note: preview.evaluation_note || (preview.safety ? `safety reply: ${preview.safety}` : 'asked a question; nothing to save') };
  const foods = Array.isArray(preview.foods) ? preview.foods : [], unresolved = Array.isArray(preview.unresolved_foods) ? preview.unresolved_foods : [];
  const nameOf = (f) => `${f?.name || ''} ${f?.qty_text || ''}`;
  const matches = (f, food) => tokens(nameOf(f)).some(t => isWord(t, ALL_FOODS[food]));
  const used = new Set(), out = [], problems = [], hand = [];
  let missing = false;
  if (flagged) hand.push('a question or safety flag came WITH saveable content: look at what the member would see');
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
    if (!it.food || it.food === 'squat') { out.push({ label: it.label, outcome: 'check by hand', shown: JSON.stringify(preview.workouts || preview.activities || []).slice(0, 160) }); hand.push(`${it.label}: workouts are checked by hand`); continue; }
    const fs = foods.filter((f, k) => !used.has(k) && matches(f, it.food));
    foods.forEach((f, k) => { if (fs.includes(f)) used.add(k); });
    if (it.kind === 'presence') {
      if (fs.length) {
        // Fixes-2y: no amount was spoken. The voice preview card shows portions with no "estimate" label
        // (only photo previews say so), so whether the member can tell it is a guess needs a person.
        out.push({ label: it.label, outcome: 'present; amount not spoken but one is shown (check by hand: the voice preview shows no estimate label)', shown: fs.map(x => x.qty_text || `${x.grams ?? ''} g`).join(' + ') });
        hand.push(`${it.label}: shown as ${fs.map(x => x.qty_text || `${x.grams ?? ''} g`).join(' + ')} although no amount was spoken`);
      } else if (unresolved.some(f => matches(f, it.food))) out.push({ label: it.label, outcome: 'present, amount asked (shown as unresolved)', shown: '' });
      else { out.push({ label: it.label, outcome: 'missing', shown: '' }); missing = true; }
      continue;
    }
    if (!fs.length) { const u = unresolved.some(f => matches(f, it.food)); out.push({ label: it.label, outcome: u ? 'unresolved (shown)' : 'missing', shown: '' }); missing = true; continue; }
    // Fixes-2z: every number in the shown amount counts. A gram/ml figure beside ONE count is that portion's weight;
    // two counts are a surfaced wrong number if either differs, and a hand check if they repeat the right number.
    const shownPh = phrasesOf(fs[0].qty_text || '', lang).phrases, countPh = shownPh.filter(p => !isMass(p));
    const qp = countPh[0] || shownPh[0];
    const q = qp ? { n: qp.value, unit: qp.unit } : null;
    let o;
    if (countPh.length > 1) o = countPh.every(p => p.value === it.n) ? REPEATED : 'wrong number';
    else if (!q) o = 'number not shown';
    else if (q.n !== it.n) o = 'wrong number';
    else if (!it.unit) o = !q.unit || pieceUnit(q.unit) ? 'correct' : 'wrong unit';            // Fixes-2y: "2 kg" idli is a wrong unit
    else if (!(q.unit && isWord(q.unit, UNIT[it.unit]))) o = q.unit && it.unitAlias && isWord(q.unit, UNIT[it.unitAlias]) ? 'unit alias' : q.unit ? 'wrong unit' : 'unit not shown';
    else o = 'correct';
    // Fixes-3a (the 2z review): EVERY weight shown in the label AND the amount that would be saved (foods[].grams, which the
    // Save builder writes to the day) are judged — never only the first figure, never the label instead of the saved amount.
    if (OK_ITEM.has(o)) {
      const w = weightCheck(it, shownPh, fs[0]);
      if (w.wrong) o = 'wrong number';
      else if (w.hand) { o = WEIGHT_CHECK; hand.push(`${it.label}: ${w.hand}`); }
    }
    if (fs.length > 1) o = 'wrong number';   // the same food twice is a doubled amount
    out.push({ label: it.label, outcome: o, shown: fs.map(x => x.qty_text || `${x.grams ?? ''} g`).join(' + ') });
    if (o === 'wrong number' || o === 'wrong unit') problems.push(`${it.label} shown as ${fs.map(x => `${x.qty_text || ''} ${x.name || ''}`.trim()).join(' + ')}`);
    if (o === 'number not shown' || o === 'unit not shown') missing = true;
    if (o === REPEATED) hand.push(`${it.label}: shown as "${fs[0].qty_text}" (the same count twice: one serving or two?)`);
  }
  foods.forEach((f, k) => { if (!used.has(k)) problems.push(`invented item: ${f.name || '?'}${f.qty_text ? ` (${f.qty_text})` : ''}`); });
  // Every saveable field (Fixes-2y): an unspoken health change disqualifies; anything else unrecognised goes to a hand check.
  if (preview.weight_kg != null && !has.weight) problems.push(`unspoken weight ${preview.weight_kg} kg`);
  if (preview.water_ml_add != null && !has.water) problems.push(`unspoken water ${preview.water_ml_add} ml`);
  if (hasContent(preview.sleep)) problems.push('unspoken sleep');
  for (const k of ['activities', 'acv', 'supplements']) if (hasContent(preview[k])) problems.push(`unspoken ${k}`);
  if (hasContent(preview.workouts) && !has.workout) problems.push('unspoken workout');
  if (hasContent(preview.corrections)) problems.push('unspoken correction to an earlier entry');
  if (hasContent(preview.notes)) hand.push('a note would be saved with the day');
  if (hasContent(preview.draft_edit)) hand.push('an edit to a draft entry');
  for (const k of Object.keys(preview)) if (!SAVEABLE.includes(k) && !NOT_SAVED.has(k) && hasContent(preview[k])) hand.push(`unrecognised field "${k}"`);
  const result = problems.length ? 'disqualifying' : missing ? 'missing/unresolved (visible)' : hand.length ? 'needs a hand check' : 'correct reviewable';
  return { result, problems, hand, items: out, saveable };
}
/** How one leg's result counts in rule 3: valid, failing (definitive) or pending (no conclusion yet). */
const LEG_CLASS = { 'correct reviewable': 'valid', 'explicit refusal': 'valid', disqualifying: 'disqualified', 'missing/unresolved (visible)': 'does not qualify', 'needs a hand check': 'pending', 'provider error': 'pending' };
/** A judgment's result after any hand verdict (a hand verdict settles only "needs a hand check"). */
const effectiveResult = (j) => (j?.judgment?.result === 'needs a hand check' && j.hand_verdict?.verdict ? j.hand_verdict.verdict : j?.judgment?.result || null);
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

/**
 * The armed Part C try for this account, or null. Never throws; no database read off the test server.
 * Fixes-2y: → { trial_no, route, session_id, session_key, expires_in_ms }: the app binds its controlled mode to
 * this session and its expiry, and sends the session key back with each recording.
 */
async function armedFor(user, db = require('../db/pool')) {
  if (!available() || !user?.id) return null;
  try {
    const { rows: [a] } = await db.query(`SELECT trial_no, route, session_id, session_key,
        GREATEST(0, EXTRACT(EPOCH FROM (armed_at + INTERVAL '${ARM_MINUTES} minutes' - NOW())) * 1000)::bigint AS expires_in_ms
      FROM voice_calibration_partc_armed WHERE id=1 AND user_id=$1 AND armed_at > NOW() - INTERVAL '${ARM_MINUTES} minutes'`, [user.id]);
    return a ? { ...a, expires_in_ms: Number(a.expires_in_ms) } : null;
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
    if (caps.length < 120) {
      const cap = build(caps);
      if (cap) await client.query(`UPDATE voice_calibration_partc SET captures = captures || $2::jsonb, updated_at = NOW() WHERE trial_no=$1`, [trialNo, JSON.stringify(cap)]);
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
}
/** The attempts of ONE session (a repeated try starts again at attempt 1; earlier sessions are kept). */
const attemptsIn = (caps, sessionId) => caps.filter(c => (c.kind === 'server recording' || c.kind === 'on-device dictation') && (sessionId === undefined || c.session_id === sessionId));
/**
 * A server recording of an armed try (voice-transcribe). A recording identical to an earlier one is a Retry of it. Never throws.
 * Fixes-2y: the app sends the session key it had when the take STARTED. A recording carrying another session's key is
 * noted and never counted; one carrying none is kept but cannot count as a controlled test (its mode is unknown).
 */
async function recordTrial(armed, { body, status, speech, langHint, audioSha, fbTest, trail, appSession }, db = require('../db/pool')) {
  try {
    await appendCapture(armed.trial_no, armed.route, (caps) => {
      const match = appSession == null || appSession === '' ? 'not sent' : String(appSession) === String(armed.session_key) ? 'yes' : 'NO';
      if (match === 'NO') return { kind: 'ignored recording (another session)', at: new Date().toISOString(), session_id: armed.session_id, route: armed.route, audio_sha256: audioSha || null, app_session: String(appSession).slice(0, 40) };
      const prev = attemptsIn(caps, armed.session_id);
      const same = prev.find(c => c.audio_sha256 && c.audio_sha256 === audioSha);
      const answered = [...(trail || [])].reverse().find(x => x.outcome === 'answer');
      const cap = { kind: 'server recording', at: new Date().toISOString(), session_id: armed.session_id, route: armed.route, attempt: prev.length + 1, retry_of: same ? same.attempt : null, upload: true,
        session_match: match, http_status: status || 200, lang_hint: langHint || null, audio_sha256: audioSha || null, voice_backup_switch: !!fbTest, speech: speechRecord(speech),
        trail: trail || [], answered_by: answeredBy(trail, body), model_version: answered?.model_version || null, engine_reported: body?.engine || null,
        transcript: typeof body?.transcript === 'string' ? body.transcript.slice(0, 1000) : null, rejected: body?.rejected || null, error: body?.error || null };
      cap.actual_path = actualPath(cap);
      return cap;
    }, db);
  } catch (e) { console.warn('voice calibration: Part C capture failed:', e.message); }
}
/** On-device dictation used with NO upload (reported by the app only while a try is armed for the account). Never labelled Gemini or Whisper. */
async function recordDeviceDictation(armed, { text, lang, appSession }, db = require('../db/pool')) {
  await appendCapture(armed.trial_no, armed.route, (caps) => {
    if (appSession && String(appSession) !== String(armed.session_key)) return { kind: 'ignored on-device report (another session)', at: new Date().toISOString(), session_id: armed.session_id, route: armed.route };
    const cap = { kind: 'on-device dictation', at: new Date().toISOString(), session_id: armed.session_id, route: armed.route, attempt: attemptsIn(caps, armed.session_id).length + 1, upload: false,
      session_match: appSession ? 'yes' : 'not sent', lang_hint: lang || null, transcript: String(text || '').slice(0, 1000), answered_by: 'browser/on-device (no upload)' };
    cap.actual_path = actualPath(cap);
    return cap;
  }, db);
}
/** Everything a preview would show or save (Fixes-2y: workouts, corrections, sleep and notes in full, not counts). */
const previewSummary = (r) => (r ? { foods: (r.foods || []).slice(0, 20).map(f => ({ name: f.name, qty_text: f.qty_text || null, grams: f.grams ?? null, meal: f.meal || null })),
  unresolved_foods: (r.unresolved_foods || []).slice(0, 10).map(f => ({ name: f.name || f.query || null, qty_text: f.qty_text || null })),
  weight_kg: r.weight_kg ?? null, water_ml_add: r.water_ml_add ?? null, sleep: r.sleep || null, unresolved_sleep: r.unresolved_sleep || null,
  activities: (r.activities || []).map(a => a.label || a.id || a), acv: (r.acv || []).map(a => a.label || a.id || a), supplements: (r.supplements || []).map(a => a.label || a.id || a),
  workouts: (r.workouts || []).slice(0, 10).map(w => ({ name: w.name, qty_text: w.qty_text || null, duration_min: w.duration_min ?? null, sets: (w.sets || []).slice(0, 30), cardio_type: w.cardio_type || null, distance_km: w.distance_km ?? null })),
  corrections: (r.corrections || []).slice(0, 10).map(c => ({ name: c.name, grams: c.grams ?? null, meal: c.meal || null })), notes: typeof r.notes === 'string' ? r.notes.slice(0, 300) : null,
  question: !!r.question, safety: r.safety || null, reply: typeof r.reply === 'string' ? r.reply.slice(0, 300) : null, error: r.error || null,
  parser: r.aiProvider || r.aiModel ? { provider: r.aiProvider || null, model: r.aiModel || null } : null } : null);
/** The preview (parse) of an armed try, linked to the attempt whose text it used; text edited before the preview is flagged. Never throws. */
async function recordPreview(armed, { message, result }, db = require('../db/pool')) {
  try {
    await appendCapture(armed.trial_no, armed.route, (caps) => {
      const last = attemptsIn(caps, armed.session_id).slice(-1)[0];
      const msg = String(message || '').trim();
      const source = !last ? 'typed or unknown (no recording in this session)' : (last.transcript || '').trim() === msg ? `unedited text of attempt ${last.attempt}` : `EDITED before the preview (attempt ${last.attempt} said "${(last.transcript || '').slice(0, 120)}")`;
      return { kind: 'preview', at: new Date().toISOString(), session_id: armed.session_id, route: armed.route, attempt: last ? last.attempt : null, message: msg.slice(0, 1000), text_source: source, edited: !!last && (last.transcript || '').trim() !== msg, preview: previewSummary(result) };
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
/**
 * Fixes-2y: is a Part C session's recovery complete? Its account's day equals the session's OWN baseline and the
 * Voice backup switch is not on for that account. Only that account and date are read; the switch is never changed.
 * Every check is appended to the session (read-backs and switch checks are kept).
 */
async function checkSession(db, s, reason) {
  const at = new Date().toISOString();
  if (!s.account_id) {
    await db.query(`UPDATE voice_calibration_partc_sessions SET readbacks = readbacks || $2::jsonb WHERE id=$1`, [s.id, JSON.stringify({ at, reason, note: 'the test account no longer exists' })]);
    return { diff: null, switch_on: false, outstanding: [], ok: true, note: 'the test account no longer exists' };
  }
  const now = await dayState(db, s.account_id, s.baseline.date);
  const diff = dayDiff(s.baseline, now);
  const { rows: [sw] } = await db.query(`SELECT user_id FROM voice_fallback_test_account WHERE id=1 AND set_at > NOW() - INTERVAL '24 hours'`);
  const switchOn = !!sw && sw.user_id === s.account_id;
  await db.query(`UPDATE voice_calibration_partc_sessions SET readbacks = readbacks || $2::jsonb, switch_checks = switch_checks || $3::jsonb WHERE id=$1`,
    [s.id, JSON.stringify({ at, reason, diff }), JSON.stringify({ at, reason, on: switchOn })]);
  const outstanding = [];
  if (!diff.same) outstanding.push('the day still differs from its baseline: Restore it, then Finish again');
  if (switchOn) outstanding.push('the Voice backup switch is still ON for the test account: turn it off on the Voice backup test card, then Finish again');
  return { diff, switch_on: switchOn, outstanding, ok: !outstanding.length };
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
/** The line a slot reads (short and soft slots read one of the lines). */
const lineOfInfo = (info) => LINES[info?.line] || null;
/**
 * A take's line result for one engine, against the listener's reference.
 * Fixes-2y: until the reference is FROZEN the result is provisional (shown, never counted). A frozen reference that is
 * uncertain, not speech, or marked unscorable makes the line "uncertain/unscorable". A hand check recorded against the
 * CURRENT reference settles a "needs a hand check" line.
 */
function takeScore(t, info, engine) {
  const L = lineOfInfo(info);
  const frozen = !!t.reference_frozen_at;
  const mode = t.reference_mode || null;
  const unscorable = frozen ? (t.heard !== 'speech' || mode === 'unscorable')
    : (t.heard === 'uncertain' || (t.spoken_as_script === false && !(Array.isArray(t.reference_items) && t.reference_items.length)));
  const items = itemsWithReference(info.items || [], t.reference_items, mode);
  const s = scoreTranscript(items, t[`${engine}_text`], info.lang, { error: t[`${engine}_error`], unscorable, allowedText: [L?.say, L?.means, t.reference_text] });
  s.provisional = !frozen;
  s.auto_line = s.line;
  const hc = t.hand_checks?.[engine];
  if (s.line === HAND_CHECK && frozen && hc && hc.reference_sha === t.reference_sha && LINE_OUTCOMES.includes(hc.verdict)) { s.line = hc.verdict; s.hand = hc; }
  return s;
}
/** The takes a candidate setting would newly admit (live refuses, the candidate accepts). */
const newlyAdmitted = (t, g) => decision(t, g) === 'accept' && decision(t, SP.LIVE_LIMITS) === 'refuse';
const engineCalls = (t) => (t.gemini_provenance?.attempts?.length || 0) + (t.whisper_provenance?.attempts?.length || 0);
/** A take's device: the snapshot taken with it, else the volunteer's. Unknown stays "unknown". */
function deviceOf(t, p = {}) {
  const d = t?.device || p?.device || {};
  return { tier: t?.phone_type || p?.phone_type || '', make: d.make || '', model: d.model || '', os: d.os || '', os_version: d.os_version || '', browser: t?.browser || p?.browser || d.browser || '', browser_version: d.browser_version || '' };
}
const modelKey = (d) => (d.make && d.model && d.make !== 'unknown' && d.model !== 'unknown' ? `${d.make} ${d.model}`.toLowerCase().replace(/\s+/g, ' ').trim() : null);
/** The phone mix the plan needs: at least 3 different models, a budget Android, an iPhone, and Chrome on Android. */
function phoneMix(active) {
  const devs = active.map(p => deviceOf(null, p));
  const models = new Set(devs.map(modelKey).filter(Boolean));
  const gaps = [];
  if (models.size < 3) gaps.push(`${models.size} different phone model(s) recorded (3 needed)`);
  if (!devs.some(d => d.tier === 'android_budget')) gaps.push('no budget Android');
  if (!devs.some(d => d.tier === 'iphone')) gaps.push('no iPhone');
  if (!devs.some(d => d.tier !== 'iphone' && d.tier && d.browser === 'chrome')) gaps.push('no Chrome on Android');
  return { models: [...models], gaps };
}
/** Rule 3 for one leg of one take: the CURRENT judgment (this reference version, this judge version), else why there is none. */
function legStatus(t, engine, judgments) {
  const mine = judgments.filter(j => j.take_id === t.id && j.engine === engine);
  const cur = mine.find(j => j.reference_sha === t.reference_sha && j.judge_version === JUDGE_VERSION && j.status === 'done');
  if (cur) return { cls: LEG_CLASS[effectiveResult(cur)] || 'pending', result: effectiveResult(cur), j: cur };
  if (mine.some(j => j.reference_sha === t.reference_sha && j.judge_version === JUDGE_VERSION && j.status === 'running')) return { cls: 'pending', result: 'running' };
  if (mine.length) return { cls: 'stale', result: 'stale (the reference or the judge changed): re-evaluate' };
  return { cls: 'not judged', result: 'not judged' };
}
/** A newly admitted speech take's rule 3 status from its two legs. */
function rule3Status(x, judgments) {
  if (x.truth !== 'speech') return { status: 'excluded', why: x.truth };
  if (!x.t.reference_frozen_at) return { status: 'incomplete', why: 'reference not frozen' };
  const legs = ['gemini', 'whisper'].map(e => legStatus(x.t, e, judgments));
  if (legs.some(l => l.cls === 'disqualified')) return { status: 'disqualified', legs };
  if (legs.some(l => l.cls === 'does not qualify')) return { status: 'does not qualify', legs };
  const open = legs.filter(l => l.cls !== 'valid');
  if (open.length) return { status: 'incomplete', why: [...new Set(open.map(l => l.cls === 'pending' ? (l.result === 'running' ? 'evaluation running' : l.result === 'provider error' ? 'provider/parser error' : 'hand check outstanding') : l.cls))].join(' + '), legs };
  return { status: 'valid', legs };
}
/**
 * Fixes-3a: the replacement budget line. With the grants ledger (the export route), the counts come from it, so a withdrawal or
 * deletion never returns an allowance; grants made before the ledger (only on the take) are added. Without it (pure use), from takes.
 */
function replacementBudgetText(takes, grants) {
  if (!grants) return `${takes.filter(t => t.replacement_authorised).length} of ${REPLACEMENT_BUDGET} asked for, ${takes.filter(t => t.retake_reason === 'replacement').length} recorded; ${takes.filter(t => t.replacement_authorised && t.superseded_at).reduce((n, t) => n + engineCalls(t), 0)} calls were made on the excluded takes they replace (kept and shown)`;
  const inLedger = new Set(grants.map(g => g.take_id));
  const legacy = takes.filter(t => t.replacement_authorised && !inLedger.has(t.id));
  const held = new Set(takes.map(t => t.id));
  const asked = grants.length + legacy.length;
  const recorded = grants.filter(g => g.replacement_take_id != null).length + legacy.filter(t => t.superseded_at).length;
  const calls = grants.reduce((n, g) => n + (Number(g.calls_spent) || 0), 0) + legacy.reduce((n, t) => n + engineCalls(t), 0);
  const gone = grants.filter(g => !held.has(g.take_id)).length;
  return `${asked} of ${REPLACEMENT_BUDGET} asked for, ${recorded} recorded; ${calls} calls were made on the excluded takes they replace (kept and shown). From the grants ledger: ${gone} grant(s) on takes since deleted still count; a withdrawal or deletion never returns an allowance`;
}
/** Fixes-3a: calls spent in the round from the spend ledger (kept when takes are deleted). */
function spendText(spend, takes, unresolved = null, reconciled = []) {
  const held = new Set(takes.map(t => t.id));
  // Fixes-3b: an attempt's result was KEPT when its take was saved (transcription) or its judgment recorded (parser).
  const kept = (x) => (x.kind === 'transcription' ? x.take_id != null && x.outcome !== 'refused' && !/^refused/.test(x.outcome || '') && !/^not saved/.test(x.outcome || '') : x.outcome === 'judged' || x.judgment_id != null);
  const sum = (f) => spend.filter(f).reduce((n, x) => n + (Number(x.calls) || 0), 0);
  const notKept = sum(x => !kept(x)), deleted = sum(x => kept(x) && !held.has(x.take_id));
  // Fixes-3c: attempts not yet written to the ledger make these totals SHORT, and say so first. Fixes-3d: so do attempts that were
  // started but never recorded (in flight, or interrupted by a restart or failure): their calls are unknown, reported with a bound.
  const known = unresolved && unresolved.attempts ? `UNRESOLVED: ${unresolved.attempts} attempt(s) (${unresolved.calls} call(s)) could not be written to the ledger yet, so the totals below are short by ${unresolved.calls}. ` : '';
  const unknown = unresolved && unresolved.unknownAttempts ? `UNRESOLVED: ${unresolved.unknownAttempts} attempt(s) were started but their calls were never recorded (still running, or interrupted by a restart or failure): their calls are UNKNOWN, at most ${unresolved.unknownMax}, and are not in the totals below; an administrator settles each from the provider's own records. ` : '';
  const waiting = known + unknown;
  const settledTxt = unresolved?.settled?.n ? ` ${unresolved.settled.n} attempt(s) were settled by an administrator from the provider's own records (${unresolved.settled.calls} call(s), included above).` : '';
  const recon = reconciled.length ? ` ${reconciled.length} duplicate row(s) (${reconciled.reduce((n, x) => n + (Number(x.calls) || 0), 0)} call(s)) added by an earlier boot back-fill were removed from these totals and kept in the reconciliation record.` : '';
  return `${waiting}${sum(x => x.kind === 'transcription')} transcription call(s) and ${sum(x => x.kind === 'rule3')} parser call(s) in the round, counted when each call happened. Of these, ${deleted} were on recordings deleted since (withdrawal, removal or 90 days), and ${notKept} on attempts whose result was never kept (an upload refused or not saved after the engines answered, a judgment that could not be saved, or one still in progress). Deleting recordings never lowers these.${recon}${settledTxt}`;
}
/** Fixes-3c/3d: recordings registered before upload. Never kept vs kept then deleted are told apart (ever_kept). */
function uploadsText(uploads = [], ever = false) {
  const n = (st) => uploads.filter(u => u.state === st && !!u.ever_kept === ever).reduce((k, u) => k + Number(u.n || 0), 0);
  if (ever) return `${n('deleted')} (kept with their take, deleted later by withdrawal, removal or the 90-day limit); ${n('kept')} still kept`;
  const waiting = n('uploading') + n('delete failed');
  return `${n('deleted')} deleted; ${waiting ? `${waiting} NOT YET DELETED (${n('delete failed')} failed deletion(s), ${n('uploading')} unfinished); the daily clean-up retries them` : 'none waiting to be deleted'}`;
}
/** Fixes-2z: usable no-speech controls per required slot (volunteer × control × place), and why the others are not usable. */
function controlCoverage(active, curActive, infoOf) {
  const needed = active.flatMap(p => slotPlan(p.grp).filter(s => s.kind === 'control').map(s => `${p.id}|${s.slot}`));
  const ctl = curActive.filter(t => infoOf(t).kind === 'control');
  const at = new Map(ctl.map(t => [`${t.participant_id}|${t.slot_code}`, t]));
  const usableTake = (t) => !!t && !!t.reference_frozen_at && t.heard === 'no_speech' && decision(t, SP.LIVE_LIMITS) !== 'not checked';
  const n = { unsure: 0, speech: 0, 'not measured': 0, 'not labelled': 0, 'not recorded': 0 };
  let usable = 0;
  for (const k of needed) {
    const t = at.get(k);
    if (usableTake(t)) { usable++; continue; }
    if (!t) n['not recorded']++; else if (!t.reference_frozen_at) n['not labelled']++; else if (t.heard === 'uncertain') n.unsure++; else if (t.heard === 'speech') n.speech++; else n['not measured']++;
  }
  const why = Object.entries(n).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(', ');
  return { usable, needed: needed.length, why, counts: n, usableTake };
}
/** Fixes-2z: cells DERIVED from editable text (not typed directly), always on the sharing checklist: [sheet, column, which rows, label]. */
const DERIVED_TEXT = [
  ['About', 'value', (r) => r[0] === 'phone mix', 'value of "phone mix" (built from phone make and model)'],
  ['Part A summary', 'slice', (r) => String(r[1]).startsWith('phone model '), 'slice labels "phone model …" (built from phone make and model)'],
];
const FREE_TEXT_COLUMNS = {
  Volunteers: ['profile', 'phone make', 'phone model'], Takes: ['retake reason', 'reference transcript', 'gemini words', 'whisper words', 'phone make', 'phone model', 'gemini hand check', 'whisper hand check', 'replacement authorised'],
  Items: ['heard'], Controls: ['gemini words', 'whisper words'], 'Rule 3 previews': ['hand verdict', 'preview content'], 'Part C tries': ['notes'],
  'Part C events': ['words or refusal', 'preview'], History: ['what'],
};
/**
 * A scrubber for free text. names: the study's registered people (volunteers' account names, reviewers): full names AND
 * name parts of 4+ letters. fullNames: every other account's full name (only the whole name, so common words survive).
 * An unregistered name typed into a note cannot be known: the Free text sheet says which cells a person must read.
 */
const PERMITTED_CODE = /^(P|R|A|C)\d+$/;
function nameScrubber(names, fullNames = []) {
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = new Set();
  for (const n of fullNames || []) { const full = String(n || '').trim(); if (full.length >= 4 && /\s/.test(full)) parts.add(full); }
  for (const n of names || []) { const full = String(n || '').trim(); if (full.length >= 2) parts.add(full); for (const w of full.split(/\s+/)) if (/^\p{L}{4,}$/u.test(w)) parts.add(w); }
  for (const x of [...parts]) if (PERMITTED_CODE.test(x)) parts.delete(x);   // codes survive (a "name" shaped like P1 or R2 is not removed)
  if (!parts.size) return { scrub: (x) => ({ text: x, n: 0 }) };
  const rx = new RegExp(`(?<!\\p{L})(${[...parts].sort((a, b) => b.length - a.length).map(esc).join('|')})(?!\\p{L})`, 'giu');
  return { scrub: (x) => { let n = 0; const text = String(x).replace(rx, () => { n++; return '[name removed]'; }); return { text, n }; } };
}
/**
 * The workbook's sheets, from database rows. Pure (unit-tested). No names and no audio: volunteers appear by code (P1…),
 * reviewers by code (R1…), administrators by an export-only code (A1…), Part C operators as C1/C2, the test account as "test account".
 * privateNames: registered names to remove from every free-text cell (counted in About and on the Free text sheet).
 */
function workbookSheets({ participants = [], takes = [], wording = [], partc = [], sessions = [], judgments, evals = [], reviewers = [], grants = null, spend = null, reconciled = [], uploads = [], spendUnresolved = null, privateNames = [], accountNames = [], generatedAt = new Date() }) {
  judgments = judgments || evals;
  const active = participants.filter(p => !p.withdrawn_at);
  const byId = new Map(participants.map(p => [p.id, p]));
  const current = takes.filter(t => !t.superseded_at);
  const enrich = (t) => { const p = byId.get(t.participant_id) || {}; return { t, p, info: slotInfo(t.slot_code, p.grp) || {} }; };
  const mismatches = takes.filter(t => !replayMatches(t)).length;
  const remeasureMismatch = takes.filter(t => t.remeasure && t.remeasure.match === false).length;
  const reviewerCode = (v) => (/^R\d+$/.test(String(v || '')) ? String(v) : v ? 'unregistered reviewer (name withheld)' : '');
  const wordingRow = (lang) => { const w = wording.find(x => x.lang === lang); const ok = w && w.script_sha256 === scriptSha(lang); return { w, ok }; };
  const allCaps = partc.flatMap(r => (r.captures || []).map(c => ({ ...c, trial: r.trial_no })));
  const attempts = allCaps.filter(c => c.kind === 'server recording' || c.kind === 'on-device dictation');
  const adminCodes = new Map();
  const who = (id) => { if (id == null || id === '') return ''; if (/^R\d+$/.test(String(id))) return String(id); if (!adminCodes.has(id)) adminCodes.set(id, `A${adminCodes.size + 1}`); return adminCodes.get(id); };
  const curActive = current.filter(t => byId.get(t.participant_id) && !byId.get(t.participant_id).withdrawn_at);
  const mix = phoneMix(active);
  const r3calls = judgments.reduce((acc, j) => { acc[j.reason === 're-evaluation' ? 'reeval' : 'initial'] += j.parser_calls || 0; return acc; }, { initial: 0, reeval: 0 });

  // ── Screening coverage (the same for every candidate): a pass needs the whole cohort, every slot, frozen labels, controls and exact replay.
  const plannedFor = active.reduce((n, p) => n + (PLANNED_PER_GROUP[p.grp] || 0), 0);
  const recordedSlots = new Set(curActive.filter(t => slotPlan(byId.get(t.participant_id).grp).some(s => s.slot === t.slot_code)).map(t => `${t.participant_id}|${t.slot_code}`)).size;
  const coverage = [], blockers = [];
  const quotaOk = active.length === MAX_PARTICIPANTS && Object.entries(GROUPS).every(([g, x]) => active.filter(p => p.grp === g).length === x.quota);
  if (!quotaOk) coverage.push(`cohort: ${active.length} of ${MAX_PARTICIPANTS} volunteers`);
  if (recordedSlots < PLANNED_TOTAL) coverage.push(`recordings: ${recordedSlots} of ${PLANNED_TOTAL} planned slots`);
  const unfrozen = curActive.filter(t => !t.reference_frozen_at).length;
  if (unfrozen) coverage.push(`listener reference: ${unfrozen} take(s) not yet frozen`);
  // Fixes-2z: a control counts for rule 1 only if it is USABLE: its current take has a frozen "no speech" label and the live
  // check measured it. Required before any pass: a usable control in EVERY volunteer × control × place slot (36 of 36).
  // An excluded clip (unsure, speech heard, not measured) stays visible; the remedy is an authorised replacement, budgeted apart.
  const ctl = controlCoverage(active, curActive, (t) => enrich(t).info);
  if (ctl.usable < 36) coverage.push(`no-speech controls: ${ctl.usable} of 36 usable (every volunteer × control × place needs a frozen "no speech" label on a measured clip${ctl.why ? `; not usable: ${ctl.why}` : ''})`);
  const notRemeasured = curActive.filter(t => !t.remeasure).length;
  if (notRemeasured) coverage.push(`re-measure: ${notRemeasured} take(s) not yet measured again`);
  { const open = (spendUnresolved?.attempts || 0) + (spendUnresolved?.unknownAttempts || 0);   // Fixes-3c/3d
    if (open) coverage.push(`call ledger: ${open} attempt(s) not yet written${spendUnresolved?.unknownAttempts ? ` (${spendUnresolved.unknownAttempts} with unknown calls, to be settled)` : ''}`); }
  if (mix.gaps.length) coverage.push(`phone mix: ${mix.gaps.join(', ')}`);
  if (mismatches) blockers.push(`${mismatches} replay mismatch(es): the offline settings cannot be trusted until explained`);
  if (remeasureMismatch) blockers.push(`${remeasureMismatch} re-measure mismatch(es)`);

  const about = [['item', 'value'],
    ['what this is', 'FitLife voice calibration round 1 (B18/B19). TEST SERVER ONLY. Volunteers appear as codes (P1–P6), reviewers as R1…, administrators as A1… (this export only); no names, no audio.'],
    ['script version', `${SCRIPT_VERSION} (frozen for the round; any wording change voids that language's fluent-speaker check)`],
    ['judge version', `${JUDGE_VERSION} (stored with every rule 3 judgment; a judgment made under another version or another reference version is stale and never reused)`],
    ['generated', iso(generatedAt)],
    ['detector', SP.VERSION],
    ['live setting (unchanged)', `voiced >= ${SP.LIVE_LIMITS.min_voiced_ms} ms, run >= ${SP.LIVE_LIMITS.min_run_ms} ms, pitch spread >= ${SP.LIVE_LIMITS.min_f0_spread_hz} Hz`],
    ['offline settings (screening only)', GRID.map(g => `${g.id}${g.live ? ' (live)' : ''}`).join(', ')],
    ['volunteers', `${active.length} of ${MAX_PARTICIPANTS} (Kannada ${active.filter(p => p.grp === 'kn').length}/${GROUPS.kn.quota}, Hindi ${active.filter(p => p.grp === 'hi').length}/${GROUPS.hi.quota}, English ${active.filter(p => p.grp === 'en').length}/${GROUPS.en.quota})`],
    ['phone mix', mix.gaps.length ? `INCOMPLETE: ${mix.gaps.join('; ')}${mix.models.length ? ` (models: ${mix.models.join(', ')})` : ''}` : `complete: ${mix.models.join(', ')}`],
    ['planned recording slots', `${PLANNED_TOTAL} for the full cohort: 108 speech, 36 no-speech controls (Kannada ${PLANNED_PER_GROUP.kn}, Hindi ${PLANNED_PER_GROUP.hi}, English ${PLANNED_PER_GROUP.en} each)`],
    ['slots recorded', `${new Set(current.map(t => `${t.participant_id}|${t.slot_code}`)).size}`],
    ['takes kept (all)', `${takes.length}: ${current.length} current, ${takes.length - current.length} superseded by a technical retake (reasons in Takes)`],
    ['listener references', `${current.filter(t => t.reference_frozen_at).length} of ${current.length} current take(s) frozen; transcripts stay hidden from the listener until then`],
    ['budget: initial transcription calls', `planned ${PLANNED_TOTAL * 2} (both engines × ${PLANNED_TOTAL} recordings); made so far ${current.reduce((n, t) => n + engineCalls(t), 0)} on current takes`],
    ['budget: retakes and provider retries (counted separately)', `${takes.filter(t => t.superseded_at).reduce((n, t) => n + engineCalls(t), 0)} calls on superseded takes; ${takes.reduce((n, t) => n + Math.max(0, (t.gemini_provenance?.attempts?.length || 0) - 1), 0)} extra Gemini model attempts after a failure`],
    ['budget: authorised replacements (separate)', replacementBudgetText(takes, grants)],
    ...(spend ? [['budget: calls spent in the round (ledger)', spendText(spend, takes, spendUnresolved, reconciled)]] : []),
    ...(spend ? [['recordings never kept (refused or not saved)', uploadsText(uploads)]] : []),
    ...(spend ? [['recordings kept, then deleted', uploadsText(uploads, true)]] : []),
    ['budget: rule 3 parser calls (separate)', `${r3calls.initial + r3calls.reeval}: ${r3calls.initial} initial (at most 2 per newly admitted take, deduplicated by take and reference version) and ${r3calls.reeval} re-evaluation(s) after a reference or judge change (each authorised separately)`],
    ['budget: Part C attempts', `${attempts.length} of 64 planned (32 tries + one Retry each), before technical retakes; ${sessions.length} session(s)`],
    ['replay check: stored live decision vs offline replay at the live setting', mismatches ? `${mismatches} MISMATCH(ES): do not use the offline settings until explained` : `0 mismatches over ${takes.length} take(s)`],
    ['re-measure check: stored measurements vs measuring the stored audio again', remeasureMismatch ? `${remeasureMismatch} MISMATCH(ES)` : `${takes.filter(t => t.remeasure).length} take(s) re-measured, 0 mismatches`],
    ['screening coverage (needed before any candidate can pass)', [...blockers.map(b => `BLOCKED: ${b}`), ...coverage].join('; ') || 'complete'],
    ...['kn', 'hi', 'en'].map(l => { const { w, ok } = wordingRow(l); return [`wording check: ${LANG_NAME[l]}`, ok ? `confirmed by ${reviewerCode(w.confirmed_by)}, ${iso(w.confirmed_at)} (script sha256 ${scriptSha(l).slice(0, 16)})` : w ? 'VOID: the lines changed after the check' : 'NOT CONFIRMED: these lines cannot be recorded yet']; }),
    ['reviewers', `${reviewers.length} registered (codes only here; names stay in the private register)`],
    ['Part C', `${PARTC_PLAN.length} planned controlled tries (2 operators × 8 lines × 2 provider legs) and up to ${NATURAL_SLOTS} natural observations; ${partc.filter(r => (r.captures || []).length).length} with a recorded event; ${sessions.filter(x => !x.resolved_at).length} session(s) not yet resolved`],
    ['counting rule', 'Part A counts current takes by the fluent listener\'s label. Uncertain labels, protocol deviations (heard ≠ intended, e.g. a TV voice in a control), unlabelled takes, retakes and capture failures are counted and shown, never dropped silently. Part B counts only takes whose reference is frozen; the rest are shown as awaiting the reference.'],
    ['what this round cannot do', 'Descriptive counts for six people and their phones. It cannot choose an engine or certify a threshold; a zero count is not a guaranteed rate. Any candidate setting is a proposal for review.'],
  ];

  const plan = [['group', 'slot', 'kind', 'place', 'language', 'line', 'say', 'intended label']];
  for (const g of Object.keys(GROUPS)) for (const s of slotPlan(g)) { const i = slotInfo(s.slot, g); plan.push([GROUPS[g].name, s.slot, s.kind, PLACES[s.place], s.lang ? LANG_NAME[s.lang] : '', s.line, i.say, s.label]); }
  const lines = [['line', 'language', 'say', 'means', 'items scored', 'wording check', 'script sha256']];
  for (const [id, l] of Object.entries(LINES)) { const { w, ok } = wordingRow(l.lang); lines.push([id, LANG_NAME[l.lang], l.say, l.means, l.items.map(i => i.label).join(' · '), ok ? `confirmed by ${reviewerCode(w.confirmed_by)}` : w ? 'void (lines changed)' : 'not confirmed', scriptSha(l.lang).slice(0, 16)]); }
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
    'whisper words', 'whisper line result', 'whisper flags', 'whisper language sent', 'whisper language reported', 'whisper fallback decision', 'whisper problem', 'prompt sha256 (gemini / whisper)',
    'take id', 'phone make', 'phone model', 'os', 'os version', 'browser version', 'reference version', 'reference frozen at', 'reference mode', 'reference items (complete)', 'listener', 'reference sha256',
    'gemini unexplained words', 'whisper unexplained words', 'gemini hand check', 'whisper hand check', 'replacement authorised', 'quantity ambiguities (gemini / whisper)']];
  const refItemsText = (t) => (Array.isArray(t.reference_items) ? t.reference_items.map(r => r.kind ? r.label : `${r.label} → ${r.n}`).join('; ') : '');
  const handText = (s) => (s?.hand ? `${s.hand.verdict} (${who(s.hand.by)}${s.hand.note ? `: ${s.hand.note}` : ''})` : s?.auto_line === HAND_CHECK ? 'OUTSTANDING' : '');
  for (const t of [...takes].sort((a, b) => String(byId.get(a.participant_id)?.code).localeCompare(String(byId.get(b.participant_id)?.code), undefined, { numeric: true }) || a.slot_code.localeCompare(b.slot_code) || a.take_no - b.take_no)) {
    const { p, info } = enrich(t);
    const live = t.speech_status === 'speech' ? 'accept' : t.speech_status === 'no_speech' ? 'refuse' : 'not checked';
    const gp = t.gemini_provenance || {}, wp = t.whisper_provenance || {};
    const gs = info.items?.length ? takeScore(t, info, 'gemini') : null, ws = info.items?.length ? takeScore(t, info, 'whisper') : null;
    const d = deviceOf(t, p);
    const lineCell = (s) => (s ? `${s.line}${s.provisional ? ' (provisional: reference not frozen)' : ''}` : '');
    takesSheet.push([p.code, t.slot_code, t.take_no, yes(!t.superseded_at), t.retake_reason ? `${t.retake_reason}${t.retake_note ? `: ${t.retake_note}` : ''}` : '', iso(t.superseded_at), iso(t.created_at),
      info.kind || '', PLACES[info.place] || '', info.lang ? LANG_NAME[info.lang] : '', info.label || '', t.heard || '', yes(t.spoken_as_script), t.reference_text || '',
      Array.isArray(t.reference_items) && !t.reference_items.some(r => r.kind) ? t.reference_items.map(r => `${r.label} → ${r.n}`).join('; ') : '', truth(t, info.label),
      d.tier, d.browser, yes(t.installed_app ?? p.installed_app), t.duration_ms ? (Number(t.duration_ms) / 1000).toFixed(1) : '', t.mime_type || '', (t.audio_sha256 || '').slice(0, 16),
      t.speech_status || '', t.detector_version || '', t.voiced_frames ?? '', t.longest_run_frames ?? '', t.f0_spread_raw ?? '', t.hop_ms ?? '', t.voiced_ms ?? '', t.longest_run_ms ?? '',
      live, decision(t, SP.LIVE_LIMITS), replayMatches(t) ? 'yes' : 'NO', t.remeasure ? (t.remeasure.match ? 'same' : 'DIFFERENT') : '', ...GRID.map(g => decision(t, g)),
      t.gemini_text ?? '', lineCell(gs), gs ? gs.flags.join('; ') : '', gp.model_used || '', gp.model_version || '', (gp.attempts || []).map(a => `${a.model}: ${a.outcome}${a.status ? ` ${a.status}` : ''}`).join('; '),
      t.gemini_text == null ? '' : t.gemini_generated ? 'would refuse (generated text)' : 'passes', t.gemini_text == null ? (t.gemini_error || 'no answer') : !/\S/.test(t.gemini_text) ? 'empty answer' : '',
      t.whisper_text ?? '', lineCell(ws), ws ? ws.flags.join('; ') : '', wp.language_sent || 'not set', wp.language_reported || '', t.whisper_review ? (t.whisper_review.accepted ? 'accepted' : `refused: ${t.whisper_review.reason}`) : '',
      t.whisper_text == null ? (t.whisper_error || 'no answer') : !/\S/.test(t.whisper_text) ? 'empty answer' : '', `${gp.prompt_sha256 || ''} / ${wp.prompt_sha256 || ''}`,
      t.id ?? '', d.make, d.model, d.os, d.os_version, d.browser_version, t.reference_version || '', iso(t.reference_frozen_at), t.reference_mode || '', refItemsText(t), t.listener_code || '', (t.reference_sha || '').slice(0, 16),
      gs ? (gs.unexplained || []).join(', ') : '', ws ? (ws.unexplained || []).join(', ') : '', handText(gs), handText(ws),
      t.replacement_authorised ? `yes, ${iso(t.replacement_authorised.at)} by ${who(t.replacement_authorised.by)}${t.replacement_authorised.why ? `: ${t.replacement_authorised.why}` : ''}` : '',
      [gs?.ambiguous?.join('; '), ws?.ambiguous?.join('; ')].filter(Boolean).join(' / ')]);
  }

  // Part B: every current speech take × engine × item.
  const items = [['volunteer', 'slot', 'line', 'language', 'place', 'kind', 'phone', 'engine', 'line result', 'line flags', 'item', 'expected (after listener corrections)', 'outcome', 'heard', 'listener confirmed what was said', 'recheck needed', 'kannada number word',
    'take id', 'reference version', 'provisional (reference not frozen)', 'unexplained words']];
  const scored = [];
  for (const t of current) {
    const { p, info } = enrich(t);
    if (!info.items?.length) continue;
    const eff = itemsWithReference(info.items, t.reference_items, t.reference_mode);
    for (const engine of ['gemini', 'whisper']) {
      const s = takeScore(t, info, engine);
      scored.push({ t, p, info, engine, s, eff });
      const base = [p.code, t.slot_code, info.line, LANG_NAME[info.lang], PLACES[info.place], info.kind, deviceOf(t, p).tier, engine, s.line, s.flags.join('; ')];
      const tail = [t.id ?? '', t.reference_version || '', yes(s.provisional), (s.unexplained || []).join(', ')];
      if (!s.items.length) items.push([...base, '', '', '', '', yes(t.spoken_as_script), '', '', ...tail]);
      s.items.forEach((r, k) => items.push([...base, r.label, eff[k]?.n ?? '', r.outcome, r.heard, yes(t.spoken_as_script), r.outcome === 'wrong number' && t.spoken_as_script !== true ? 'yes: listen again before calling it an engine error' : '', eff[k]?.word || '', ...tail]));
      for (const x of s.extra) items.push([...base, '(not said)', '', 'extra', x, yes(t.spoken_as_script), '', '', ...tail]);
    }
  }

  // Part A summary: every setting, per slice and per volunteer, with the real denominators.
  const all = takes.map(t => { const e = enrich(t); return { ...e, truth: truth(t, e.info.label), cur: !t.superseded_at }; });
  const partA = [['setting', 'slice', 'current takes', 'retakes (superseded, not counted)', 'capture failures (not checked)', 'speech takes (listener)', 'missed speech (refused)', 'missed %', 'no-speech takes (listener)', 'accepted non-speech (absolute)',
    'protocol deviations (heard ≠ intended)', 'uncertain labels', 'unlabelled', 'newly accepted speech vs live', 'newly accepted non-speech vs live', 'rule 3: newly accepted takes with both legs judged', 'rule 3: disqualified takes', 'rule 3: not yet judged',
    'labels not yet frozen', 'rule 3: takes failing the agreed rule (missing or unresolved items)', 'rule 3: incomplete (errors, hand checks, stale or unfrozen)', 'screening result (all slice; a proposal, never a release)']];
  const models = [...new Set(active.map(p => modelKey(deviceOf(null, p))).filter(Boolean))];
  const slices = [['all', () => true], ...['kn', 'hi', 'en'].map(l => [`language ${LANG_NAME[l]}`, (x) => x.info.lang === l]), ...Object.entries(PLACES).map(([k, v]) => [`place ${v}`, (x) => x.info.place === k]),
    ['short lines', (x) => x.info.kind === 'short'], ['soft lines', (x) => x.info.kind === 'soft'], ...Object.keys(CONTROLS).map(c => [`control ${c}`, (x) => x.info.line === c]),
    ...['android_budget', 'android_mid', 'iphone'].map(ph => [`phone ${ph}`, (x) => deviceOf(x.t, x.p).tier === ph]),
    ...models.map(m => [`phone model ${m}`, (x) => modelKey(deviceOf(x.t, x.p)) === m]),
    ...active.map(p => [`volunteer ${p.code}`, (x) => x.p.id === p.id])];
  const liveMissed = all.filter(x => x.cur && x.truth === 'speech' && decision(x.t, SP.LIVE_LIMITS) === 'refuse').length;
  for (const g of GRID) for (const [name, fn] of slices) {
    const xs = all.filter(fn), cur = xs.filter(x => x.cur);
    const sp = cur.filter(x => x.truth === 'speech'), ns = cur.filter(x => x.truth === 'no-speech');
    const missed = sp.filter(x => decision(x.t, g) === 'refuse').length;
    const newly = cur.filter(x => x.info.label === 'speech' && x.truth !== 'no-speech' && newlyAdmitted(x.t, g));
    const newlyNs = ns.filter(x => newlyAdmitted(x.t, g)).length;
    const r3 = newly.map(x => ({ x, ...rule3Status(x, judgments) }));
    const judged = r3.filter(r => ['valid', 'disqualified', 'does not qualify'].includes(r.status));
    const disq = r3.filter(r => r.status === 'disqualified'), dnq = r3.filter(r => r.status === 'does not qualify'), open = r3.filter(r => r.status === 'incomplete');
    let screen = '';
    if (name === 'all' && !g.live) {
      const fails = [...blockers], inc = [...coverage];
      if (newlyNs > 0) fails.push(`rule 1: ${newlyNs} more non-speech accepted`);
      if (disq.length) fails.push(`rule 3: ${disq.length} newly admitted take(s) disqualified`);
      if (dnq.length) fails.push(`rule 3: ${dnq.length} newly admitted take(s) with missing or unresolved items (the agreed rule needs a correct reviewable preview or an explicit refusal on BOTH legs)`);
      if (open.length) {
        const why = {}; for (const r of open) why[r.why] = (why[r.why] || 0) + 1;
        inc.push(`rule 3: ${open.length} newly admitted take(s) without a completed valid judgment (${Object.entries(why).map(([k, v]) => `${v} ${k}`).join(', ')})`);
      }
      const recovered = sp.filter(x => decision(x.t, SP.LIVE_LIMITS) === 'refuse' && decision(x.t, g) === 'accept').length;
      const rule2ok = recovered >= 3 && recovered * 2 >= liveMissed;
      const r2 = `rule 2: recovers ${recovered} of ${liveMissed} missed so far (needs ≥ half and ≥ 3)`;
      if (fails.length) screen = `fails screen: ${fails.join('; ')}; ${r2}${inc.length ? `; also incomplete: ${inc.join('; ')}` : ''}`;
      else if (inc.length) screen = `incomplete: ${inc.join('; ')}; ${r2}`;
      else if (!rule2ok) screen = `fails screen: rule 2: recovers ${recovered} of ${liveMissed} missed (needs ≥ half and ≥ 3)`;
      else screen = `passes the screen on ${sp.length} speech and ${ns.length} no-speech take(s), ${ctl.usable} of 36 controls usable (shown, not counted: ${cur.filter(x => x.truth === 'uncertain').length} uncertain, ${cur.filter(x => x.truth === 'protocol deviation').length} protocol deviation(s), ${cur.filter(x => decision(x.t, g) === 'not checked').length} capture failure(s)); rule 4, the gate, still to run; a proposal for review only`;
    }
    partA.push([`${g.id}${g.live ? ' (live)' : ''}`, name, cur.length, xs.length - cur.length, cur.filter(x => decision(x.t, g) === 'not checked').length, sp.length, missed, pct(missed, sp.length), ns.length,
      ns.filter(x => decision(x.t, g) === 'accept').length, cur.filter(x => x.truth === 'protocol deviation').length, cur.filter(x => x.truth === 'uncertain').length, cur.filter(x => x.truth === 'unlabelled').length,
      newly.length, newlyNs, judged.length, disq.length, newly.length - judged.length, cur.filter(x => !x.t.reference_frozen_at).length, dnq.length, open.length, screen]);
  }
  // Rule 3: every judgment ever made (current and stale), with its reference and judge versions.
  const rule3 = [['judgment id', 'volunteer', 'slot', 'take id', 'take', 'reference version', 'judge version', 'state', 'reason', 'settings that newly admit it', 'engine', 'stage', 'preview judgment', 'after hand check', 'hand verdict',
    'disqualifying problems', 'needs a person because', 'items', 'preview content', 'parser', 'parser calls', 'judged at']];
  const pvText = (pv) => (!pv ? '' : pv.error ? `error: ${pv.error}` : [
    ...(pv.foods || []).map(f => `food: ${`${f.qty_text || ''} ${f.name || ''}`.trim()}${f.grams != null ? ` (${f.grams} g)` : ''}${f.meal ? ` [${f.meal}]` : ''}`),
    ...(pv.unresolved_foods || []).map(f => `unresolved: ${f.name}`), pv.weight_kg != null ? `weight ${pv.weight_kg} kg` : '', pv.water_ml_add != null ? `water ${pv.water_ml_add} ml` : '',
    hasContent(pv.sleep) ? `sleep ${JSON.stringify(pv.sleep)}` : '', ...['activities', 'acv', 'supplements'].filter(k => hasContent(pv[k])).map(k => `${k}: ${JSON.stringify(pv[k])}`),
    ...(pv.workouts || []).map(w => `workout: ${typeof w === 'object' ? `${w.name || ''} ${w.qty_text || ''}${w.sets?.length ? ` sets ${JSON.stringify(w.sets)}` : ''}${w.duration_min ? ` ${w.duration_min} min` : ''}` : w}`),
    ...(Array.isArray(pv.corrections) ? pv.corrections : []).map(c => `correction: ${typeof c === 'object' ? `${c.name} → ${c.grams ?? ''} g ${c.meal || ''}` : c}`), pv.notes ? `note: ${pv.notes}` : '',
    pv.question ? 'question / no log card' : '', pv.safety ? `safety: ${pv.safety}` : '', pv.draft_edit ? 'draft edit' : ''].filter(Boolean).join('; '));
  for (const j of judgments) {
    const t = takes.find(x => x.id === j.take_id); if (!t) continue;
    const { p } = enrich(t);
    const state = j.status === 'running' ? 'running' : j.reference_sha === t.reference_sha && j.judge_version === JUDGE_VERSION ? 'current' : 'STALE (kept; not used)';
    rule3.push([j.id ?? '', p.code, t.slot_code, t.id, t.take_no, j.reference_version ?? '', j.judge_version || '', state, j.reason || 'initial', GRID.filter(g => newlyAdmitted(t, g)).map(g => g.id).join(', '), j.engine, j.stage || '',
      j.judgment?.result || '', effectiveResult(j) || '', j.hand_verdict ? `${j.hand_verdict.verdict} (${who(j.hand_verdict.by)}${j.hand_verdict.note ? `: ${j.hand_verdict.note}` : ''})` : '',
      (j.judgment?.problems || []).join('; '), (j.judgment?.hand || []).join('; '), (j.judgment?.items || []).map(i => `${i.label}: ${i.outcome}${i.shown ? ` (${i.shown})` : ''}`).join('; '),
      pvText(j.preview), j.preview?.aiProvider || j.preview?.aiModel ? `${j.preview.aiProvider || ''}/${j.preview.aiModel || ''}` : j.parser ? `${j.parser.provider || ''}/${j.parser.model || ''}` : '', j.parser_calls || 0, iso(j.finished_at || j.created_at)]);
  }

  // Part B summary: every line outcome, per engine × language × place and per volunteer. Only frozen references count.
  const partB = [['engine', 'slice', 'lines', ...LINE_OUTCOMES, 'needs a hand check', 'awaiting the listener\'s reference (not counted)', 'quantities exact', 'quantities scored', 'wrong numbers not yet confirmed by the listener']];
  const bRow = (engine, name, xsAll) => {
    const xs = xsAll.filter(x => !x.s.provisional);
    const q = xs.flatMap(x => x.s.items.map((r, k) => ({ r, it: x.eff[k] }))).filter(({ it }) => it && it.kind !== 'presence');
    partB.push([engine, name, xs.length, ...LINE_OUTCOMES.map(o => xs.filter(x => x.s.line === o).length), xs.filter(x => x.s.line === HAND_CHECK).length, xsAll.length - xs.length,
      q.filter(({ r }) => OK_ITEM.has(r.outcome)).length, q.length, xsAll.filter(x => x.s.flags.includes('wrong number') && x.t.spoken_as_script !== true).length]);
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
    const rows = (engine) => scored.filter(x => x.engine === engine && !x.s.provisional).flatMap(x => x.s.items.map((r, k) => ({ r, it: x.eff[k] }))).filter(({ it }) => it && it.word === w && String(it.n) === v);
    const gq = rows('gemini'), wq = rows('whisper');
    words.push([w, Number(v), gq.length, gq.filter(({ r }) => kept(r.outcome)).length, gq.filter(({ r }) => r.outcome === 'wrong number').length, wq.filter(({ r }) => kept(r.outcome)).length, wq.filter(({ r }) => r.outcome === 'wrong number').length]);
  }
  const ctlRows = [['volunteer', 'slot', 'place', 'heard (listener)', 'counted as', 'live decision', 'gemini words', 'whisper words', 'whisper fallback decision', 'take id', 'label frozen', 'usable for rule 1', 'replacement authorised']];
  for (const t of current) { const { p, info } = enrich(t); if (info.kind !== 'control') continue;
    ctlRows.push([p.code, t.slot_code, PLACES[info.place] || '', t.heard || '', truth(t, 'no-speech'), decision(t, SP.LIVE_LIMITS), t.gemini_text ?? '(no answer)', t.whisper_text ?? '(no answer)', t.whisper_review ? (t.whisper_review.accepted ? 'accepted' : `refused: ${t.whisper_review.reason}`) : '', t.id ?? '', yes(!!t.reference_frozen_at), yes(ctl.usableTake(t)), yes(!!t.replacement_authorised)]); }

  // Part C: one row per try, one per session, and a ledger of every event.
  const sessionsOf = (trial) => sessions.filter(x => x.trial_no === trial).sort((a, b) => a.id - b.id);
  const firstFinish = (x) => (x.switch_checks || []).find(c => c.reason === 'finish');
  const pc = [['try', 'route', 'operator', 'line', 'voice language', 'say', 'expected', 'planned provider leg', 'attempts', 'retries', 'actual paths', 'counts as a test of the planned provider', 'previews', 'previews from EDITED text',
    'latest read-back', 'restore: whole day equal to the baseline', 'voice backup switch verified off', 'items marked right', 'items marked wrong', 'applied', 'day correct', 'notes', 'finished',
    'sessions', 'resolved (day equal to its baseline and switch off)', 'outstanding']];
  for (const t of [...PARTC_PLAN, ...NATURAL_PLAN]) {
    const r = partc.find(x => x.trial_no === t.trial) || {};
    const caps = r.captures || [];
    const att = caps.filter(c => c.kind === 'server recording' || c.kind === 'on-device dictation');
    const prev = caps.filter(c => c.kind === 'preview');
    const ss = sessionsOf(t.trial), last = ss.slice(-1)[0];
    // Fixes-2y: a recording counts for its planned provider only if the app confirmed the session (its mode was fixed at the take's start).
    const planned = (c) => c.kind === 'server recording' && c.session_match === 'yes' && (t.path === 'gemini' ? /^gemini\//.test(c.answered_by) && !c.voice_backup_switch : /whisper/.test(c.answered_by) && c.voice_backup_switch);
    if (t.route === 'natural' && !caps.length && !r.trial_no && !ss.length) continue;
    const marks = Array.isArray(r.items) ? r.items : [];
    const rb = last ? (last.readbacks || []).filter(x => x.diff).slice(-1)[0] : (r.readbacks || []).slice(-1)[0];
    const cl = last ? (last.cleanups || []).slice(-1)[0] : r.cleanup;
    const ff = last ? firstFinish(last) : null;
    pc.push([t.trial, t.route, t.speaker, t.line, t.lang ? LANG_NAME[t.lang] : '', t.say, t.expect, t.route === 'natural' ? 'none (natural observation)' : t.path === 'gemini' ? 'Gemini (switch off)' : 'Whisper fallback (switch on)',
      att.length, att.filter(c => c.retry_of).length, [...new Set(att.map(c => c.actual_path))].join('; '),
      t.route === 'natural' ? 'no (natural observation)' : att.some(planned) ? 'yes' : att.some(c => c.kind === 'server recording' && c.session_match !== 'yes') && !att.some(planned) ? 'NO: the app did not confirm the session for its recording(s)' : att.length ? 'NO: the planned provider never answered (see actual paths)' : '',
      prev.length, prev.filter(c => c.edited).length,
      rb ? (rb.diff.same ? 'no change' : `added ${rb.diff.added_foods.length} food(s); fields ${rb.diff.changed_fields.map(f => f.field).join(', ') || 'none'}; workouts ${rb.diff.workouts_changed ? 'changed' : 'same'}`) : '',
      cl ? (cl.ok ? 'yes' : `NO: ${JSON.stringify(cl.diff).slice(0, 160)}`) : '', ff ? yes(!ff.on) : yes(r.switch_off_verified),
      marks.filter(m => m.ok === true).map(m => m.label).join('; '), marks.filter(m => m.ok === false).map(m => m.label).join('; '), yes(r.applied), yes(r.day_correct), r.notes || '', iso(r.finished_at),
      ss.length, last ? (last.resolved_at ? `yes, ${iso(last.resolved_at)}` : 'NO') : '', last && !last.resolved_at ? (last.resolution?.outstanding || ['not finished yet']).join('; ') : '']);
  }
  const sess = [['session', 'try', 'route', 'armed at', 'recording until', 'capture stopped', 'stop reason', 'baseline: foods / weight / water / workouts', 'read-backs', 'latest read-back', 'restores', 'latest restore', 'switch checks', 'switch at first Finish', 'resolved at', 'outstanding']];
  for (const x of [...sessions].sort((a, b) => a.id - b.id)) {
    const b = x.baseline || {}, rbs = (x.readbacks || []).filter(y => y.diff), cls = x.cleanups || [], sw = x.switch_checks || [], ff = firstFinish(x);
    const lr = rbs.slice(-1)[0], lc = cls.slice(-1)[0];
    sess.push([x.id, x.trial_no, x.route, iso(x.armed_at), iso(x.armed_at ? new Date(new Date(x.armed_at).getTime() + ARM_MINUTES * 60000) : null), iso(x.capture_stopped_at), x.stop_reason || '',
      `${(b.day?.food_items || []).length} / ${b.day?.weight_kg ?? '—'} / ${b.day?.water_ml ?? '—'} / ${(b.workouts || []).length}`, rbs.length, lr ? (lr.diff.same ? `no change (${iso(lr.at)})` : `differs (${iso(lr.at)})`) : '',
      cls.length, lc ? `${lc.ok ? 'equal to the baseline' : 'STILL DIFFERS'} (${iso(lc.at)})` : '', sw.length, ff ? (ff.on ? 'ON' : 'off') : '', iso(x.resolved_at), x.resolved_at ? '' : (x.resolution?.outstanding || ['not finished yet']).join('; ')]);
  }
  const ledger = [['try', 'event', 'kind', 'at', 'session', 'attempt', 'retry of attempt', 'audio uploaded', 'session sent by the app', 'actual path', 'engines tried', 'model version', 'voice backup switch', 'HTTP status', 'language', 'audio sha256',
    'speech check', 'words or refusal', 'preview', 'preview text source']];
  for (const r of partc) (r.captures || []).forEach((c, i) => ledger.push([r.trial_no, i + 1, c.kind, iso(c.at), c.session_id ?? '', c.attempt ?? '', c.retry_of ?? '', c.upload == null ? '' : yes(c.upload), c.session_match || '', c.actual_path || '',
    (c.trail || []).map(x => `${x.engine}${x.model ? `/${x.model}` : ''}: ${x.outcome}${x.status ? ` ${x.status}` : ''}`).join('; '), c.model_version || (c.trail || []).filter(x => x.model_version).map(x => x.model_version).join('; '),
    c.kind === 'server recording' ? yes(c.voice_backup_switch) : '', c.http_status ?? '', c.lang_hint || '', (c.audio_sha256 || '').slice(0, 16),
    c.speech ? `${c.speech.status} (${c.speech.voiced_ms ?? '—'} ms voiced)` : '', c.kind === 'preview' ? c.message : c.rejected ? `refused: ${c.rejected}` : c.transcript ?? c.error ?? '',
    c.preview ? pvText(c.preview) : '', c.text_source || '']));
  const vols = [['volunteer', 'group', 'profile', 'phone', 'browser', 'installed app', 'consented', 'consent version', 'slots planned', 'slots recorded', 'takes kept', 'phone make', 'phone model', 'os', 'os version', 'browser version']];
  for (const p of active) { const d = deviceOf(null, p); vols.push([p.code, GROUPS[p.grp].name, p.profile_note || '', d.tier, d.browser, yes(p.installed_app), iso(p.consented_at), p.consent_version || '', PLANNED_PER_GROUP[p.grp],
    new Set(current.filter(t => t.participant_id === p.id).map(t => t.slot_code)).size, takes.filter(t => t.participant_id === p.id).length, d.make, d.model, d.os, d.os_version, d.browser_version]); }

  // History: every label, reference version, hand check, judgment, mark, session step and wording check.
  const history = [['kind', 'about', 'at', 'by', 'what']];
  const takeRef = (t) => `take ${t.id} (${byId.get(t.participant_id)?.code || '?'} ${t.slot_code} #${t.take_no})`;
  const brief = (o) => JSON.stringify(o, (k, v) => (k === 'by' || k === 'at' || k === 'recorded_by' ? undefined : v)).slice(0, 600);
  for (const t of takes) {
    for (const h of t.label_history || []) history.push(['label (draft)', takeRef(t), iso(h.at), who(h.by), brief(h)]);
    for (const h of t.reference_history || []) history.push([`reference v${h.version}`, takeRef(t), iso(h.at), [h.listener, who(h.by)].filter(Boolean).join(' / '), brief({ sha: String(h.sha || '').slice(0, 16), ...h.reference })]);
    for (const h of t.hand_history || []) history.push(['Part B hand check', takeRef(t), iso(h.at), who(h.by), brief(h)]);
    if (t.replacement_authorised && !(grants || []).some(g => g.take_id === t.id)) history.push(['replacement authorised', takeRef(t), iso(t.replacement_authorised.at), who(t.replacement_authorised.by), brief({ why: t.replacement_authorised.why || null })]);
  }
  // Fixes-3a: the grants ledger, including grants whose takes were deleted since (they still count against the budget).
  for (const g of grants || []) {
    const t = takes.find(x => x.id === g.take_id);
    history.push([`replacement granted (${g.grant_no} of ${REPLACEMENT_BUDGET})`, t ? takeRef(t) : `take ${g.take_id} (${g.participant_code || '?'} ${g.slot_code || ''}; deleted since)`, iso(g.granted_at), who(g.granted_by), brief({ why: g.why || null, replaced_by_take: g.replacement_take_id ?? null })]);
  }
  for (const j of judgments) {
    const t = takes.find(x => x.id === j.take_id); if (!t) continue;
    history.push([`rule 3 judgment (${j.reason || 'initial'})`, `${takeRef(t)} ${j.engine}`, iso(j.created_at), '', brief({ reference_version: j.reference_version, judge: j.judge_version, result: j.judgment?.result, calls: j.parser_calls })]);
    for (const h of j.hand_history || []) history.push(['rule 3 hand verdict', `${takeRef(t)} ${j.engine}`, iso(h.at), who(h.by), brief(h)]);
  }
  for (const r of partc) for (const e of r.edits || []) history.push(['Part C marks', `try ${r.trial_no}`, iso(e.at), who(e.by), brief(e)]);
  for (const x of sessions) {
    history.push(['Part C session armed', `try ${x.trial_no} session ${x.id}`, iso(x.armed_at), who(x.armed_by), brief({ route: x.route })]);
    for (const c of x.cleanups || []) history.push(['Part C restore', `try ${x.trial_no} session ${x.id}`, iso(c.at), who(c.by), brief({ ok: c.ok })]);
    for (const c of x.switch_checks || []) history.push(['Part C switch check', `try ${x.trial_no} session ${x.id}`, iso(c.at), '', brief({ reason: c.reason, on: c.on })]);
    if (x.capture_stopped_at) history.push(['Part C capture stopped', `try ${x.trial_no} session ${x.id}`, iso(x.capture_stopped_at), '', brief({ reason: x.stop_reason })]);
    if (x.resolved_at) history.push(['Part C session resolved', `try ${x.trial_no} session ${x.id}`, iso(x.resolved_at), '', 'day equal to its baseline; Voice backup switch off']);
  }
  for (const w of wording) for (const h of w.history || []) history.push([`wording ${h.action || ''}`.trim(), LANG_NAME[w.lang] || w.lang, iso(h.at), reviewerCode(h.reviewer || h.by) || who(h.recorded_by), brief({ action: h.action, sha: String(h.sha || '').slice(0, 16), note: h.note || null })]);
  history.splice(1, history.length - 1, ...history.slice(1).sort((a, b) => String(a[2]).localeCompare(String(b[2]))));

  const out = [
    { name: 'About', rows: about }, { name: 'Volunteers', rows: vols }, { name: 'Plan', rows: plan }, { name: 'Lines', rows: lines }, { name: 'Slots', rows: slots },
    { name: 'Takes', rows: takesSheet }, { name: 'Items', rows: items }, { name: 'Part A summary', rows: partA }, { name: 'Rule 3 previews', rows: rule3 }, { name: 'Part B summary', rows: partB },
    { name: 'Number words', rows: words }, { name: 'Controls', rows: ctlRows }, { name: 'Part C tries', rows: pc }, { name: 'Part C sessions', rows: sess }, { name: 'Part C events', rows: ledger }, { name: 'History', rows: history },
  ];
  // Fixes-2y: registered names never reach the shared file. Fixes-2z: EVERY data cell of EVERY sheet is scrubbed, including
  // summaries and labels derived from editable text (About's phone mix, Part A's phone-model slices). All counting and grouping
  // above used the original values, so only the presentation changes. Column headers and sheet names are fixed by the code.
  const { scrub } = nameScrubber(privateNames, accountNames);
  const removed = {}; let removedTotal = 0;
  for (const sh of out) {
    const H = sh.rows[0];
    for (let i = 1; i < sh.rows.length; i++) sh.rows[i] = sh.rows[i].map((v, k) => { if (typeof v !== 'string' || !v) return v; const r = scrub(v); if (r.n) { removed[`${sh.name}|${H[k]}`] = (removed[`${sh.name}|${H[k]}`] || 0) + r.n; removedTotal += r.n; } return r.text; });
  }
  const free = [['sheet', 'column', 'cells with text', 'names removed', 'check before sharing']];
  for (const [sheet, cols] of Object.entries(FREE_TEXT_COLUMNS)) {
    const sh = out.find(x => x.name === sheet); const H = sh.rows[0];
    for (const c of cols) { const k = H.indexOf(c); const n = k < 0 ? 0 : sh.rows.slice(1).filter(r => typeof r[k] === 'string' && r[k].trim()).length; free.push([sheet, c, n, removed[`${sheet}|${c}`] || 0, n ? 'yes: read these cells before sharing' : '']); }
  }
  // Derived text: cells built from editable text, listed every time so the sharing check never misses them.
  for (const [sheet, col, rowsOf, label] of DERIVED_TEXT) {
    const sh = out.find(x => x.name === sheet); const H = sh.rows[0]; const k = H.indexOf(col);
    const n = sh.rows.slice(1).filter(rowsOf).length;
    free.push([sheet, label, n, removed[`${sheet}|${col}`] || 0, n ? 'yes: built from phone details people typed; read before sharing' : '']);
  }
  const listed = (key) => Object.entries(FREE_TEXT_COLUMNS).some(([sh, cols]) => cols.some(c => key === `${sh}|${c}`)) || DERIVED_TEXT.some(([sh, col]) => key === `${sh}|${col}`);
  const other = Object.entries(removed).filter(([key]) => !listed(key));
  for (const [k, n] of other) { const [sheet, c] = k.split('|'); free.push([sheet, c, '', n, 'yes: a registered name appeared here and was removed']); }
  about.splice(about.findIndex(r => r[0] === 'reviewers') + 1, 0, ['names removed from free text', `${removedTotal} (registered volunteer and reviewer names; see the Free text sheet, and read free text before sharing)`]);
  out.push({ name: 'Free text', rows: free });
  return out;
}

module.exports = {
  CONSENT_VERSION, SCRIPT_VERSION, JUDGE_VERSION, LINES, CONTROLS, PLACES, LANG_HINT, LANG_NAME, GROUPS, MAX_PARTICIPANTS, slotPlan, slotInfo, PLANNED_PER_GROUP, PLANNED_TOTAL,
  linesFor, scriptSha, GRID, featuresOf, decision, replayMatches, newlyAdmitted, tokens, phrasesOf, scoreTranscript, itemsWithReference, validReferenceItems, referenceSha, scriptProblem,
  ITEM_OUTCOMES, LINE_OUTCOMES, LINE_STATES, HAND_CHECK, FOOD, EXTRA_FOODS, UNIT,
  judgePreview, PREVIEW_RESULTS, LEG_CLASS, effectiveResult, legStatus, rule3Status, voiceLeg, geminiModels, geminiTake, whisperTake, transcribeTake,
  PARTC_PLAN, PARTC_LINES, NATURAL_PLAN, NATURAL_SLOTS, trialInfo, ARM_MINUTES, available, armedFor, recordTrial, recordDeviceDictation, recordPreview, answeredBy, speechRecord, actualPath,
  dayState, dayDiff, restoreDay, checkSession, workbookSheets, truth, takeScore, deviceOf, phoneMix, nameScrubber, foodKeysOf, controlCoverage, REPEATED, REPLACEMENT_BUDGET, REPLACEMENT_ROUND, weightCheck, WEIGHT_CHECK, engineCalls,
};
