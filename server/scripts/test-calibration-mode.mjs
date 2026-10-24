/** Fixes-2y, the 2x kit review's finding 4: the app's voice-calibration mode is bound to the signed-in account and
 * the armed session's identity and expiry, read at the START of every recording and fixed for that take.
 * Executes the actual calibrationMode module, the actual useVoiceInput hook and the actual voice composer (its
 * label) in jsdom, with synthetic API answers and fake microphone/dictation. No server, no member data, no hardware.
 *
 * The review's reproduction: arm a controlled try, keep the composer open past the 30-minute window (the server
 * now answers "nothing armed"): the app must no longer force an upload. Also: arming after the composer opened,
 * Finish, sign-out and account changes, a take's mode fixed from its start, natural tries, and production never asking.
 */
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(ROOT, 'client/src');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fitlife-calmode-'));
let pass = 0, fail = 0;
const ck = (name, ok, detail = '') => { console.log(`  ${ok ? '✓' : '✗'} ${name}${ok || !detail ? '' : ': ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 300)}`); ok ? pass++ : fail++; };
const tick = (ms = 25) => new Promise(r => setTimeout(r, ms));
async function until(fn, label, ms = 3000) { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return; await tick(); } throw new Error('Timed out: ' + label); }

const API = path.join(TMP, 'api.js');
fs.writeFileSync(API, `
  const call = async (method, url, body, opts) => {
    const entry = { method, url, body, opts }; window.__calls.push(entry);
    if (window.__apiHandler) return window.__apiHandler(entry);
    return { data: method === 'get' ? [] : { ok: true } };
  };
  export default Object.fromEntries(['get','post','put','patch','delete'].map(m => [m, (url, body, opts) => call(m, url, body, opts)]));
`);
const result = await build({ stdin: { resolveDir: SRC, loader: 'jsx', sourcefile: 'calmode-entry.jsx', contents: `
  import {createRoot} from 'react-dom/client';
  import {useAuthStore} from './store/authStore';
  import {useLogStore} from './store/logStore';
  import {today,emptyLog} from './constants';
  import {useVoiceInput} from './hooks/useVoiceInput';
  import {useVoiceComposer} from './components/VoiceComposer';
  import * as CM from './utils/calibrationMode';
  useAuthStore.setState({user:{id:214,name:'Fixture Member',role:'patient'},isRestoring:false});
  useLogStore.setState({date:today(),log:emptyLog(),protocol:{activities:[],acv:[],supplements:[]},loading:false,error:null});
  window.__auth=useAuthStore; window.__CM=CM;
  void useVoiceInput;
  function Probe(){
    const vc=useVoiceComposer({onSend:()=>{},autoSend:false}); window.__composer=vc;
    return <div>{vc.card}{vc.micButton}</div>;
  }
  window.__mount=()=>{window.__root=createRoot(document.getElementById('root'));window.__root.render(<Probe/>);};
` }, bundle: true, write: false, format: 'iife', jsx: 'automatic',
  loader: { '.js': 'jsx', '.jsx': 'jsx', '.css': 'empty', '.svg': 'empty', '.png': 'empty', '.jpg': 'empty', '.webp': 'empty' },
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': JSON.stringify({ MODE: 'production', DEV: false, PROD: true, BASE_URL: '/' }) },
  plugins: [{ name: 'fixture-api', setup(b) { b.onResolve({ filter: /(?:^|\/)client$/ }, args => (/api\/client$/.test(args.path) || args.importer.includes(`${path.sep}api${path.sep}`)) ? { path: API } : null); } }], logLevel: 'silent' });
const code = result.outputFiles[0].text;

const TEST_SITE = 'https://fitness-test.up.railway.app/', PRODUCTION = 'https://fitness.upscale-app.com/';
const MIN = 60000;
function mount(url) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, errors = [];
  w.__calls = []; w.__final = []; w.__clock = 0; w.__armed = null; w.__words = 'two idli one bowl sambar';
  const RealNow = w.Date.now.bind(w.Date); w.Date.now = () => RealNow() + w.__clock;            // a clock the test can move
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  w.scrollTo = () => {};
  Object.defineProperty(w.navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => Promise.resolve({ getTracks: () => [{ stop() {} }] }) } });
  w.MediaRecorder = class { static isTypeSupported() { return true } state = 'inactive'; start() { this.state = 'recording' } stop() { this.state = 'inactive'; w.setTimeout(() => { this.ondataavailable?.({ data: new w.Blob(['a'.repeat(4096)], { type: 'audio/webm' }) }); this.onstop?.() }, 0) } };
  w.SpeechRecognition = class { constructor() { w.__recognition = this } start() {} stop() { w.setTimeout(() => this.onend?.(), 0) } abort() {} addEventListener() {} removeEventListener() {} };
  // The server: "is a try armed for me?" answers for the account it was armed for, with the time left.
  w.__apiHandler = (e) => {
    if (e.url === '/voice-calibration/partc/me') {
      const a = w.__armed; const me = w.__auth.getState().user?.id;
      return Promise.resolve({ data: { armed: a && a.user === me && w.__clock < a.until ? { trial: a.trial, route: a.route, force_upload: a.route === 'controlled', session_key: a.key, expires_in_ms: a.until - w.__clock } : null } });
    }
    if (e.url === '/ai-chat/voice-transcribe') return Promise.resolve({ data: { transcript: 'eradu idli ondu bowl sambar' } });
    return Promise.resolve({ data: { ok: true } });
  };
  w.addEventListener('error', e => errors.push(String(e.message)));
  w.eval(code); w.__mount();
  return { w, errors, q: id => w.document.querySelector(`[data-testid="${id}"]`), close() { w.__root?.unmount(); w.close(); } };
}
const calls = (A, url) => A.w.__calls.filter(c => c.url === url);
const arm = (A, route = 'controlled', key = 'sess-1', user = 214) => { A.w.__armed = { trial: route === 'controlled' ? 1 : 33, route, key, user, until: A.w.__clock + 30 * MIN }; };
/** One recording through the REAL composer's microphone button: start, the phone's dictation hears words, stop. */
const micBtn = (A) => A.w.document.querySelector('button[aria-label="Speak your log"], button[aria-label="Stop recording"]');
const draftText = (A) => A.w.document.querySelector('[data-testid="voice-composer"] textarea')?.value || '';
async function take(A, { words = A.w.__words, between } = {}) {
  const before = { up: calls(A, '/ai-chat/voice-transcribe').length, dev: calls(A, '/voice-calibration/partc/device-event').length, text: draftText(A) };
  micBtn(A).click(); await until(() => A.w.document.querySelector('button[aria-label="Stop recording"]'), 'recording');
  if (words) { const r = [{ transcript: words }]; r.isFinal = true; A.w.__recognition.onresult({ results: [r] }); }
  if (between) await between();
  micBtn(A).click();
  await until(() => A.w.document.querySelector('button[aria-label="Speak your log"]') && !A.w.document.querySelector('button[aria-label="Transcribing"]'), 'take finished');
  await tick(60);
  const up = calls(A, '/ai-chat/voice-transcribe').slice(before.up), dev = calls(A, '/voice-calibration/partc/device-event').slice(before.dev);
  const added = draftText(A).slice(before.text.length).trim();
  return { uploaded: up.length > 0, upload: up[0]?.body || null, device: dev[0]?.body || null, final: [added] };
}

try {
  console.log('\n[4a] production: the app never asks, and nothing changes');
  {
    const A = mount(PRODUCTION);
    try {
      await tick(60);
      arm(A);
      const t = await take(A);
      A.w.dispatchEvent(new A.w.Event('focus')); await tick(40);
      ck('on the production address no calibration request is ever made (mount, recording, focus)', !A.w.__calls.some(c => /voice-calibration/.test(c.url)), A.w.__calls.map(c => c.url));
      ck('…on-device words are used as always (no upload, no session key), and the open composer shows no calibration label', !t.uploaded && t.final[0] === A.w.__words && !A.q('voice-calibration-banner'), t);
      ck('…and the module says nothing is armed', A.w.__CM.calibrationTry() === null && A.w.__CM.calibrationForcesUpload() === false && A.w.__CM.beginCalibrationTake() === null);
      ck('production mounts without runtime errors', A.errors.length === 0, A.errors);
    } finally { A.close(); }
  }

  console.log('\n[4b] the test site: controlled mode bound to the account, the session and its expiry');
  {
    const A = mount(TEST_SITE);
    try {
      arm(A);
      A.w.__CM.__resetCalibrationMode(); A.w.__root.unmount(); A.w.__mount();
      await tick(60);
      let t = await take(A);
      ck('an armed controlled try: the open composer shows the label', /try 1/.test(A.q('voice-calibration-banner')?.textContent || ''));
      ck('a controlled take uploads even though the phone heard words, and carries the session key', t.uploaded && t.upload.calibration_session === 'sess-1' && t.final[0] === 'eradu idli ondu bowl sambar', t);
      // The review's reproduction: a composer kept open past the window; the server now answers "nothing armed".
      A.w.__clock += 31 * MIN;
      ck('review repro: 31 minutes later, with NO refresh, the app no longer forces an upload (the cached mode expired with its session)', A.w.__CM.calibrationForcesUpload() === false && A.w.__CM.calibrationTry() === null);
      A.w.dispatchEvent(new A.w.Event('focus')); await tick(60);
      ck('…returning to the app refreshes the composer: the label is gone', !A.q('voice-calibration-banner'));
      t = await take(A);
      ck('…and the next take uses on-device words (no upload, no session key)', !t.uploaded && t.final[0] === A.w.__words, t);
      // Arming AFTER the composer opened: picked up at the next recording's start.
      arm(A, 'controlled', 'sess-2');
      ck('a try armed after the composer opened is not yet known (no stale guess)…', A.w.__CM.calibrationForcesUpload() === false);
      t = await take(A);
      ck('…but the recording boundary reads it afresh: that take uploads with the NEW session key', t.uploaded && t.upload.calibration_session === 'sess-2', t);
      // The mode is fixed for a take: Finish during a recording does not switch paths halfway.
      t = await take(A, { between: async () => { A.w.__armed = null; await tick(10); } });
      ck('Finish during a recording: that take keeps the mode it started with (uploads, with its session key)', t.uploaded && t.upload.calibration_session === 'sess-2', t);
      t = await take(A);
      ck('…the next take after Finish is ordinary (on-device, no session key)', !t.uploaded && t.final[0] === A.w.__words, t);
      // Account change and sign-out.
      arm(A, 'controlled', 'sess-3');
      await A.w.__CM.refreshCalibrationTry({ force: true });
      ck('armed for this account: the mode is on', A.w.__CM.calibrationForcesUpload() === true);
      A.w.__auth.setState({ user: { id: 215, name: 'Other Member', role: 'patient' } }); await tick(40);
      ck('another account signs in: the mode is cleared at once', A.w.__CM.calibrationTry() === null && A.w.__CM.calibrationForcesUpload() === false);
      t = await take(A);
      ck('…its recordings are ordinary (the server arms nothing for it)', !t.uploaded, t);
      A.w.__auth.setState({ user: { id: 214, name: 'Fixture Member', role: 'patient' } }); await A.w.__CM.refreshCalibrationTry({ force: true });
      ck('back on the armed account the mode returns', A.w.__CM.calibrationForcesUpload() === true);
      A.w.__auth.setState(s => ({ user: null, sessionVersion: s.sessionVersion + 1 })); await tick(20);
      ck('sign-out clears it, and nothing is asked while signed out', A.w.__CM.calibrationTry() === null && (await A.w.__CM.refreshCalibrationTry({ force: true })) === null);
      A.w.__auth.setState({ user: { id: 214, name: 'Fixture Member', role: 'patient' } });
      // A snapshot belongs to its sign-in: an answer arriving after an account change is discarded.
      let release; A.w.__apiHandler = ((orig) => (e) => (e.url === '/voice-calibration/partc/me' ? new Promise(r => { release = () => r(orig(e)); }) : orig(e)))(A.w.__apiHandler);
      const pending = A.w.__CM.beginCalibrationTake();
      await tick(10);
      A.w.__auth.setState({ user: { id: 215, name: 'Other Member', role: 'patient' } });
      release(); const snap = await A.w.__CM.takeCalibrationMode(pending);
      ck('an answer that arrives after an account change belongs to nobody (null)', snap === null && A.w.__CM.calibrationTry() === null);
      ck('the test site mounts without runtime errors', A.errors.length === 0, A.errors);
    } finally { A.close(); }
  }

  console.log('\n[4c] natural observations stay separate');
  {
    const A = mount(TEST_SITE);
    try {
      arm(A, 'natural', 'sess-n');
      A.w.__CM.__resetCalibrationMode(); A.w.__root.unmount(); A.w.__mount();
      await tick(60);
      const t = await take(A);
      ck('a natural try: the open composer says it is recorded as it happens', /as it happens/.test(A.q('voice-calibration-banner')?.textContent || ''));
      ck('a natural try: on-device words are used (no upload) and reported once, with the session key', !t.uploaded && t.device && t.device.session_key === 'sess-n' && t.device.text === A.w.__words, t);
      // A snapshot of THIS sign-in, made controlled: only the controlled guard can stop the report.
      const real = await A.w.__CM.takeCalibrationMode(A.w.__CM.beginCalibrationTake());
      const s = Object.freeze({ ...real, route: 'controlled', force_upload: true });
      const before = calls(A, '/voice-calibration/partc/device-event').length;
      A.w.__CM.reportDeviceDictation('x', 'kn-IN', { ...real }); await tick(20);
      ck('…(control: the same snapshot as a natural one does report)', calls(A, '/voice-calibration/partc/device-event').length === before + 1);
      A.w.__CM.reportDeviceDictation('x', 'kn-IN', s); A.w.__CM.reportDeviceDictation('x', 'kn-IN', null);
      await tick(20);
      ck('…a controlled snapshot of the same sign-in, or none, never reports on-device dictation', calls(A, '/voice-calibration/partc/device-event').length === before + 1);
    } finally { A.close(); }
  }
} catch (e) { ck('the suite ran to the end', false, e.stack); }
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\nCalibration mode (app): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
