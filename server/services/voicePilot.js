/**
 * services/voicePilot.js — Phase 8: the Kannada-English voice pilot.
 *
 * A fixed set of everyday logging phrases, as members in Karnataka say them
 * (Kannada-English, written in English letters). Each has the key words a
 * transcript must contain to count as understood, with the spellings that
 * mean the same ("dose" or "dosa", "2" or "eradu").
 *
 * PHRASES ARE A FIRST DRAFT: Sachin, please check the Kannada wording and
 * change any line here; ids must stay the same once members have recorded.
 *
 * Each recording is transcribed by BOTH engines, separately (not as a
 * fallback), so the pilot can say which one understands members better:
 *   gemini  Gemini, with a Kannada-English prompt
 *   whisper Whisper large-v3 on Groq, with a Kannada-English prompt
 */
const axios = require('axios');

// keys: each entry is one key word; a string with '|' lists spellings that count.
const PHRASES = [
  { id: 'k01', say: 'Belagge eradu idli mattu ondu bowl sambar thinde', means: 'This morning I ate two idli and a bowl of sambar', keys: ['idli', '2|eradu|two', 'sambar|sambhar'] },
  { id: 'k02', say: 'Breakfast-ge ondu plate upma, ondu cup coffee', means: 'For breakfast, a plate of upma and a cup of coffee', keys: ['upma|uppittu', 'coffee|kaafi|kapi'] },
  { id: 'k03', say: 'Madhyahna oota: ondu ragi mudde, soppina saaru, swalpa palya', means: 'Lunch: one ragi ball, greens saaru, a little palya', keys: ['ragi', 'mudde', 'saaru|saru', 'palya'] },
  { id: 'k04', say: 'Lunch-ge eradu chapati, ondu katori dal mattu mosaru', means: 'For lunch, two chapati, a katori of dal and curd', keys: ['chapati|chapathi|chappathi', '2|eradu|two', 'dal|daal', 'mosaru|curd'] },
  { id: 'k05', say: 'Sanje ondu lota majjige kudide', means: 'In the evening I drank a glass of buttermilk', keys: ['majjige|buttermilk', 'lota|glass'] },
  { id: 'k06', say: 'Ivattu mooru litre neeru kudide', means: 'I drank three litres of water today', keys: ['3|mooru|three', 'litre|liter|ltr', 'neeru|water'] },
  { id: 'k07', say: 'Raatri oota-ge anna, saaru mattu ondu motte', means: 'For dinner, rice, saaru and one egg', keys: ['anna|rice', 'saaru|saru', 'motte|egg'] },
  { id: 'k08', say: 'Dinner-ge eradu jolada rotti mattu ennegai', means: 'For dinner, two jowar rotti and stuffed brinjal', keys: ['jolada|jowar', 'rotti|roti', 'ennegai|enne gai|ennegayi'] },
  { id: 'k09', say: 'Snack-ge ondu baale hannu mattu hattu badami', means: 'For a snack, one banana and ten almonds', keys: ['baale|banana', '10|hattu|ten', 'badami|almond'] },
  { id: 'k10', say: 'Gym aada mele ondu scoop whey protein haalu jote', means: 'After the gym, a scoop of whey protein with milk', keys: ['whey', 'protein', 'haalu|milk'] },
  { id: 'k11', say: 'Ivattu belagge nanna tooka eppattu eradu point aidu kg', means: 'My weight this morning is 72.5 kg', keys: ['72|eppattu', '5|aidu|five', 'kg|kilo'] },
  { id: 'k12', say: 'Nalavattu nimisha walking maadide', means: 'I walked for forty minutes', keys: ['40|nalavattu|forty', 'nimisha|minute|min', 'walk'] },
  { id: 'k13', say: 'Gym-alli squat mooru set, hattu reps maadide', means: 'At the gym, squats: three sets of ten', keys: ['squat', '3|mooru|three', '10|hattu|ten', 'rep'] },
  { id: 'k14', say: 'Nenne raatri elu gante nidde maadide', means: 'I slept seven hours last night', keys: ['7|elu|seven', 'gante|hour', 'nidde|sleep'] },
  { id: 'k15', say: 'Ondu masala dose, kaayi chutney jote', means: 'One masala dosa with coconut chutney', keys: ['masala', 'dose|dosa|dosai', 'chutney|chatni'] },
  { id: 'k16', say: 'Ondu plate puliyogare mattu swalpa mosaranna', means: 'A plate of puliyogare and a little curd rice', keys: ['puliyogare|puliogare|puliyogre', 'mosaranna|curd rice'] },
  { id: 'k17', say: 'Akki rotti eradu, kaayi chutney jote', means: 'Two rice rotti with coconut chutney', keys: ['akki|rice', 'rotti|roti', '2|eradu|two', 'chutney|chatni'] },
  { id: 'k18', say: 'Tea-ge sakkare haakilla', means: 'No sugar in my tea', keys: ['tea|chai', 'sakkare|sugar'] },
  { id: 'k19', say: 'Ondu bowl kosambari mattu bisi bele bath', means: 'A bowl of kosambari and bisi bele bath', keys: ['kosambari|kosambri', 'bisi', 'bele', 'bath|baath|bhath'] },
  { id: 'k20', say: 'Paneer nooru gram, soppina palya jote', means: 'Paneer, 100 grams, with greens palya', keys: ['paneer|panir', '100|nooru|hundred', 'gram|g', 'palya'] },
  // Their own words: no key words, read by the coach.
  { id: 'f01', say: 'Your own words: what did you eat yesterday?', means: 'Say it the way you would tell a friend', keys: [], free: true },
  { id: 'f02', say: 'Your own words: your weight and one workout', means: 'Any way you like, Kannada, English or both', keys: [], free: true },
];

// ── Rule checks (Fixes-2m; rebuilt in Fixes-2n after the 19 Oct review) ────
// The keyword score asks "were the key words heard?". It cannot tell "no sugar"
// from "sugar", "2 idli" from "3 idli", 72.5 kg from 725 or from 72.5 pounds,
// or lunch from dinner. These checks ask those questions separately, per
// recording and per engine. They are LIMITED, RULE-BASED checks of a few
// phrases, not a judgment of meaning. Nothing here chooses an engine.
//
// 2m bound too loosely (the reviewer's five false passes): "no" anywhere made
// "no sugar" pass ("tea with sugar no milk"); a number next to ANY bowl passed
// "1 bowl sambar" ("one bowl rice"); the next item's number counted ("1 idli
// 2 bowls sambar" passed "2 idli"); 72.5 POUNDS passed "72.5 kg"; and "one
// plate rice … two plates upma" passed "1 plate upma". Since 2n the number,
// its unit or container, the food and the "no" are read from the SAME phrase:
//   quantity  phrases "<number> [unit] [of] <food>" (or "<food> [unit] <number>"
//             at the end of a phrase, as in "akki rotti eradu") are read out of
//             the transcript; the check looks only at the phrases for its food
//             (and unit). All of them say the expected number → pass; none →
//             fail; some do and some don't → UNVERIFIED (conflicting).
//   weight    the same, with a weight unit: kg passes, pounds fail, a bare
//             number is unverified.
//   negation  each mention of the item is "negated" only if a "no" word sits
//             directly before it (no / without / zero sugar) or directly after
//             it (sakkare illa / haakilla / nahi / not added). All negated →
//             pass; none → fail; mixed → unverified.
//   meal/day  the expected word is heard and no other meal (day) is; both →
//             unverified.
// Each check returns { kind, label, result: 'pass'|'fail'|'unverified', pass }.
const MEAL_WORDS = { morning: 'belagge|belage|morning|breakfast|brekfast|tindi', breakfast: 'breakfast|brekfast|tindi|belagge|belage|morning', lunch: 'lunch|lanch|madhyahna|afternoon', dinner: 'dinner|dinnar|raatri|ratri|night', evening: 'sanje|evening|snack|snyak', snack: 'snack|snyak|sanje|evening' };
const ALL_MEALS = [...new Set(Object.values(MEAL_WORDS).join('|').split('|'))];
const meal = (label, key) => ({ kind: 'meal', label, any: MEAL_WORDS[key], others: ALL_MEALS.filter(w => !MEAL_WORDS[key].split('|').includes(w)).join('|') });
const TODAY = 'ivattu|ivathu|indu|today', LASTNIGHT = 'nenne|yesterday|last night';
const F = { idli: 'idli|idly|itli|idlis', sambar: 'sambar|sambhar|saambar|sambaru', upma: 'upma|uppittu|uppit', coffee: 'coffee|kaafi|kapi|kafi|kaapi', mudde: 'mudde|ragi', chapati: 'chapati|chapathi|chappathi|chapatis', egg: 'motte|egg|eggs',
  rotti: 'rotti|roti|rottis|rotis', almond: 'badami|almond|almonds', neeru: 'neeru|water' };
const U = { bowl: 'bowl|bowls|baul', plate: 'plate|plates|plet', cup: 'cup|cups|kap', litre: 'litre|litres|liter|liters|ltr|litar', minute: 'nimisha|minute|minutes|min|mins', set: 'set|sets', rep: 'rep|reps',
  hour: 'gante|hour|hours|hrs', gram: 'gram|grams|g|gm|gms', kg: 'kg|kgs|kilo|kilos|kilogram|kilograms', pound: 'pound|pounds|lb|lbs' };
const CHECKS = {
  k01: [meal('morning', 'morning'), { kind: 'quantity', label: '2 idli', n: 2, food: F.idli }, { kind: 'quantity', label: '1 bowl sambar', n: 1, unit: U.bowl, food: F.sambar }],
  k02: [meal('breakfast', 'breakfast'), { kind: 'quantity', label: '1 plate upma', n: 1, unit: U.plate, food: F.upma }, { kind: 'quantity', label: '1 cup coffee', n: 1, unit: U.cup, food: F.coffee }],
  k03: [meal('lunch', 'lunch'), { kind: 'quantity', label: '1 ragi mudde', n: 1, food: F.mudde }],
  k04: [meal('lunch', 'lunch'), { kind: 'quantity', label: '2 chapati', n: 2, food: F.chapati }],
  k05: [meal('evening', 'evening')],
  k06: [{ kind: 'date', label: 'today', any: TODAY, others: LASTNIGHT }, { kind: 'quantity', label: '3 litres', n: 3, unit: U.litre }],
  k07: [meal('dinner', 'dinner'), { kind: 'quantity', label: '1 egg', n: 1, food: F.egg }],
  k08: [meal('dinner', 'dinner'), { kind: 'quantity', label: '2 jowar rotti', n: 2, food: F.rotti }],
  k09: [meal('snack', 'snack'), { kind: 'quantity', label: '10 almonds', n: 10, food: F.almond }],
  k11: [{ kind: 'date', label: 'today', any: TODAY, others: LASTNIGHT }, { kind: 'weight', label: '72.5 kg', n: 72.5, unit: U.kg, wrong: U.pound }],
  k12: [{ kind: 'quantity', label: '40 minutes', n: 40, unit: U.minute }],
  k13: [{ kind: 'quantity', label: '3 sets', n: 3, unit: U.set }, { kind: 'quantity', label: '10 reps', n: 10, unit: U.rep }],
  k14: [{ kind: 'date', label: 'last night', any: LASTNIGHT, others: TODAY }, { kind: 'quantity', label: '7 hours', n: 7, unit: U.hour }],
  k17: [{ kind: 'quantity', label: '2 rice rotti', n: 2, food: F.rotti }],
  k18: [{ kind: 'negation', label: 'no sugar', item: 'sakkare|sugar|cheeni|chini|shakkar', pre: 'no|without|zero|bina|bin', post: 'haakilla|hakilla|haakalla|illa|nahi|not|beda|haakbedi' }],
  k20: [{ kind: 'quantity', label: '100 grams', n: 100, unit: U.gram }],
};

// Numbers as members say them: digits, English words, Kannada words, "point".
const NUM_WORDS = {
  ondu: 1, eradu: 2, mooru: 3, naalku: 4, nalku: 4, aidu: 5, aaru: 6, elu: 7, yelu: 7, entu: 8, ombattu: 9, hattu: 10, nooru: 100,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, hundred: 100,
};
const TENS = { ippattu: 20, muvattu: 30, moovattu: 30, nalavattu: 40, aivattu: 50, aravattu: 60, eppattu: 70, embattu: 80, tombattu: 90,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const FILLERS = new Set(['of', 'full', 'small', 'big', 'medium', 'hot', 'cold', 'the', 'masala', 'plain']);
const SEP = '|';

function meaningChecks(phraseId, transcript) {
  const list = CHECKS[phraseId] || [];
  if (transcript == null) return [];
  const raw = String(transcript);
  const kn = /[ಀ-೿]/.test(raw);
  const f = kn ? (w) => loose(norm(w)) : (w) => norm(w);
  // Phrase breaks: commas, semicolons, full stops (not decimal points), "and", "then", "mattu", "aamele".
  let text = (kn ? kannadaToLatin(raw) : raw).toLowerCase()
    .replace(/(\d)\.(\d)/g, '$1․$2')                   // keep 72.5 together
    .replace(/[,;:!?()]|\.(?=\s|$)/g, ` ${SEP} `).replace(/․/g, '.');
  const toks = [];
  for (const w0 of text.split(/\s+/)) {
    if (!w0) continue;
    if (w0 === SEP) { toks.push(SEP); continue; }
    for (const w1 of w0.split(/[-–]/)) {            // "breakfast-ge" → breakfast, ge
      const w = kn ? loose(norm(w1)) : norm(w1);
      if (!w) continue;
      if (['and', 'then', 'mattu', 'amele', 'aamele', 'also', 'plus'].includes(w)) toks.push(SEP); else toks.push(w);
    }
  }
  const lex = (spec) => spec.split('|').map(f).filter(Boolean);
  const is = (tok, spec) => tok !== SEP && lex(spec).some(v => tok === v || (v.length > 3 && tok.startsWith(v)));
  const nw = Object.fromEntries(Object.entries(NUM_WORDS).map(([k, v]) => [f(k), v]));
  const tw = Object.fromEntries(Object.entries(TENS).map(([k, v]) => [f(k), v]));
  const one = (tok) => (/^\d+(\.\d+)?$/.test(tok) ? Number(tok) : nw[tok] ?? null);
  // A number starting at i: { value, len }.
  const numberAt = (i, allowA) => {
    const t = toks[i]; if (t == null || t === SEP) return null;
    let value = null, len = 0;
    if (tw[t] != null) { value = tw[t]; len = 1; const u = nw[toks[i + 1]]; if (u != null && u < 10) { value += u; len = 2; } }
    else if (one(t) != null) { value = one(t); len = 1; }
    else if (allowA && t === 'a') { value = 1; len = 1; }
    if (value == null) return null;
    if (toks[i + len] === 'point') { const d = one(toks[i + len + 1]); if (d != null && d < 10 && Number.isInteger(d)) { value = Number(`${Math.floor(value)}.${d}`); len += 2; } }
    return { value, len };
  };
  const anyUnit = Object.values(U).join('|');
  // Read out the quantity phrases.
  const phrases = [];
  for (let i = 0; i < toks.length; i++) {
    const n = numberAt(i, true); if (!n) continue;
    let j = i + n.len, unit = null; const food = [];
    while (j < toks.length && FILLERS.has(toks[j]) && toks[j] !== 'of') j++;   // "2 big plates"
    if (j < toks.length && is(toks[j], anyUnit)) { unit = toks[j]; j++; }
    while (j < toks.length && FILLERS.has(toks[j])) j++;
    for (let k = 0; k < 2 && j < toks.length && toks[j] !== SEP && !numberAt(j, false); k++, j++) food.push(toks[j]);
    if (!unit && !food.length) {
      // "akki rotti eradu", "paneer nooru gram": the number closes the phrase, its food came first.
      for (let b = i - 1; b >= 0 && b >= i - 3 && toks[b] !== SEP && !numberAt(b, false); b--) { if (!unit && is(toks[b], anyUnit)) unit = toks[b]; else food.unshift(toks[b]); }
    } else if (unit && !food.length) {
      for (let b = i - 1; b >= 0 && b >= i - 2 && toks[b] !== SEP && !numberAt(b, false); b--) food.unshift(toks[b]);
    }
    phrases.push({ value: n.value, unit, food });
    i += n.len - 1;
  }
  const result = (r) => r;
  const judge = (good, bad) => (good && !bad ? 'pass' : good && bad ? 'unverified' : 'fail');
  const hasAny = (spec) => toks.some(t => is(t, spec)) || spec.split('|').some(v => v.includes(' ') && ` ${toks.join(' ')} `.includes(` ${f(v)} `));
  return list.map(c => {
    let r = 'fail';
    if (c.kind === 'meal' || c.kind === 'date') r = judge(hasAny(c.any), hasAny(c.others));
    else if (c.kind === 'negation') {
      const at = toks.map((t, i) => (is(t, c.item) ? i : -1)).filter(i => i >= 0);
      const neg = at.map(i => (i > 0 && is(toks[i - 1], c.pre)) || (i > 1 && toks[i - 1] === 'added' && is(toks[i - 2], c.pre))
        || (i + 1 < toks.length && is(toks[i + 1], c.post)) || (i + 2 < toks.length && toks[i + 1] === 'added' && is(toks[i + 2], c.post)));
      r = !at.length ? 'fail' : judge(neg.some(Boolean), neg.some(x => !x));
    } else if (c.kind === 'quantity' || c.kind === 'weight') {
      const mine = phrases.filter(p => (c.food ? p.food.some(t => is(t, c.food)) : true)
        && (c.kind === 'weight' ? (p.unit ? (is(p.unit, c.unit) || is(p.unit, c.wrong)) : p.value === c.n)
            : c.unit ? (c.food ? true : p.unit && is(p.unit, c.unit)) : true)
        && (c.food || c.unit || c.kind === 'weight'));
      if (c.kind === 'weight') {
        const ok = mine.some(p => p.value === c.n && p.unit && is(p.unit, c.unit));
        const wrong = mine.some(p => !(p.value === c.n && p.unit && is(p.unit, c.unit)) && p.unit);
        const bare = mine.some(p => !p.unit && p.value === c.n);
        r = ok ? (wrong ? 'unverified' : 'pass') : wrong ? 'fail' : bare ? 'unverified' : 'fail';
      } else {
        const fits = (p) => p.value === c.n && (!c.unit || (p.unit && is(p.unit, c.unit)));
        r = !mine.length ? 'fail' : judge(mine.some(fits), mine.some(p => !fits(p)));
      }
    }
    return { kind: c.kind, label: c.label, result: result(r), pass: r === 'pass' };
  });
}
/** "breakfast ✓ · 1 plate upma ✗ · 2 idli ?" — ? = unverified (conflicting). */
const checksText = (list) => (list || []).map(c => `${c.label} ${c.result === 'pass' || (c.result == null && c.pass) ? '✓' : c.result === 'unverified' ? '?' : '✗'}`).join(' · ');

// ── Scripts (Fixes-2m) ──────────────────────────────────────────────────────
// 19 Oct, first real pilot recording: Whisper (language not set) took Kannada
// speech for Tamil and wrote it in Tamil script, which the key words (English
// letters) can never match. Since then the pilot asks Whisper for Kannada, and
// Whisper writes Kannada in Kannada script; to score that fairly it is spelled
// out in English letters first (below). A Tamil, Telugu or Hindi script answer
// is never converted: it is the wrong language, and it is labelled as such.
const SCRIPTS = [['kannada', /[\u0C80-\u0CFF]/g], ['tamil', /[\u0B80-\u0BFF]/g], ['telugu', /[\u0C00-\u0C7F]/g], ['devanagari', /[\u0900-\u097F]/g], ['malayalam', /[\u0D00-\u0D7F]/g], ['latin', /[A-Za-z]/g]];
/** The writing system of a transcript: 'latin', 'kannada', 'tamil'…, 'mixed' or null (empty). */
function scriptOf(text) {
  const t = String(text || '');
  const counts = SCRIPTS.map(([name, re]) => [name, (t.match(re) || []).length]).filter(([, n]) => n > 0);
  if (!counts.length) return null;
  counts.sort((a, b) => b[1] - a[1]);
  const total = counts.reduce((x, [, n]) => x + n, 0);
  return counts[0][1] / total >= 0.8 ? counts[0][0] : 'mixed';
}
const SCRIPT_LABEL = { latin: 'English letters', kannada: 'Kannada script', tamil: 'Tamil script', telugu: 'Telugu script', devanagari: 'Devanagari (Hindi) script', malayalam: 'Malayalam script', mixed: 'mixed scripts' };

// Kannada script → English letters, the way members spell it (idli, eradu,
// sambar, kaafi). Simplified on purpose: retroflex and dental letters fall
// together (ಡ/ದ → d), as they do in everyday spelling.
const KN_V = { 'ಅ': 'a', 'ಆ': 'aa', 'ಇ': 'i', 'ಈ': 'ee', 'ಉ': 'u', 'ಊ': 'oo', 'ಋ': 'ru', 'ಎ': 'e', 'ಏ': 'e', 'ಐ': 'ai', 'ಒ': 'o', 'ಓ': 'o', 'ಔ': 'au' };
const KN_C = { 'ಕ': 'k', 'ಖ': 'kh', 'ಗ': 'g', 'ಘ': 'gh', 'ಙ': 'n', 'ಚ': 'ch', 'ಛ': 'chh', 'ಜ': 'j', 'ಝ': 'jh', 'ಞ': 'n', 'ಟ': 't', 'ಠ': 'th', 'ಡ': 'd', 'ಢ': 'dh', 'ಣ': 'n',
  'ತ': 't', 'ಥ': 'th', 'ದ': 'd', 'ಧ': 'dh', 'ನ': 'n', 'ಪ': 'p', 'ಫ': 'f', 'ಬ': 'b', 'ಭ': 'bh', 'ಮ': 'm', 'ಯ': 'y', 'ರ': 'r', 'ಱ': 'r', 'ಲ': 'l', 'ಳ': 'l', 'ೞ': 'l',
  'ವ': 'v', 'ಶ': 'sh', 'ಷ': 'sh', 'ಸ': 's', 'ಹ': 'h' };
const KN_M = { 'ಾ': 'aa', 'ಿ': 'i', 'ೀ': 'ee', 'ು': 'u', 'ೂ': 'oo', 'ೃ': 'ru', 'ೆ': 'e', 'ೇ': 'e', 'ೈ': 'ai', 'ೊ': 'o', 'ೋ': 'o', 'ೌ': 'au' };
const VIRAMA = '್';
function kannadaToLatin(text) {
  const t = [...String(text || '').normalize('NFC')];
  let out = '';
  for (let i = 0; i < t.length; i++) {
    const c = t[i], nx = t[i + 1];
    if (KN_V[c]) out += KN_V[c];
    else if (KN_C[c]) {
      out += KN_C[c];
      if (nx === VIRAMA) i++;
      else if (KN_M[nx]) { out += KN_M[nx]; i++; }
      else if (nx !== '಼') out += 'a';
    }
    else if (c === 'ಂ') out += /^[ಪಫಬಭಮ]/.test(nx || '') ? 'm' : 'n';
    else if (c === 'ಃ') out += 'h';
    else if (c >= '೦' && c <= '೯') out += String(c.charCodeAt(0) - 0x0CE6);
    else if (c === '಼' || c === '\u200c' || c === '\u200d') continue;
    else out += c;
  }
  return out;
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9.\u0C80-\u0CFF ]+/g, ' ').replace(/\s+/g, ' ').trim();
// Spelling-level matching for a transliterated answer only: long vowels and
// "ph" fall together (saambaar = sambar, neeru = niru, kaafi = kafi).
const loose = (s) => s.replace(/ee/g, 'i').replace(/oo/g, 'u').replace(/aa/g, 'a').replace(/ii/g, 'i').replace(/uu/g, 'u').replace(/ph/g, 'f');
/**
 * The text a transcript is matched as, and how. A transcript in English
 * letters is matched exactly as before Fixes-2m (so every stored score stays
 * what it was); one with Kannada script is spelled out and matched loosely.
 */
function prepared(transcript) {
  const raw = String(transcript || '');
  if (!/[\u0C80-\u0CFF]/.test(raw)) return { t: ` ${norm(raw)} `, f: (w) => norm(w) };
  return { t: ` ${loose(norm(kannadaToLatin(raw)))} `, f: (w) => loose(norm(w)) };
}

/** Share of a phrase's key words heard in a transcript (0..1), or null for free phrases. */
function score(phraseId, transcript) {
  const p = PHRASES.find(x => x.id === phraseId);
  if (!p || !p.keys.length) return null;
  const { t, f } = prepared(transcript);
  if (!t.trim()) return 0;
  const hit = p.keys.filter(k => k.split('|').some(v => {
    const w = f(v);
    return /^\d+$/.test(w) ? new RegExp(`(^|[^0-9])${w}([^0-9]|$)`).test(t) : t.includes(w);
  }));
  return Math.round((hit.length / p.keys.length) * 100) / 100;
}

const PROMPT = `Transcribe this voice note exactly as spoken.
The speaker is in Karnataka, logging food, water, sleep, weight or exercise in
Kannada mixed with English. Write Kannada words in ENGLISH LETTERS as they
sound (eradu, mooru, idli, ragi mudde, saaru, palya, mosaru, majjige, neeru,
gante, nidde, tooka). Do not translate them into English. Do not use Kannada
script. Write numbers the way they were said (eradu stays eradu, 2 stays 2).
Return ONLY the transcript text. If there is no speech, return an empty string.`;
const WHISPER_PROMPT = 'Kannada-English food log in English letters: eradu idli, ragi mudde, soppina saaru, mosaru, majjige, mooru litre neeru, elu gante nidde.';

async function gemini(audio, mimeType, env = process.env) {
  if (!env.GEMINI_API_KEY) return null;
  const model = env.GEMINI_FALLBACK_MODEL || 'gemini-2.5-flash';
  const r = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`, {
    contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType, data: audio } }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 400 },
  }, { headers: { 'content-type': 'application/json' }, timeout: 30000 });
  return String((r.data.candidates?.[0]?.content?.parts || []).map(p => p.text).join('') || '').trim().slice(0, 1000);
}
// Fixes-2m: Whisper is told the language. Left to guess, it took the first
// real Kannada recording (19 Oct) for Tamil and wrote Tamil script. 'kn' is the
// pilot's language; VOICE_PILOT_WHISPER_LANGUAGE can change it ('auto' = guess,
// as before). verbose_json returns the language Whisper used, which is stored.
const whisperLanguage = (env = process.env) => {
  const v = String(env.VOICE_PILOT_WHISPER_LANGUAGE || 'kn').trim().toLowerCase();
  return /^[a-z]{2}$/.test(v) ? v : 'auto';
};
async function whisper(audio, mimeType, env = process.env, language = whisperLanguage(env)) {
  if (!env.GROQ_API_KEY) return null;
  const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from(audio, 'base64')], { type: mimeType }), `sample.${ext}`);
  fd.append('model', 'whisper-large-v3');
  fd.append('temperature', '0');
  fd.append('response_format', 'verbose_json');
  if (language && language !== 'auto') fd.append('language', language);
  fd.append('prompt', WHISPER_PROMPT);
  const r = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', fd,
    { headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` }, timeout: 30000 });
  const text = String(r.data?.text || '').trim().slice(0, 1000);
  // The language Whisper reports using ("kannada", "tamil", "kn"…), as given; the setting it was asked for.
  // Fixes-2u: Whisper's own section numbers travel too (evidence only; the pilot never refuses an answer).
  const segments = Array.isArray(r.data?.segments) ? r.data.segments.slice(0, 50).map(x => ({ start: x?.start ?? null, end: x?.end ?? null,
    avg_logprob: x?.avg_logprob ?? null, no_speech_prob: x?.no_speech_prob ?? null, compression_ratio: x?.compression_ratio ?? null })) : null;
  return { text, language: r.data?.language ? String(r.data.language).slice(0, 20) : null, setting: language || 'auto', segments };
}

/**
 * Why an engine gave nothing, in a few words, safe to store and show: the HTTP
 * status and the provider's own message. Never the request (it carries the key).
 */
function reason(err) {
  const status = err?.response?.status || err?.code || 'error';
  const msg = err?.response?.data?.error?.message || err?.response?.data?.error || err?.message || '';
  return `${status}: ${String(typeof msg === 'string' ? msg : JSON.stringify(msg))}`
    .replace(/key=[^&\s"']+/gi, 'key=…').replace(/Bearer\s+\S+/gi, 'Bearer …')
    .replace(/\s+/g, ' ').trim().slice(0, 160);
}
/** Worth one more try: no reply at all, a timeout, "slow down" (429) or the provider's own fault (5xx). */
const passing = (err) => { const st = err?.response?.status; return !st || st === 429 || st >= 500; };
const RETRY_MS = () => Number(process.env.VOICE_PILOT_RETRY_MS ?? 800);

async function once(name, keyName, fn, audio, mimeType) {
  if (!process.env[keyName]) return { text: null, error: `${keyName} is not set` };
  const wrap = (v) => (v && typeof v === 'object' ? { text: v.text, language: v.language ?? null, setting: v.setting ?? null, segments: v.segments ?? null, error: null } : { text: v, error: null });
  try { return wrap(await fn(audio, mimeType)); }
  catch (e1) {
    if (passing(e1)) {
      await new Promise(r => setTimeout(r, RETRY_MS()));
      try { return wrap(await fn(audio, mimeType)); }
      catch (e2) { console.error(`voice pilot: ${name} gave no answer (after a retry):`, reason(e2)); return { text: null, error: reason(e2) }; }
    }
    console.error(`voice pilot: ${name} gave no answer:`, reason(e1));
    return { text: null, error: reason(e1) };
  }
}

/**
 * Both engines, side by side. A failed engine gives null and never stops the
 * other; `errors` says why (stored with the recording, shown to the coach and
 * in the downloaded file), because "no answer" with no reason cannot be fixed.
 */
async function transcribeBoth(audio, mimeType) {
  const [g, w] = await Promise.all([
    once('gemini', 'GEMINI_API_KEY', gemini, audio, mimeType),
    once('whisper', 'GROQ_API_KEY', whisper, audio, mimeType),
  ]);
  return { gemini: g.text, whisper: w.text, errors: { gemini: g.error, whisper: w.error },
           whisper_language: w.language ?? null, whisper_setting: w.text != null ? (w.setting ?? null) : null };
}

/** One engine only, for trying a stored recording again. engine: 'gemini' | 'whisper'. */
async function transcribeOne(engine, audio, mimeType, { language } = {}) {
  if (engine === 'gemini') return once('gemini', 'GEMINI_API_KEY', gemini, audio, mimeType);
  if (engine === 'whisper') return once('whisper', 'GROQ_API_KEY', (a, m) => whisper(a, m, process.env, language || whisperLanguage()), audio, mimeType);
  return { text: null, error: 'unknown engine' };
}

/**
 * Pilot results, per phrase: how often each engine heard the key words.
 * rows: voice_samples rows. Pure.
 *
 * A recording an engine gave NO answer for counts as 0, not as missing. The
 * first version left those out of the average, and the first real run read
 * "Gemini 80% · Whisper 69%" when Gemini had answered only 5 of 7 recordings:
 * counted honestly it was 57%. An engine that does not answer has not
 * understood the member. `*_answered` says how many it did answer.
 * An engine with no answers at all (its key is not set) has no score: null.
 */
/** Fixes-2u: text with at least one visible character. '' and whitespace are an EMPTY answer, not a transcript. */
const nonBlank = (t) => typeof t === 'string' && /\S/.test(t);
function summarise(rows) {
  const all = rows || [];
  // Fixes-2u: an empty or blank answer is a recognition failure, not an answer: it counts as 0
  // (it stays in the average) and not as "answered". `*_empty` says how many came back empty.
  const did = (r, k) => (`${k}_text` in r ? nonBlank(r[`${k}_text`]) : r[`${k}_score`] != null);
  const empty = (r, k) => `${k}_text` in r && r[`${k}_text`] != null && !nonBlank(r[`${k}_text`]);
  const pct = (list, k) => {
    if (!list.length || !list.some(r => did(r, k))) return null;
    return Math.round((list.reduce((x, r) => x + (did(r, k) ? Number(r[`${k}_score`]) || 0 : 0), 0) / list.length) * 100);
  };
  const phrases = PHRASES.map(p => {
    const mine = all.filter(r => r.phrase_id === p.id);
    return { id: p.id, say: p.say, means: p.means, free: !!p.free, samples: mine.length,
      gemini: p.free ? null : pct(mine, 'gemini'), whisper: p.free ? null : pct(mine, 'whisper'),
      gemini_answered: mine.filter(r => did(r, 'gemini')).length, whisper_answered: mine.filter(r => did(r, 'whisper')).length,
      gemini_empty: mine.filter(r => empty(r, 'gemini')).length, whisper_empty: mine.filter(r => empty(r, 'whisper')).length };
  });
  const free = new Set(PHRASES.filter(p => p.free).map(p => p.id));
  const scored = all.filter(r => !free.has(r.phrase_id) && PHRASES.some(p => p.id === r.phrase_id));
  return { phrases, overall: { gemini: pct(scored, 'gemini'), whisper: pct(scored, 'whisper'), samples: all.length, scored: scored.length,
    gemini_answered: all.filter(r => did(r, 'gemini')).length, whisper_answered: all.filter(r => did(r, 'whisper')).length,
    gemini_empty: all.filter(r => empty(r, 'gemini')).length, whisper_empty: all.filter(r => empty(r, 'whisper')).length } };
}

/**
 * The pilot results as rows for a file to send on. One row per recording.
 * Members appear as codes (M1, M2…), never by name; the codes are the same in
 * every download (ordered by member id). Audio is not included.
 *
 * Fixes-2m: the scores are named for what they are, KEYWORD scores; the
 * rule checks (Fixes-2n name; limited checks, not a guarantee of meaning), the script each engine wrote in and the language Whisper
 * used are added at the end (the original columns keep their order).
 */
const HEAD = ['member', 'line_id', 'line', 'meaning', 'own_words', 'gemini_heard', 'whisper_heard', 'gemini_keyword_score', 'whisper_keyword_score', 'seconds', 'audio_type', 'recorded_at', 'gemini_problem', 'whisper_problem',
  'gemini_rule_checks', 'whisper_rule_checks', 'gemini_script', 'whisper_script', 'whisper_language_asked', 'whisper_language_used'];
function resultRows(rows) {
  const ids = [...new Set((rows || []).map(r => r.patient_id))].sort((a, b) => a - b);
  const code = new Map(ids.map((id, i) => [id, `M${i + 1}`]));
  const audio = (m) => (/mp4|m4a|aac/.test(m || '') ? 'mp4 (usually iPhone)' : /webm|ogg/.test(m || '') ? 'webm (usually Android)' : (m || ''));
  // A scored line an engine did not answer is a miss (0%), the same as in the panel.
  const sc = (r, k, isFree) => (isFree ? '' : r[`${k}_text`] == null ? 'no answer' : !nonBlank(r[`${k}_text`]) ? '0% (empty answer)' : Math.round((Number(r[`${k}_score`]) || 0) * 100) + '%');
  const scr = (t) => (t == null ? '' : SCRIPT_LABEL[scriptOf(t)] || '');
  const byPhrase = new Map(PHRASES.map((p, i) => [p.id, { p, i }]));
  const sorted = [...(rows || [])].sort((a, b) => (byPhrase.get(a.phrase_id)?.i ?? 99) - (byPhrase.get(b.phrase_id)?.i ?? 99) || code.get(a.patient_id).localeCompare(code.get(b.patient_id), undefined, { numeric: true }));
  return sorted.map(r => {
    const p = byPhrase.get(r.phrase_id)?.p;
    return [code.get(r.patient_id), r.phrase_id, p?.say || '', p?.means || '', p?.free ? 'yes' : 'no',
      r.gemini_text, r.whisper_text,
      sc(r, 'gemini', !!p?.free), sc(r, 'whisper', !!p?.free),
      r.duration_ms ? (Number(r.duration_ms) / 1000).toFixed(1) : '', audio(r.mime_type),
      r.created_at ? new Date(r.created_at).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '',
      r.gemini_text == null ? (r.gemini_error || 'no answer') : !nonBlank(r.gemini_text) ? 'empty answer' : '',
      r.whisper_text == null ? (r.whisper_error || 'no answer') : !nonBlank(r.whisper_text) ? 'empty answer' : '',
      checksText(meaningChecks(r.phrase_id, r.gemini_text)), checksText(meaningChecks(r.phrase_id, r.whisper_text)),
      scr(r.gemini_text), scr(r.whisper_text),
      // Recordings from before 20 Oct 2026 were sent with no language (Whisper guessed).
      r.whisper_text == null ? '' : (r.whisper_setting || 'not set (Whisper guessed)'), r.whisper_language || (r.whisper_text == null ? '' : 'not recorded')];
  });
}

/** The same rows as a CSV file. Cells a spreadsheet would run as a formula (= + - @) are made plain text. */
function resultsCsv(rows) {
  const cell = (v) => {
    let t = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const lines = [HEAD.join(','), ...resultRows(rows).map(r => r.map(cell).join(','))];
  // Excel opens UTF-8 correctly only with the byte-order mark. (Some spreadsheet
  // programs still ignore it: the 19 Oct file came back as Windows-1252 text.
  // results.xlsx has no such step, so it is the file to open.)
  return '\ufeff' + lines.join('\r\n') + '\r\n';
}

/**
 * Rule checks per engine (passed / unverified / total), over the recordings given.
 * Evaluation only: too few recordings say nothing about which engine to use.
 */
function checksSummary(rows) {
  const out = {};
  for (const k of ['gemini', 'whisper']) {
    const by = {};
    for (const r of rows || []) {
      if (r[`${k}_text`] == null) continue;
      for (const c of meaningChecks(r.phrase_id, r[`${k}_text`])) {
        by[c.kind] = by[c.kind] || { passed: 0, unverified: 0, total: 0 };
        by[c.kind].total++; if (c.result === 'pass') by[c.kind].passed++; else if (c.result === 'unverified') by[c.kind].unverified++;
      }
    }
    out[k] = by;
  }
  return out;
}

module.exports = { PHRASES, CHECKS, score, transcribeBoth, transcribeOne, summarise, nonBlank, resultsCsv, resultRows, HEAD, reason, PROMPT, WHISPER_PROMPT, norm,
  scriptOf, SCRIPT_LABEL, kannadaToLatin, meaningChecks, checksText, checksSummary, whisperLanguage };
