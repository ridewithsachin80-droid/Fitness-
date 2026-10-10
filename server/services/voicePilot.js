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

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9.\u0C80-\u0CFF ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Share of a phrase's key words heard in a transcript (0..1), or null for free phrases. */
function score(phraseId, transcript) {
  const p = PHRASES.find(x => x.id === phraseId);
  if (!p || !p.keys.length) return null;
  const t = ` ${norm(transcript)} `;
  if (!t.trim()) return 0;
  const hit = p.keys.filter(k => k.split('|').some(v => {
    const w = norm(v);
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
async function whisper(audio, mimeType, env = process.env) {
  if (!env.GROQ_API_KEY) return null;
  const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from(audio, 'base64')], { type: mimeType }), `sample.${ext}`);
  fd.append('model', 'whisper-large-v3');
  fd.append('temperature', '0');
  fd.append('response_format', 'json');
  fd.append('prompt', WHISPER_PROMPT);
  const r = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', fd,
    { headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` }, timeout: 30000 });
  return String(r.data?.text || '').trim().slice(0, 1000);
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
  try { return { text: await fn(audio, mimeType), error: null }; }
  catch (e1) {
    if (passing(e1)) {
      await new Promise(r => setTimeout(r, RETRY_MS()));
      try { return { text: await fn(audio, mimeType), error: null }; }
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
  return { gemini: g.text, whisper: w.text, errors: { gemini: g.error, whisper: w.error } };
}

/** One engine only, for trying a stored recording again. engine: 'gemini' | 'whisper'. */
async function transcribeOne(engine, audio, mimeType) {
  if (engine === 'gemini') return once('gemini', 'GEMINI_API_KEY', gemini, audio, mimeType);
  if (engine === 'whisper') return once('whisper', 'GROQ_API_KEY', whisper, audio, mimeType);
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
function summarise(rows) {
  const all = rows || [];
  const did = (r, k) => (`${k}_text` in r ? r[`${k}_text`] != null : r[`${k}_score`] != null);
  const pct = (list, k) => {
    if (!list.length || !list.some(r => did(r, k))) return null;
    return Math.round((list.reduce((x, r) => x + (did(r, k) ? Number(r[`${k}_score`]) || 0 : 0), 0) / list.length) * 100);
  };
  const phrases = PHRASES.map(p => {
    const mine = all.filter(r => r.phrase_id === p.id);
    return { id: p.id, say: p.say, means: p.means, free: !!p.free, samples: mine.length,
      gemini: p.free ? null : pct(mine, 'gemini'), whisper: p.free ? null : pct(mine, 'whisper'),
      gemini_answered: mine.filter(r => did(r, 'gemini')).length, whisper_answered: mine.filter(r => did(r, 'whisper')).length };
  });
  const free = new Set(PHRASES.filter(p => p.free).map(p => p.id));
  const scored = all.filter(r => !free.has(r.phrase_id) && PHRASES.some(p => p.id === r.phrase_id));
  return { phrases, overall: { gemini: pct(scored, 'gemini'), whisper: pct(scored, 'whisper'), samples: all.length, scored: scored.length,
    gemini_answered: all.filter(r => did(r, 'gemini')).length, whisper_answered: all.filter(r => did(r, 'whisper')).length } };
}

/**
 * The pilot results as a CSV file for Sachin to send on. One row per
 * recording. Members appear as codes (M1, M2…), never by name; the codes are
 * the same in every download (ordered by member id). Audio is not included.
 * Cells that a spreadsheet would run as a formula (= + - @) are made plain text.
 */
function resultsCsv(rows, { now = new Date() } = {}) {
  const ids = [...new Set((rows || []).map(r => r.patient_id))].sort((a, b) => a - b);
  const code = new Map(ids.map((id, i) => [id, `M${i + 1}`]));
  const cell = (v) => {
    let t = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const audio = (m) => (/mp4|m4a|aac/.test(m || '') ? 'mp4 (usually iPhone)' : /webm|ogg/.test(m || '') ? 'webm (usually Android)' : (m || ''));
  const head = ['member', 'line_id', 'line', 'meaning', 'own_words', 'gemini_heard', 'whisper_heard', 'gemini_score', 'whisper_score', 'seconds', 'audio_type', 'recorded_at', 'gemini_problem', 'whisper_problem'];
  // A scored line an engine did not answer is a miss (0%), the same as in the panel.
  const sc = (r, k, isFree) => (isFree ? '' : r[`${k}_text`] == null ? 'no answer' : Math.round((Number(r[`${k}_score`]) || 0) * 100) + '%');
  const lines = [head.join(',')];
  const byPhrase = new Map(PHRASES.map((p, i) => [p.id, { p, i }]));
  const sorted = [...(rows || [])].sort((a, b) => (byPhrase.get(a.phrase_id)?.i ?? 99) - (byPhrase.get(b.phrase_id)?.i ?? 99) || code.get(a.patient_id).localeCompare(code.get(b.patient_id), undefined, { numeric: true }));
  for (const r of sorted) {
    const p = byPhrase.get(r.phrase_id)?.p;
    lines.push([code.get(r.patient_id), r.phrase_id, p?.say || '', p?.means || '', p?.free ? 'yes' : 'no',
      r.gemini_text, r.whisper_text,
      sc(r, 'gemini', !!p?.free), sc(r, 'whisper', !!p?.free),
      r.duration_ms ? (Number(r.duration_ms) / 1000).toFixed(1) : '', audio(r.mime_type),
      r.created_at ? new Date(r.created_at).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '',
      r.gemini_text == null ? (r.gemini_error || 'no answer') : '', r.whisper_text == null ? (r.whisper_error || 'no answer') : ''].map(cell).join(','));
  }
  // Excel opens UTF-8 correctly only with the byte-order mark.
  return '\ufeff' + lines.join('\r\n') + '\r\n';
}

module.exports = { PHRASES, score, transcribeBoth, transcribeOne, summarise, resultsCsv, reason, PROMPT, WHISPER_PROMPT, norm };
