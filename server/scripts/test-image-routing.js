#!/usr/bin/env node
/**
 * test-image-routing.js — a member sends an image to the WRONG button.
 *
 * Real case (28 Aug 2026): a photo of a Dr Trust scale reading 76.80 kg was
 * uploaded via the 📄 lab-report button and came back "I couldn't find any
 * numeric results" with a Save 0 results card. The app should recognise what
 * the image is and route it, and ask only when genuinely unsure.
 *
 * Vision is stubbed (we are testing routing, not Gemini). Pool is stubbed —
 * neither endpoint touches SQL on these paths.
 */
'use strict';
const path = require('path');
const http = require('http');
process.env.JWT_SECRET = 'smoke-test-secret';
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'stub-key';
process.env.DATABASE_URL = 'postgres://stub:stub@127.0.0.1:1/stub';

const SERVER = path.resolve(__dirname, '..');
const poolPath = require.resolve(path.join(SERVER, 'db/pool.js'));
const stubPool = {
  query: async () => ({ rows: [], rowCount: 0 }),
  connect: async () => ({ query: async () => ({ rows: [] }), release() {} }),
  on() {}, end: async () => {},
};
require.cache[poolPath] = { id: poolPath, filename: poolPath, loaded: true, exports: stubPool, children: [], paths: [] };

// ── Stubbed vision. The reply depends on which prompt arrived and whether the
// member forced an override, so the routing logic is what is under test.
const axiosPath = require.resolve('axios', { paths: [SERVER] });
require(axiosPath);
const realAxios = require.cache[axiosPath].exports;
let scenario = 'scale';
const fake = async (url, body) => {
  if (!/generativelanguage/.test(String(url))) throw new Error('unexpected ' + url);
  const prompt = body.contents[0].parts.map(p => p.text || '').join('');
  const isLabReader = /lab report" button/.test(prompt);
  const forced = /CONFIRMED this is a lab report/.test(prompt);
  let out;
  if (isLabReader) {
    if (forced) {
      out = { doc_type: 'lab_report', test_date: '2026-08-28', lab_name: 'Dr Trust',
              results: [{ test_name: 'Weight', value: 76.8, unit: 'kg', confidence: 'high' }] };
    } else if (scenario === 'scale') {
      out = { doc_type: 'scale', question: null, results: [] };
    } else if (scenario === 'meal') {
      out = { doc_type: 'meal', question: null, results: [] };
    } else if (scenario === 'unclear') {
      out = { doc_type: 'unclear', question: 'Is this your lab report, or a photo of your meal?', results: [] };
    } else {
      out = { doc_type: 'lab_report', test_date: '2026-08-14', lab_name: 'Metropolis',
              results: [{ test_name: 'HbA1c', value: 5.8, unit: '%', ref_min: 4, ref_max: 5.6, confidence: 'high' }] };
    }
  } else {
    // /photo reader
    out = scenario === 'labviacamera'
      ? { kind: 'lab_report', reply: 'looks like a report', foods: [], body_metrics: [], weight_kg: null }
      : { kind: 'body_scan', reply: 'Got it — 76.8 kg from your scale.',
          foods: [], body_metrics: [{ name: 'Body Fat', value: 26.1, unit: '%' }], weight_kg: 76.8 };
  }
  return { data: { candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] }, finishReason: 'STOP' }] } };
};
const stubAx = (...a) => fake(...a);
stubAx.post = fake; stubAx.get = realAxios.get; stubAx.create = realAxios.create;
stubAx.isAxiosError = realAxios.isAxiosError; stubAx.default = stubAx;
require.cache[axiosPath].exports = stubAx;

const rl = http.Server.prototype.listen;
http.Server.prototype.listen = function (...a) { const cb = a.find(x => typeof x === 'function'); cb && cb(); return this; };
const { app } = require(path.join(SERVER, 'index.js'));
http.Server.prototype.listen = rl;
const jwt = require(path.join(SERVER, 'node_modules/jsonwebtoken'));
const token = jwt.sign({ id: 214, role: 'patient', name: 'Sachin' }, 'smoke-test-secret');
const server = app.listen(0); const port = server.address().port;

const post = (p, body) => new Promise(r => {
  const q = http.request({ host: '127.0.0.1', port, path: p, method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token } },
    res => { let d = ''; res.on('data', c => d += c); res.on('end', () => r({ code: res.statusCode, body: JSON.parse(d || '{}') })); });
  q.end(JSON.stringify(body));
});
const FAKE_IMG = Buffer.from('not-a-real-jpeg').toString('base64');
const toLab   = (extra = {}) => post('/api/ai-chat/lab-report', { file: FAKE_IMG, mimeType: 'image/jpeg', ...extra });
const toPhoto = () => post('/api/ai-chat/photo', { image: FAKE_IMG, mimeType: 'image/jpeg', mealSlots: ['Breakfast'] });

(async () => {
  let ok = true;
  const t = (n, c) => { console.log((c ? '  \u2713 ' : '  \u2717 ') + n); if (!c) ok = false; };

  console.log('\nImage sent to the wrong button');

  scenario = 'scale';
  let r = await toLab();
  t('scale photo via 📄 is recognised, not reported as 0 results',
    r.code === 200 && r.body.doc_type === 'scale' && r.body.route_to === 'photo');
  t('reply explains the re-route in member language',
    /scale reading/i.test(r.body.reply) && !/couldn't find any numeric/i.test(r.body.reply));
  t('no empty lab rows are returned to render a "Save 0 results" card',
    Array.isArray(r.body.results) && r.body.results.length === 0);

  scenario = 'meal';
  r = await toLab();
  t('meal photo via 📄 routes to the food reader',
    r.body.doc_type === 'meal' && r.body.route_to === 'photo' && /food/i.test(r.body.reply));

  scenario = 'unclear';
  r = await toLab();
  t('ambiguous image asks instead of guessing',
    r.body.route_to === 'ask' && /lab report/i.test(r.body.reply));
  t("the model's own question is passed through to the member",
    /photo of your meal/i.test(r.body.reply));

  console.log('\nOverride and normal paths still work');

  scenario = 'scale';
  r = await toLab({ force: true });
  t('member override ("It\'s a lab report") is honoured, not re-routed',
    r.body.route_to === undefined && r.body.results.length === 1 && r.body.results[0].test_name === 'Weight');

  scenario = 'lab';
  r = await toLab();
  t('a genuine lab report still parses normally',
    r.body.doc_type === 'lab_report' && r.body.results[0].test_name === 'HbA1c' && r.body.test_date === '2026-08-14');

  scenario = 'labviacamera';
  r = await toPhoto();
  t('report sent to 📷 hands back to the lab reader',
    r.body.route_to === 'lab' && /lab report/i.test(r.body.reply));

  scenario = 'scale';
  r = await toPhoto();
  t('scale photo via 📷 still reads weight + metrics as before',
    r.body.weight_kg === 76.8 && r.body.body_metrics.length === 1 && r.body.kind === 'body_scan');

  server.close();
  console.log(ok ? '\nAll checks passed\n' : '\nFAILURES\n');
  process.exit(ok ? 0 : 1);
})();
