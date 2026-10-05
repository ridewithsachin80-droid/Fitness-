/**
 * scripts/test-safety.js — the member chat's safety replies.
 *
 * Real Postgres and real routes; the AI transport is stubbed and COUNTED, so
 * the suite can prove a safety message never reaches the model.
 *
 * WHAT MUST HOLD
 * --------------
 *   A. Chest pain, self-harm, purging or starving, medicine changes, very low
 *      calories and pregnancy each get their fixed reply, in English, Hinglish
 *      and the common Kannada phrasings below.
 *   B. Ordinary messages that share words with them ("killer workout",
 *      "chest day", "took my thyronorm", "800 kcal left") stay ordinary.
 *   C. A safety message is answered WITHOUT calling the AI, and nothing is
 *      logged from it, in the app chat and in the voice quick-log.
 *   D. "tell my coach I'm pregnant" still reaches the coach path; an urgent
 *      message is answered whoever it is addressed to.
 *   E. The replies carry the right numbers: 112 and 108 for an emergency,
 *      Tele-MANAS 14416 for self-harm, and never a dose or a medicine name.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'stub-key';

const express = require('express'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');
const path = require('path');

const axiosPath = require.resolve('axios', { paths: [path.join(__dirname, '..')] });
require(axiosPath);
const realAxios = require.cache[axiosPath].exports;
let aiCalls = 0;
const stubbedPost = async (url, body, cfg) => {
  if (String(url).includes('generativelanguage') || String(url).includes('groq')) {
    aiCalls += 1;
    const text = JSON.stringify({ reply: 'Logged.', question: null, weight_kg: null, activity_ids: [], acv_ids: [], supplement_ids: [],
      water_ml_add: null, sleep: null, workouts: [], foods: [{ name: 'Idli', grams: 120, meal: 'Breakfast', kcal_100g: 130, protein_100g: 3.5, carbs_100g: 28, fat_100g: 0.8 }] });
    return { data: { candidates: [{ content: { parts: [{ text }] } }], choices: [{ message: { content: text } }] } };
  }
  return realAxios.post(url, body, cfg);
};
require.cache[axiosPath].exports = new Proxy(realAxios, { get: (t, k) => (k === 'post' ? stubbedPost : t[k]) });

const pool = require('../db/pool');
const { checkSafety, REPLIES, KINDS } = require('../services/safety');

const app = express(); app.use(express.json({ limit: '15mb' })); app.use(cookieParser());
app.use('/api/ai-chat', require('../routes/aiChat'));
app.use('/api/quick-log', require('../routes/quickLog'));

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 300))); };

const SHOULD = {
  self_harm: ['I want to kill myself', 'sometimes I think about suicide', 'I keep hurting myself', 'I don\u2019t want to live anymore',
              'what is the point, I want to die', 'marna chahta hoon', 'jeena nahi chahti', 'nanage saayabeku anistide', 'thinking of self-harm again'],
  emergency: ['chest pain after my run', 'my chest feels tight and heavy', 'pain in my chest since morning', 'I fainted in the gym',
              'cannot breathe properly after cardio', 'seene mein dard ho raha hai', 'chhati me dard', 'ede novu ide', 'saans nahi aa rahi'],
  eating:    ['I make myself vomit after dinner', 'took laxatives to lose weight', 'I have been starving myself', 'threw up on purpose after lunch'],
  medicine:  ['should I stop my metformin?', 'can I skip my thyroid tablet today', 'I want to reduce my insulin dose', 'BP tablet band kar du?',
              'how much metformin should I take', 'can I take my medicine after the workout?'],
  low_kcal:  ['I want to eat only 600 kcal a day', 'can I do 800 calories per day to lose fast', 'planning to fast for 3 days',
              'going to skip all my meals today', 'I will eat nothing till Friday', 'khana band karna hai'],
  pregnancy: ["I'm pregnant", 'I am 3 months pregnant, what should I change?', 'main pregnant hoon', 'pregnancy test came positive today',
              "I'm breastfeeding, is this plan ok?", 'nanu garbhini'],
};
const SHOULD_NOT = ['killer workout today', 'chest day today, bench 60 kg 3x10', 'this workout is killing me', 'dying for some biryani',
  'took my thyronorm at 6', 'took metformin with breakfast', '800 kcal left?', 'I had 800 calories today', 'how many calories are left for the day',
  'my sister is pregnant', 'insulin resistance diet tips?', '2 idli and sambar for breakfast', '16 hour fast today', 'stop eating sugar',
  'cut down sugar this week', 'chest and triceps done', 'had chest press 3 sets', 'ate a cut fruit bowl', 'medicine ball slams 3x15',
  'my mother takes metformin', 'heart rate was 150 on the run', 'skipped breakfast today'];

(async () => {
  console.log('\n[0] what is caught, and what is not (no database)');
  for (const [kind, msgs] of Object.entries(SHOULD)) {
    const missed = msgs.filter(m => checkSafety(m)?.kind !== kind);
    ck(`${kind}: all ${msgs.length} phrasings caught`, missed.length === 0, missed.map(m => [m, checkSafety(m)?.kind || null]));
  }
  const wrong = SHOULD_NOT.filter(m => checkSafety(m));
  ck(`all ${SHOULD_NOT.length} ordinary messages stay ordinary`, wrong.length === 0, wrong.map(m => [m, checkSafety(m).kind]));
  ck('an empty message is not a safety message', checkSafety('') === null && checkSafety(null) === null);
  ck('the most urgent kind wins: chest pain AND medicine -> emergency', checkSafety('chest pain, should I take my BP tablet?')?.kind === 'emergency');
  ck('self-harm outranks everything', checkSafety('chest pain and I want to die')?.kind === 'self_harm');

  console.log('\n[1] messages for the coach');
  ck('"tell my coach I\'m pregnant" is NOT intercepted', checkSafety("tell my coach I'm pregnant") === null);
  ck('"ask my coach if I can stop my metformin" is NOT intercepted', checkSafety('ask my coach if I can stop my metformin') === null);
  ck('"coach ko bolo main pregnant hoon" is NOT intercepted', checkSafety('coach ko bolo main pregnant hoon') === null);
  ck('but "tell my coach I have chest pain" IS: an emergency is answered first', checkSafety('tell my coach I have chest pain')?.kind === 'emergency');
  ck('and "tell my coach I want to kill myself" IS', checkSafety('tell my coach I want to kill myself')?.kind === 'self_harm');

  console.log('\n[2] the replies');
  ck('every kind has a reply', KINDS.length === 6 && KINDS.every(k => typeof REPLIES[k] === 'string' && REPLIES[k].length > 80), KINDS);
  ck('emergency: 112 and 108, and says nothing was logged', /\b112\b/.test(REPLIES.emergency) && /\b108\b/.test(REPLIES.emergency) && /Nothing was logged/.test(REPLIES.emergency));
  ck('self-harm: Tele-MANAS 14416 and 1-800-891-4416, and 112', /Tele-MANAS/.test(REPLIES.self_harm) && /14416/.test(REPLIES.self_harm) && /1-800-891-4416/.test(REPLIES.self_harm) && /\b112\b/.test(REPLIES.self_harm));
  ck('self-harm makes no promise about confidentiality', !/confidential|anonymous|no one will know/i.test(REPLIES.self_harm));
  ck('eating: points to a doctor and Tele-MANAS', /doctor/.test(REPLIES.eating) && /14416/.test(REPLIES.eating));
  ck('no reply names a medicine or a dose', !Object.values(REPLIES).some(r => /\b\d+\s?(?:mg|mcg|iu|units?)\b|metformin|insulin|thyronorm|thyroxine/i.test(r)));
  ck('medicine: the doctor decides; keep taking it as prescribed', /need your doctor/.test(REPLIES.medicine) && /as prescribed/.test(REPLIES.medicine));
  ck('medicine, low-calorie and pregnancy replies say how to tell the coach', ['medicine', 'low_kcal', 'pregnancy'].every(k => /tell my coach/.test(REPLIES[k])));

  // ── Over HTTP ───────────────────────────────────────────────────────────────
  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  const member = (await pool.query(`INSERT INTO users (name,phone,password,role,active) VALUES ('Padmini','9001','x','patient',true) RETURNING id`)).rows[0].id;
  await pool.query(`INSERT INTO patient_profiles (user_id) VALUES ($1)`, [member]);
  const M = jwt.sign({ id: member, role: 'patient', name: 'Padmini' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const srv = app.listen(0); const port = srv.address().port;
  const post = async (p, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + M }, body: JSON.stringify(body) });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
  const logRows = async () => Number((await pool.query(`SELECT COUNT(*) AS n FROM daily_logs WHERE patient_id=$1`, [member])).rows[0].n);

  console.log('\n[3] the app chat');
  {
    const before = aiCalls;
    let r = await post('/api/ai-chat/parse', { message: 'chest pain after 2 idli, feeling dizzy', context: {} });
    ck('chest pain: the fixed emergency reply', r.status === 200 && r.data.reply === REPLIES.emergency && r.data.safety === 'emergency', r.data);
    ck('shown as an answer (question: true), with nothing to log', r.data.question === true && r.data.foods.length === 0 && r.data.weight_kg === null && r.data.water_ml_add === null);
    ck('and the AI was never called', aiCalls === before, aiCalls - before);
    r = await post('/api/ai-chat/parse', { message: 'marna chahta hoon', context: {} });
    ck('self-harm in Hinglish: the Tele-MANAS reply, no AI call', r.data.safety === 'self_harm' && /14416/.test(r.data.reply) && aiCalls === before);
    r = await post('/api/ai-chat/parse', { message: 'should I stop my metformin?', context: {} });
    ck('a medicine question: the doctor reply, no AI call', r.data.safety === 'medicine' && aiCalls === before);

    r = await post('/api/ai-chat/parse', { message: '2 idli and sambar for breakfast', context: {} });
    ck('an ordinary message still goes to the AI and is parsed', aiCalls === before + 1 && !r.data.safety && r.data.foods?.length === 1, r.data);
    r = await post('/api/ai-chat/parse', { message: "tell my coach I'm pregnant", context: {} });
    ck('"tell my coach I\'m pregnant" goes on to the AI (and its coach path), not the fixed reply', aiCalls === before + 2 && !r.data.safety, r.data);
  }

  console.log('\n[4] the voice quick-log');
  {
    const before = aiCalls, rows = await logRows();
    const r = await post('/api/quick-log', { text: 'I have chest pain, also had 2 idli', source: 'voice' });
    ck('it speaks the emergency reply as written', r.status === 200 && r.data.reply === REPLIES.emergency, r.data);
    ck('nothing was applied to the day, and the AI was not called', (await logRows()) === rows && aiCalls === before, [await logRows(), rows, aiCalls - before]);
    const turn = (await pool.query(`SELECT outcome FROM quick_log_turns WHERE patient_id=$1 ORDER BY id DESC LIMIT 1`, [member])).rows[0];
    ck('the turn is recorded with outcome "safety"', turn?.outcome === 'safety', turn);
  }

  console.log(`\n${fail === 0 ? '\u2713' : '\u2717'} test-safety: ${pass} passed, ${fail} failed\n`);
  srv.close(); await pool.end();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error(e); process.exit(1); });
