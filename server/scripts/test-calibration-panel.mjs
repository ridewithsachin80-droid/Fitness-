/**
 * scripts/test-calibration-panel.mjs — Fixes-3g (28 Oct 2026): the admin "Voice calibration · round 1" panel.
 *
 * The test site's admin page showed no calibration panel. Two causes are covered here:
 *   - the panel hid itself silently whenever its first request failed (any error → nothing on screen);
 *   - the built client that is actually served lacked the panel (checked separately by check-built-client.mjs).
 *
 * The REAL panel component is bundled and mounted in jsdom. Its API answer is the REAL route's answer: the calibration routes
 * run against the test database (test server mode) and their JSON is handed to the panel; failures are injected per case.
 *   [1] on the test site, with the real answer: the panel and its Wording check show all three languages, each with its
 *       script hash and real status (one confirmed in this database, two not confirmed);
 *   [2] on the test site, a failing request (HTTP 500, no answer, HTTP 404) shows a clear message with the status and a Retry
 *       button, never nothing; Retry loads the panel once the server answers; while loading it says so;
 *   [3] off the test site (production address), the 404 the server gives there by design shows nothing, as before, with no
 *       loading flash.
 */
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) { console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1); }
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
process.env.RAILWAY_GIT_BRANCH = 'test';   // the calibration routes answer only on the test server
const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fitlife-cal-panel-'));
let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 400))); };
const tick = (ms = 25) => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (f()) return true; await tick(); } return false; };

const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const C = require('../services/voiceCalibration');
let server;
try {
  // ── The real route's answer ──
  const app = express(); app.use(express.json()); app.use('/api/voice-calibration', require('../routes/voiceCalibration'));
  server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const q = async (sql, a) => (await pool.query(sql, a)).rows;
  await pool.query(`SELECT setval(pg_get_serial_sequence('users','id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM users), 1))`);
  const admin = (await q(`INSERT INTO users (name,phone,password,role,active) VALUES ('Panel Admin','5000000088','x','admin',true) RETURNING id`))[0].id;
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ id: admin, role: 'admin', name: 'x' }, process.env.JWT_SECRET, { expiresIn: 600 })}` };
  const base = `http://127.0.0.1:${server.address().port}/api/voice-calibration`;
  await pool.query(`DELETE FROM voice_calibration_wording`); await pool.query(`DELETE FROM voice_calibration_reviewers`).catch(() => {});
  const rv = await (await fetch(`${base}/admin/reviewers`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'Panel Speaker Example', role: 'fluent speaker' }) })).json();
  const conf = await fetch(`${base}/admin/wording`, { method: 'POST', headers: H, body: JSON.stringify({ lang: 'hi', reviewer_code: rv.code, script_sha256: C.scriptSha('hi') }) });
  const real = await (await fetch(`${base}/admin`, { headers: H })).json();
  ck('the real route answers on the test server, with three wording entries (Hindi confirmed in this test database)', real.available === true && real.wording?.length === 3 && conf.status === 200
    && real.wording.find(w => w.lang === 'hi')?.confirmed?.by === rv.code && !real.wording.find(w => w.lang === 'kn')?.confirmed, { conf: conf.status, wording: real.wording?.map(w => [w.lang, !!w.confirmed]) });

  // ── The real panel, bundled ──
  const apiFile = path.join(TMP, 'api.js');
  fs.writeFileSync(apiFile, `
    const reply = async (method, url, body) => {
      window.calls.push({ method, url });
      if (url === '/voice-calibration/admin') {
        if (window.hold) await new Promise(r => window.release = r);
        const m = window.mode;
        if (m === 'ok') return { data: window.realAnswer };
        if (m === 'offline') { const e = new Error('Network Error'); e.request = {}; throw e; }
        const e = new Error('Request failed'); e.response = { status: m, data: { error: 'x' } }; throw e;
      }
      if (url === '/admin/members') return { data: [] };
      if (url === '/voice-calibration/admin/takes') return { data: { takes: [] } };
      return { data: { ok: true } };
    };
    export default Object.fromEntries(['get','post','put','patch','delete'].map(m => [m, (u, b) => reply(m, u, b)]));
  `);
  const out = await build({
    stdin: { resolveDir: path.join(ROOT, 'client/src'), loader: 'jsx', contents: `
      import { createRoot } from 'react-dom/client';
      import Panel from './components/voicecalibration/VoiceCalibrationPanel';
      window.mount = () => { window.root = createRoot(document.getElementById('root')); window.root.render(<Panel />); };
    ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic',
    loader: { '.js': 'jsx', '.jsx': 'jsx', '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{"DEV":false,"PROD":true}' },
    plugins: [{ name: 'synthetic-api', setup(b) { b.onResolve({ filter: /(?:^|\/)client$/ }, a => /api\/client$/.test(a.path) ? { path: apiFile } : null); } }],
    logLevel: 'silent',
  });
  const code = out.outputFiles[0].text;
  const page = async (host, mode, { hold = false } = {}) => {
    const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: `https://${host}/admin`, runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window; w.calls = []; w.mode = mode; w.hold = hold; w.realAnswer = real;
    w.eval(code); w.mount(); await tick(60);
    return { w, q: (id) => w.document.querySelector(`[data-testid="${id}"]`), text: () => w.document.body.textContent };
  };
  const TEST = 'fitness-test.up.railway.app', PROD = 'fitness.upscale-app.com';

  console.log('\n[1] the test site, with the real answer');
  let P = await page(TEST, 'ok');
  await until(() => P.q('vc-panel'));
  ck('the panel shows ("Voice calibration · round 1") with its Wording check section', !!P.q('vc-panel') && /Voice calibration · round 1/.test(P.text()) && !!P.q('vc-words'), P.text().slice(0, 200));
  P.q('vc-words')?.querySelector('button')?.click(); await tick(80);
  const langs = ['kn', 'hi', 'en'].map(l => P.q(`vc-words-${l}`)?.textContent || '');
  ck('…opened, it lists Kannada, Hindi and English with each script hash (first 12) and its real status: Hindi confirmed by the code, Kannada and English not confirmed (locked)',
    langs.every(Boolean) && ['kn', 'hi', 'en'].every((l, i) => langs[i].includes(C.scriptSha(l).slice(0, 12)))
      && /confirmed by R\d+/.test(langs[1]) && /not confirmed/.test(langs[0]) && /not confirmed/.test(langs[2]), langs.map(t => t.slice(0, 120)));
  ck('no Confirm was sent by showing the panel (only reads)', P.w.calls.every(c => c.method === 'get'), P.w.calls);

  console.log('\n[2] the test site, when the request fails');
  for (const [mode, label, re] of [[500, 'HTTP 500', /the server answered HTTP 500/], ['offline', 'no answer', /no answer from the server/], [404, 'HTTP 404', /not available here \(HTTP 404\)/]]) {
    P = await page(TEST, mode);
    await until(() => P.q('vc-panel-error'));
    ck(`${label}: a clear message with the reason and a Retry button, never nothing`, !!P.q('vc-panel-error') && re.test(P.q('vc-panel-error')?.textContent || '') && !!P.q('vc-panel-retry') && !P.q('vc-panel'), P.text().slice(0, 200));
  }
  P = await page(TEST, 500);
  await until(() => P.q('vc-panel-retry'));
  P.w.mode = 'ok'; P.q('vc-panel-retry')?.click();
  ck('Retry asks again and, once the server answers, the panel appears', await until(() => P.q('vc-panel') && P.q('vc-words')) && P.w.calls.filter(c => c.url === '/voice-calibration/admin').length === 2, P.w.calls);
  P = await page(TEST, 'ok', { hold: true });
  ck('while the first answer is on its way, it says "Loading…"', !!P.q('vc-panel-loading') && /Loading/.test(P.text()), P.text().slice(0, 120));
  P.w.release?.(); await until(() => P.q('vc-panel'));
  ck('…and then shows the panel', !!P.q('vc-panel') && !P.q('vc-panel-loading'));

  console.log('\n[3] off the test site');
  P = await page(PROD, 'ok', { hold: true });
  ck('production address, while waiting: nothing on screen (no loading flash)', P.w.document.getElementById('root').innerHTML === '', P.w.document.getElementById('root').innerHTML.slice(0, 100));
  P.w.mode = 404; P.w.release?.(); await tick(120);
  ck('production address, the server\'s 404 (by design): still nothing on screen, as before', P.w.document.getElementById('root').innerHTML === '', P.w.document.getElementById('root').innerHTML.slice(0, 100));
  P = await page(PROD, 500); await tick(150);
  ck('production address, any other failure: nothing on screen (the panel is a test-server tool)', P.w.document.getElementById('root').innerHTML === '');

  await pool.query(`DELETE FROM voice_calibration_wording`); await pool.query(`DELETE FROM voice_calibration_reviewers`).catch(() => {});
  await pool.query(`DELETE FROM users WHERE id=$1`, [admin]);
} catch (e) { ck('the suite ran to the end', false, e.stack); }
finally { server?.close(); await pool.end().catch(() => {}); fs.rmSync(TMP, { recursive: true, force: true }); }
console.log(`\nCalibration panel (Fixes-3g): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
