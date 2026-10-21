/**
 * scripts/sim/voice-evidence-providers.cjs — SIMULATION ONLY (Fixes-2s).
 *
 * Loaded with `node -r` by test-voice-evidence-sim.mjs to run the real server
 * on this computer with CANNED stand-ins for Gemini, Whisper, Groq chat and R2
 * storage, so the voice evidence robot can be exercised end to end without any
 * provider. The app never loads this file. Nothing it returns is evidence.
 *
 * Switches (environment): SIM_AUDIO_FILE (the stored "recording"),
 * SIM_WRONG_PREVIEW=1 (the parse adds roti and dal to every preview),
 * SIM_FAIL_SWITCH_OFF=1 (turning the voice backup switch off fails),
 * SIM_TAMPER_ORIGINALS=1 (a re-run also changes an original answer),
 * SIM_EXTRA_WATER=1 (every parse also adds 1000 ml of water nobody said),
 * SIM_PARSE_FAIL_WEIGHT=1 (the parse fails for any message with "82.5": no preview appears).
 */
const path = require('path'), http = require('http'), fs = require('fs');
const SRV = path.join(__dirname, '../..');
const need = (m) => require(require.resolve(m, { paths: [SRV] }));

// Local Postgres has no TLS; production mode would demand it.
const pg = need('pg'); const P0 = pg.Pool;
pg.Pool = class extends P0 {
  constructor(o = {}) { super({ ...o, ssl: false }); }
  async query(sql, args) {
    const text = typeof sql === 'string' ? sql : sql?.text || '';
    if (process.env.SIM_FAIL_SWITCH_OFF === '1' && /^\s*DELETE FROM voice_fallback_test_account/i.test(text)) throw new Error('simulated failure turning the switch off');
    const out = await super.query(sql, args);
    if (process.env.SIM_TAMPER_ORIGINALS === '1' && /INSERT INTO voice_sample_reruns/i.test(text)) await super.query(`UPDATE voice_samples SET whisper_score = 0.99 WHERE phrase_id = 'k01'`);
    return out;
  }
};

// Storage: every recording is the one sound file.
const audio = fs.readFileSync(process.env.SIM_AUDIO_FILE);
const audioServer = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'audio/webm' }); r.end(audio); }).listen(0, '127.0.0.1');
const storage = require(path.join(SRV, 'services/storage'));
storage.photoUrl = (k) => `http://127.0.0.1:${audioServer.address().port}/${encodeURIComponent(k)}`;
storage.getObject = async () => audio;

// Providers.
const axios = need('axios');
const seg = (text, lp, ns, cr = 1.1) => ({ start: 0, end: 3, text, avg_logprob: lp, no_speech_prob: ns, compression_ratio: cr });
const food = (name, qty_text, grams) => ({ name, qty_text, grams, meal: 'Breakfast', category: 'veg', per_100g: { calories: 130, protein: 4, total_carbs: 25, fat: 2 } });
axios.post = async (url, body) => {
  if (String(url).startsWith('https://generativelanguage.googleapis.com/')) { const e = new Error('simulated Gemini outage'); e.response = { status: 503, data: { error: { message: 'simulated' } } }; throw e; }
  if (url === 'https://api.groq.com/openai/v1/audio/transcriptions') {
    const lang = body.get('language'), size = body.get('file')?.size || 0;
    if (size < 12000) return { data: { text: ' Thank you.', language: 'english', segments: [seg(' Thank you.', -0.9, 0.95, 0.8)] } };
    if (lang === 'kn') return { data: { text: 'ಎರಡು ಇಡ್ಲಿ ಒಂದು ಬೌಲ್ ಸಾಂಬಾರ್', language: 'kannada', segments: [seg('ಎರಡು ಇಡ್ಲಿ ಒಂದು ಬೌಲ್ ಸಾಂಬಾರ್', -0.3, 0.02)] } };
    if (lang === 'hi') return { data: { text: 'दो रोटी और एक कटोरी दाल खाई', language: 'hindi', segments: [seg('दो रोटी और एक कटोरी दाल खाई', -0.3, 0.02)] } };
    return { data: { text: '2 idli, 1 bowl sambar, weight 82.5 kg', language: 'english', segments: [seg('2 idli, 1 bowl sambar,', -0.2, 0.02), seg(' weight 82.5 kg', -0.3, 0.03)] } };
  }
  if (String(url).includes('api.groq.com/openai/v1/chat/completions')) {
    const prompt = (body?.messages || []).map(m => m.content).join('\n');
    const said = (prompt.match(/Member's message: "([^"]*)"/) || [])[1] || '';
    if (process.env.SIM_PARSE_FAIL_WEIGHT === '1' && /82\.5/.test(said)) { const e = new Error('simulated AI outage'); e.response = { status: 503, data: { error: { message: 'simulated' } } }; throw e; }
    const foods = [];
    if (/idli|ಇಡ್ಲಿ/i.test(said)) foods.push(food('Idli', '2 idli', 100));
    if (/sambar|ಸಾಂಬಾರ್/i.test(said)) foods.push(food('Sambar', '1 bowl', 200));
    if (/roti|रोटी/i.test(said)) foods.push(food('Roti', '2 roti', 80));
    if (/dal|दाल/i.test(said)) foods.push(food('Dal', '1 katori', 150));
    if (process.env.SIM_WRONG_PREVIEW === '1') { if (!foods.some(f => f.name === 'Roti')) foods.push(food('Roti', '2 roti', 80)); if (!foods.some(f => f.name === 'Dal')) foods.push(food('Dal', '1 katori', 150)); }
    return { data: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ weight_kg: /82\.5/.test(said) ? 82.5 : null, activities: [], acv: [], supplements: [], water_ml_add: process.env.SIM_EXTRA_WATER === '1' ? 1000 : null, sleep: null, foods, workouts: [], corrections: [], reply: 'Got it.' }) } }] } };
  }
  throw new Error('simulation: blocked ' + url);
};
