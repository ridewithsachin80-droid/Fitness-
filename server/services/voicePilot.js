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

/** Both engines, side by side. A failed engine gives null, never stops the other. */
async function transcribeBoth(audio, mimeType) {
  const [g, w] = await Promise.allSettled([gemini(audio, mimeType), whisper(audio, mimeType)]);
  return { gemini: g.status === 'fulfilled' ? g.value : null, whisper: w.status === 'fulfilled' ? w.value : null };
}

/**
 * Pilot results, per phrase: how often each engine heard the key words.
 * rows: voice_samples rows. Pure.
 */
function summarise(rows) {
  const by = new Map(PHRASES.map(p => [p.id, { ...p, samples: 0, gemini: [], whisper: [] }]));
  for (const r of rows || []) {
    const p = by.get(r.phrase_id); if (!p) continue;
    p.samples++;
    if (r.gemini_score != null) p.gemini.push(Number(r.gemini_score));
    if (r.whisper_score != null) p.whisper.push(Number(r.whisper_score));
  }
  const avg = (a) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 100) : null);
  const phrases = [...by.values()].map(p => ({ id: p.id, say: p.say, means: p.means, free: !!p.free, samples: p.samples, gemini: avg(p.gemini), whisper: avg(p.whisper) }));
  const all = (k) => avg((rows || []).map(r => r[`${k}_score`]).filter(v => v != null).map(Number));
  return { phrases, overall: { gemini: all('gemini'), whisper: all('whisper'), samples: (rows || []).length } };
}

module.exports = { PHRASES, score, transcribeBoth, summarise, PROMPT, WHISPER_PROMPT, norm };
