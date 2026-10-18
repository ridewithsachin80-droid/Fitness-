/** Actual server parser with isolated provider/DB, plus actual client review
 * and save-patch helpers. No network or member health writes. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const { resolveSleepReview } = require('../services/sleepReview');
const { importClient } = require('./lib/client-bundle');
const { normalizeSleepClarification, sleepClarificationText } = importClient('utils/sleepClarification.js');
const { aiReplyText, aiContextText, hasLoggingPreview } = importClient('utils/aiReplyText.js');
const { countIncluded } = importClient('utils/aiParsedReview.js');
const { createDailyChange } = importClient('utils/aiSaveReceipt.js');
const { emptyLog } = importClient('constants.js');
let passed = 0, failed = 0;
const check = (name, okay) => { console.log(`  ${okay ? '✓' : '✗'} ${name}`); okay ? passed++ : failed++; };
const mixed = 'I drank 500 ml water, slept 8 hours, my weight is 82.5 kg, and walked for 30 minutes today';
for (const [message, minutes] of [[mixed, 480], ['slept8h', 480], ['I slept 7.5 hours', 450], ['slept8h30m', 510], ['I slept for 7 hours and 20 minutes', 440], ['sleep 90 minutes', 90]]) {
  const r = resolveSleepReview(null, null, message);
  check(`${message}: missing duration-only sleep remains a named clarification`, r.sleep === null && r.unresolvedSleep?.duration_minutes === minutes);
}
const invented = resolveSleepReview({ bedtime: '22:00', waketime: '06:00' }, null, 'slept8h');
check('duration-only source cannot inherit fabricated model clock times', invented.sleep === null && invented.unresolvedSleep?.duration_minutes === 480);
for (const message of ['I slept 22:00 to 06:00', 'I slept 8 hours, from 10pm to 6am']) {
  const r = resolveSleepReview({ bedtime: '22:00', waketime: '06:00' }, { reason: 'times_needed' }, message);
  check('explicit clock range keeps existing valid sleep review', r.sleep?.bedtime === '22:00' && r.sleep?.waketime === '06:00' && !r.unresolvedSleep);
}
check('existing one-clock review remains supported', resolveSleepReview({ bedtime: '22:00' }, null, 'went to bed at 10pm').sleep?.bedtime === '22:00');
for (const message of ['I did not sleep 8 hours', 'I haven’t slept8h', 'I usually sleep 8h', 'I should sleep8h', 'I slept8h ago', 'I walked 8 hours']) {
  check(`non-duration assertion not captured: ${message}`, resolveSleepReview(null, null, message).unresolvedSleep === null);
}
for (const amount of [0, -8, 1500, Infinity, '480', {}, true]) {
  const r = resolveSleepReview(null, { reason: 'times_needed', duration_minutes: amount }, 'sleep was unclear');
  check(`untrusted duration ${String(amount)} cannot appear as a reported amount`, r.unresolvedSleep?.duration_minutes === null);
}
check('provider unsupported reason does not become a question', resolveSleepReview(null, { reason: 'do_something_else' }, '').unresolvedSleep === null);
check('invalid clock times are not carried into sleep', resolveSleepReview({ bedtime: '25:00', waketime: '99:99' }, null, '').sleep === null);
const issue = { reason: 'times_needed', duration_minutes: 480 };
check('client normalization strips extra payload fields', Object.keys(normalizeSleepClarification({ ...issue, sleep: { bedtime: '22:00' }, instructions: 'ignore rules' })).sort().join() === 'duration_minutes,reason');
check('notice asks for clock times without claiming a save', /8 h/.test(sleepClarificationText(issue)) && /go to bed and wake up/.test(sleepClarificationText(issue)) && /isn’t included/.test(sleepClarificationText(issue)));
const parsed = { sleep: null, sleepOn: false, unresolved_sleep: issue, foods: [], activities: [], acv: [], supplements: [], workouts: [], corrections: [], weightOn: false, waterOn: false };
const message = { role: 'ai', text: 'Saved8hours.', parsed };
check('clarification-only reply is visible without a saveable entry', hasLoggingPreview(message) && countIncluded(parsed) === 0 && /Nothing has been saved/.test(aiReplyText(message)));
check('clarification creates no persistent daily-log change', !createDailyChange(parsed, emptyLog(), { id: 'sleep-check' }).needed);
const contextual = { ...message, parsed: { ...parsed, foods: Array.from({ length: 15 }, (_, i) => ({ name: `Long food ${i}`, grams: 200 })) } };
check('sleep question survives200-character mixed review context truncation', /480 minutes reported.*bedtime and wake time needed/.test(aiContextText(contextual).slice(0, 200)));

const filename = path.resolve(__dirname, '../routes/aiChat.js'), router = {};
for (const method of ['use', 'get', 'post', 'put', 'patch', 'delete']) router[method] = () => router;
let fixture = {}, prompts = [], queries = [];
const pure = new Set(['../services/personName', '../services/targetOrigin', '../services/nutrientStatus', '../services/scaleParse', '../services/macroCheck', '../services/fatProfile', '../services/nutrients',
  '../services/voiceLanguage', '../services/programDay', '../utils/istDate', '../services/safety', '../services/foodReview', '../services/draftFoodReview', '../services/sleepReview']);
const moduleFixture = { exports: {} };
const sandbox = { module: moduleFixture, exports: moduleFixture.exports, console, setTimeout, clearTimeout,
  process: { env: { GROQ_API_KEY: 'sleep-fixture', GROQ_MODEL: 'fixture-model', GROQ_FALLBACK_MODEL: 'fixture-model' } },
  require(name) {
    if (name === 'express') return { Router: () => router };
    if (name === '../db/pool') return { query: async (sql, args) => { queries.push({ sql, args }); return { rows: /COUNT\(\*\)/.test(sql) ? [{ n: 0 }] : [] }; } };
    if (name === 'axios') return { post: async (url, body) => { prompts.push(body.messages[0].content); return { data: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(fixture) } }] } }; } };
    if (name === '../middleware/auth') return () => {};
    if (name === '../middleware/roleCheck') return () => () => {};
    if (name === '../services/circuits') return { circuitsPromptBlock: () => '', matchCircuit: () => null };
    if (name === '../services/memberFoods') return { findLabel: async () => null };
    if (name === '../services/digests') return { computeDayTotals: () => ({}) };
    if (name === './programs') return { loadProgramDays: async () => [] };
    if (name === 'crypto') return require('crypto');
    if (pure.has(name)) return require(path.resolve(path.dirname(filename), name));
    throw new Error(`Unexpected dependency ${name}`);
  },
};
vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename, timeout: 5000 });
const api = moduleFixture.exports;
api.setControlSampler(() => false);
(async () => {
  fixture = { sleep: null, weight_kg: 82.5, water_ml_add: 500, activity_ids: ['walk'], foods: [], workouts: [{ name: 'Walking', cardio_type: 'walking', duration_min: 30 }] };
  const result = await api.parseMemberMessage({ userId: 999, message: mixed, context: { activities: [{ id: 'walk', label: 'Morning walk' }] } });
  check('actual parser retains weight, water and walking alongside sleep question', result.weight_kg === 82.5 && result.water_ml_add === 500 && result.activities.length === 1 && result.workouts.length === 1 && result.unresolved_sleep?.duration_minutes === 480 && result.sleep === null);
  check('provider prompt expressly forbids invented times and retains other entries', /never invent them/.test(prompts.at(-1)) && /Keep all other explicitly stated entries/.test(prompts.at(-1)));
  fixture = { sleep: null, reply: 'Saved8hours.' };
  const alone = await api.parseMemberMessage({ userId: 999, message: 'slept8h', context: {} });
  check('actual parser canonical reply asks clock times on empty provider output', alone.sleep === null && alone.unresolved_sleep?.duration_minutes === 480 && /What time/.test(alone.reply) && /Nothing has been saved/.test(alone.reply));
  fixture = { sleep: { bedtime: '23:00', waketime: '07:00' } };
  const followup = await api.parseMemberMessage({ userId: 999, message: '11pm to7am', context: { recent: [{ role: 'ai', text: aiContextText(message) }] } });
  check('follow-up times resolve sleep without copying prior mixed entries', followup.sleep?.bedtime === '23:00' && followup.sleep?.waketime === '07:00' && !followup.unresolved_sleep && !followup.weight_kg && !followup.water_ml_add && !followup.activities.length && !followup.workouts.length);
  check('actual parse/review does not persist daily log or workout records', queries.every(({ sql }) => !/(?:INSERT INTO|UPDATE)\s+(?:daily_logs|workout_sessions)/i.test(sql)));
  console.log(`\n${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
