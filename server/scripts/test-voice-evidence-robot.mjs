/**
 * scripts/test-voice-evidence-robot.mjs — Fixes-2s: the failure cases the 2r
 * review found in the voice evidence robot, checked without any site or
 * provider. Part A tests the decisions (lib/voice-evidence.mjs) directly;
 * part B runs the real robot script as a process and checks that it blocks
 * BEFORE any sign-in, browser or provider call.
 */
import http from 'http';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import * as L from './lib/voice-evidence.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 300))); };
const S = Object.fromEntries(L.CASES.map(c => [c.id, c]));

console.log('\n[1] the target: exactly the approved HTTPS test origin; simulation only on this computer, only when asked');
{
  ck('https://fitness-test.up.railway.app → allowed (real)', L.checkTarget('https://fitness-test.up.railway.app').ok && L.checkTarget('https://fitness-test.up.railway.app/').mode === 'real');
  for (const bad of ['https://example.org', 'https://fitness-prod.up.railway.app', 'https://fitness-test.up.railway.app.evil.com', 'https://evil-fitness-test.up.railway.app',
    'http://fitness-test.up.railway.app', 'https://fitness-test.up.railway.app:8443', 'https://user:pw@fitness-test.up.railway.app', 'https://fitness.upscale-app.com', 'not a url', '']) {
    ck(`real run refuses ${JSON.stringify(bad)}`, L.checkTarget(bad).ok === false, L.checkTarget(bad));
  }
  ck('http://localhost:3999 without simulation → refused', !L.checkTarget('http://localhost:3999').ok);
  ck('http://localhost:3999 and http://127.0.0.1:3999 with simulation → allowed, labelled simulation', L.checkTarget('http://localhost:3999', { simulation: true }).mode === 'simulation' && L.checkTarget('http://127.0.0.1:3999', { simulation: true }).ok);
  ck('simulation refuses any other host, the test site included', !L.checkTarget('https://fitness-test.up.railway.app', { simulation: true }).ok && !L.checkTarget('http://192.168.1.5:3000', { simulation: true }).ok);
}

console.log('\n[2] the deployment: the exact commit, or BLOCKED after the bounded wait');
{
  let reply = () => ({ status: 'ok', commit: 'abc1234def' });
  const srv = http.createServer((q, r) => { const b = reply(); if (b === 'hang') return; r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify(b)); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${srv.address().port}`;
  const go = (expect, waitMs = 300) => L.checkDeployment({ origin, expect, waitMs, pollMs: 100 });
  ck('the expected commit → confirmed', (await go('abc1234def')).ok);
  reply = () => ({ status: 'ok', commit: null });
  let d = await go('abc1234def'); ck('the server reports no commit → BLOCKED', !d.ok && /does not report/.test(d.reason), d);
  reply = () => ({ status: 'ok' });
  d = await go('abc1234def'); ck('an older server without a commit field → BLOCKED', !d.ok && /without a commit/.test(d.reason), d);
  reply = () => ({ status: 'ok', commit: 'fff0000aaa' });
  d = await go('abc1234def'); ck('a different commit → BLOCKED, naming both', !d.ok && /fff0000/.test(d.reason) && /abc1234/.test(d.reason), d);
  d = await go(''); ck('no expected commit given → BLOCKED at once', !d.ok && /no expected commit/.test(d.reason), d);
  let n = 0; reply = () => ({ commit: ++n < 3 ? 'old0000' : 'abc1234def' });
  d = await go('abc1234def', 2000); ck('the deployment arriving during the wait → confirmed', d.ok, d);
  srv.close();
  d = await L.checkDeployment({ origin: 'http://127.0.0.1:9', expect: 'abc', waitMs: 250, pollMs: 100 });
  ck('health unreachable until the deadline → BLOCKED', !d.ok && /unreachable/.test(d.reason), d);
}

console.log('\n[3] each preview is checked item by item before Save');
{
  const ok1 = { foods: [{ name: 'Idli', qty_text: '2 idli' }, { name: 'Sambar', qty_text: '1 bowl' }], weight_kg: 82.5 };
  ck('S1: 2 idli, 1 bowl sambar, 82.5 kg → PASS', L.evaluateItems(S.S1.expect, ok1).result === 'PASS');
  const canned = { foods: [...ok1.foods, { name: 'Roti', qty_text: '2 roti' }, { name: 'Dal', qty_text: '1 katori' }], weight_kg: 82.5 };
  let e = L.evaluateItems(S.S1.expect, canned);
  ck('S1 with roti and dal added (the dry run\'s canned preview) → FAIL, naming them', e.result === 'FAIL' && e.reasons.some(r => /Roti/.test(r)) && e.reasons.some(r => /Dal/.test(r)), e);
  e = L.evaluateItems(S.S1.expect, { ...ok1, weight_kg: 85.2 }); ck('wrong weight 85.2 kg → FAIL', e.result === 'FAIL' && /85.2/.test(e.reasons.join()), e);
  e = L.evaluateItems(S.S1.expect, { ...ok1, weight_kg: null }); ck('weight missing → FAIL', e.result === 'FAIL', e);
  e = L.evaluateItems(S.S2.expect, ok1); ck('S2 (no weight said) with a weight → FAIL', e.result === 'FAIL' && /unexpected weight/.test(e.reasons.join()), e);
  e = L.evaluateItems(S.S1.expect, { ...ok1, foods: [{ name: 'Idli', qty_text: '3 idli' }, ok1.foods[1]] }); ck('3 idli instead of 2 → FAIL', e.result === 'FAIL', e);
  e = L.evaluateItems(S.S1.expect, { ...ok1, foods: [ok1.foods[0], { name: 'Sambar', qty_text: '1 cup' }] }); ck('sambar in a cup instead of a bowl → FAIL', e.result === 'FAIL' && /cup instead of bowl/.test(e.reasons.join()), e);
  e = L.evaluateItems(S.S1.expect, { ...ok1, foods: [ok1.foods[0]] }); ck('sambar missing → FAIL', e.result === 'FAIL' && /missing sambar/.test(e.reasons.join()), e);
  e = L.evaluateItems(S.S1.expect, { ...ok1, foods: [{ name: 'Idli', qty_text: 'some' }, ok1.foods[1]] }); ck('an amount that is not stated → UNVERIFIED (not saved)', e.result === 'UNVERIFIED', e);
  e = L.evaluateItems(S.S1.expect, { ...ok1, foods: [ok1.foods[0], { name: 'Sambar', qty_text: '1' }] }); ck('sambar with no unit → UNVERIFIED', e.result === 'UNVERIFIED', e);
  e = L.evaluateItems(S.S3.expect, { foods: [{ name: 'Roti', qty_text: 'two roti' }, { name: 'Dal', qty_text: 'ek katori' }] }); ck('S3 with spoken numbers ("two", "ek katori") → PASS', e.result === 'PASS', e);
  e = L.evaluateItems(S.S2.expect, { foods: [{ name: 'ಇಡ್ಲಿ', qty_text: 'ಎರಡು' }, { name: 'Sambar', qty_text: '1 bowl' }] }); ck('S2 with Kannada words for idli and "two" → PASS', e.result === 'PASS', e);
}

console.log('\n[4] Retry must re-send the identical recording');
{
  const a = Buffer.from('take one').toString('base64'), b = Buffer.from('take two').toString('base64');
  ck('the same bytes → the same SHA-256', L.sha256(a) === L.sha256(a) && L.sha256(a).length === 64);
  ck('different bytes → different SHA-256 (a new recording would be caught)', L.sha256(a) !== L.sha256(b));
}

console.log('\n[5] only the approved recordings, only this run\'s tries');
{
  const samples = [{ id: 1, phrase_id: 'k01', at: '2026-10-19T05:00:00Z' }, { id: 2, phrase_id: 'k02', at: '2026-10-19T18:00:00Z' },
    { id: 3, phrase_id: 'f01', at: '2026-10-19T06:00:00Z' }, { id: 4, phrase_id: 'k03', at: '2026-10-20T06:00:00Z' }, { id: 5, phrase_id: 'k04', at: '2026-10-18T19:00:00Z' }];
  ck('the 19 Oct (IST) scripted lines only: own-words lines and other days left out', JSON.stringify(L.approvedSamples(samples).map(s => s.id)) === '[1,2,5]', L.approvedSamples(samples));
  const runs = [{ id: 10, user_id: 7, created_at: '2026-10-20T10:00:00Z' }, { id: 11, user_id: 8, created_at: '2026-10-20T10:01:00Z' },
    { id: 9, user_id: 7, created_at: '2026-10-20T09:00:00Z' }, { id: 12, user_id: 7, created_at: '2026-10-20T10:02:00Z' }];
  const got = L.scopeRuns(runs, { userId: 7, since: '2026-10-20T09:59:59Z', before: new Set([12]) });
  ck('another account\'s try, an older try and a try seen before the run are all excluded', JSON.stringify(got.map(r => r.id)) === '[10]', got);
}

console.log('\n[6] clean-up removes only this run\'s entries and restores the weight');
{
  const old = { id: 'a1', name: 'Idli', qty_text: '2 idli', grams: 80 };
  const baseline = { food_items: [old, { id: 'a2', name: 'Coffee', qty_text: '1 cup' }], weight_kg: 81 };
  const before = baseline.food_items;
  const afterSave = [...before, { id: 'n1', name: 'Idli', qty_text: '2 idli', grams: 80 }, { id: 'n2', name: 'Sambar', qty_text: '1 bowl' }];
  const created = L.addedItems(before, afterSave);
  ck('the entries a save created are found, even with the same name as an older entry', JSON.stringify(created.map(f => f.id)) === '["n1","n2"]', created);
  const plan = L.planCleanup(baseline, { food_items: afterSave, weight_kg: 82.5 }, created.map(L.itemKey));
  ck('the day written back keeps the earlier idli and coffee, drops the 2 new entries, restores 81 kg', plan.removed === 2 && plan.food_items.map(f => f.id).join() === 'a1,a2' && plan.weight_kg === 81, plan);
  ck('verified equal to before the run', L.verifyCleanup(baseline, { food_items: plan.food_items, weight_kg: 81 }).ok);
  let v = L.verifyCleanup(baseline, { food_items: afterSave, weight_kg: 81 }); ck('a leftover entry → clean-up FAILED', !v.ok && /left over/.test(v.problems.join()), v);
  v = L.verifyCleanup(baseline, { food_items: [before[1]], weight_kg: 81 }); ck('an entry from before the run removed → clean-up FAILED', !v.ok && /before the run/.test(v.problems.join()), v);
  v = L.verifyCleanup(baseline, { food_items: before, weight_kg: 82.5 }); ck('the weight not restored → clean-up FAILED', !v.ok && /weight/.test(v.problems.join()), v);
  ck('the same entry with its keys in another order (as the database returns it) is not "changed"', L.verifyCleanup(baseline, { food_items: [{ grams: 80, qty_text: '2 idli', name: 'Idli', id: 'a1' }, { qty_text: '1 cup', name: 'Coffee', id: 'a2' }], weight_kg: 81 }).ok);
  ck('an older entry that the app re-saved with an added empty field (food_id: null) is not "changed"', L.verifyCleanup(baseline, { food_items: [{ ...old, food_id: null }, { ...before[1], food_id: null }], weight_kg: 81 }).ok);
  ck('…but a real change to it (grams 80 → 120) is caught', !L.verifyCleanup(baseline, { food_items: [{ ...old, grams: 120 }, before[1]], weight_kg: 81 }).ok);
  const noIds = [{ name: 'Dal', qty_text: '1 katori' }];
  ck('entries without ids are matched exactly, one for one', L.addedItems(noIds, [...noIds, { name: 'Dal', qty_text: '1 katori' }]).length === 1);
}

console.log('\n[7] the verdict: collection kept apart from recognition quality');
{
  const good = () => ({
    part1: { approved_count: 2, export_ok: true, samples: [{ phrase_id: 'k01', original_unchanged: true, whisper_kn: { text: 'x' } }, { phrase_id: 'k02', original_unchanged: true, whisper_kn: { text: 'y' } }] },
    part2: { collected: true, real: [{}, {}, {}, {}], cases: [{ id: 'S1', collected: true, quality: 'PASS', saved: true, save_confirmed: true, readback: { result: 'PASS', reasons: [] } },
      { id: 'S4', collected: true, quality: 'PASS', retry: { identical: true } }] },
    cleanup: { ok: true, problems: [] }, switch_off: { verified: true, detail: 'off' }, errors: [] });
  let v = L.verdict(good()); ck('everything collected, site left as found → COMPLETE, exit 0', v.run === 'COMPLETE' && v.exitCode === 0, v);
  let r = good(); r.part2.cases[0].quality = 'FAIL'; r.part2.cases[0].saved = false; delete r.part2.cases[0].readback; delete r.part2.cases[0].save_confirmed;
  v = L.verdict(r); ck('a wrong preview, accurately collected and not saved → still COMPLETE (quality FAIL is reported, never an acceptance)', v.run === 'COMPLETE', v);
  r = good(); r.part1.samples[0].original_unchanged = false; v = L.verdict(r); ck('changed originals → FAILED, exit 1', v.run === 'FAILED' && v.exitCode === 1 && /k01 changed/.test(v.failures.join()), v);
  r = good(); r.part1.samples[1].whisper_kn = null; v = L.verdict(r); ck('a missing Kannada re-run → INCOMPLETE, exit 1', v.run === 'INCOMPLETE' && v.exitCode === 1, v);
  r = good(); r.part1.export_ok = false; v = L.verdict(r); ck('no Excel export → INCOMPLETE', v.run === 'INCOMPLETE' && /Excel/.test(v.incomplete.join()), v);
  r = good(); r.part1.approved_count = 1; v = L.verdict(r); ck('only 1 of the 2 approved recordings → INCOMPLETE', v.run === 'INCOMPLETE', v);
  r = good(); r.part2.cases[0].save_confirmed = false; v = L.verdict(r); ck('no "Saved" confirmation → FAILED', v.run === 'FAILED' && /did not confirm/.test(v.failures.join()), v);
  r = good(); r.part2.cases[0].readback = { result: 'FAIL', reasons: ['weight 85 kg instead of 82.5 kg'] }; v = L.verdict(r); ck('saved entries differing from the preview → FAILED', v.run === 'FAILED' && /85 kg/.test(v.failures.join()), v);
  r = good(); r.part2.cases[1].retry = { identical: false, detail: 'Retry sent nothing' }; v = L.verdict(r); ck('Retry not re-sending the identical recording → FAILED', v.run === 'FAILED' && /Retry/.test(v.failures.join()), v);
  r = good(); r.switch_off = { verified: false, detail: 'still on' }; v = L.verdict(r); ck('switch not confirmed off → FAILED', v.run === 'FAILED' && /NOT confirmed off/.test(v.failures.join()), v);
  r = good(); r.cleanup = { ok: false, problems: ['1 entry left over'] }; v = L.verdict(r); ck('clean-up not equal to before → FAILED', v.run === 'FAILED' && /left over/.test(v.failures.join()), v);
  r = good(); r.part2.scope_problem = "this run's recorded tries: 7, expected 6"; v = L.verdict(r); ck('an unexpected extra try in this run\'s window → FAILED', v.run === 'FAILED', v);
  r = good(); r.part2.cases[0].collected = false; r.part2.cases[0].error = 'no answer in 40 s'; v = L.verdict(r); ck('a case with no server answer → INCOMPLETE', v.run === 'INCOMPLETE', v);
  r = good(); r.part2.real = [{}]; v = L.verdict(r); ck('missing real-recording tries → INCOMPLETE', v.run === 'INCOMPLETE', v);
  // The reviewer's controlled result: it printed "Completed", exit 0.
  r = good(); r.part1.samples[0].original_unchanged = false; r.part1.samples[1].whisper_kn = null; r.part1.export_ok = false;
  r.part2.cases[0].quality = 'FAIL'; r.part2.cases[1].retry = { identical: false }; r.switch_off = { verified: false, detail: 'x' }; r.cleanup = { ok: false, problems: ['totals differ'] };
  v = L.verdict(r); ck('the reviewer\'s controlled bad result → FAILED, exit 1 (was "Completed", 0)', v.run === 'FAILED' && v.exitCode === 1 && v.failures.length >= 4, v);
  v = L.verdict({ blocked: 'missing secrets' }); ck('BLOCKED → exit 3', v.run === 'BLOCKED' && v.exitCode === 3);
}

console.log('\n[8] the real robot script blocks before any sign-in, browser or provider call');
{
  const run = (envs) => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-robot-'));
    const r = spawnSync(process.execPath, [path.join(HERE, 'robot-voice-evidence.mjs')], { encoding: 'utf8', timeout: 60e3,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, ROBOT_OUT: out, FITLIFE_ROBOT_ADMIN_EMAIL: 'a@b.c', FITLIFE_ROBOT_ADMIN_PASSWORD: 'x', FITLIFE_ROBOT_VOICE_MEMBER_PHONE: '9000000001', FITLIFE_ROBOT_VOICE_MEMBER_PIN: '1234', ...envs } });
    const rep = fs.existsSync(path.join(out, 'report.md')) ? fs.readFileSync(path.join(out, 'report.md'), 'utf8') : '';
    const shots = fs.readdirSync(out).filter(f => f.endsWith('.png'));
    return { code: r.status, rep, shots, out: r.stdout + r.stderr };
  };
  let r = run({ ROBOT_BASE_URL: 'https://example.org' });
  ck('another origin → BLOCKED (exit 3), report says nothing was changed, no browser', r.code === 3 && /BLOCKED/.test(r.rep) && /Nothing was changed/.test(r.rep) && !r.shots.length, r.out.slice(-300));
  r = run({ ROBOT_BASE_URL: 'http://localhost:3999' });
  ck('this computer without ROBOT_SIMULATION=1 → BLOCKED', r.code === 3 && /BLOCKED/.test(r.rep), r.out.slice(-300));
  r = run({ ROBOT_BASE_URL: 'https://fitness-test.up.railway.app' });
  ck('the test site with no expected commit → BLOCKED before contacting it', r.code === 3 && /no expected commit/.test(r.rep), r.out.slice(-300));
  r = run({ ROBOT_BASE_URL: 'https://fitness-test.up.railway.app', FITLIFE_ROBOT_VOICE_MEMBER_PIN: '' });
  ck('a missing login → BLOCKED, naming the secret', r.code === 3 && /FITLIFE_ROBOT_VOICE_MEMBER_PIN/.test(r.rep), r.out.slice(-300));
  r = run({ ROBOT_BASE_URL: 'https://fitness-test.up.railway.app', FITLIFE_ROBOT_MEMBER_PHONE: '+91 90000 00001' });
  ck('the voice account being a phone robot account → BLOCKED (no overlap)', r.code === 3 && /phone robot/.test(r.rep), r.out.slice(-300));
  r = run({ ROBOT_BASE_URL: 'http://localhost:9', ROBOT_SIMULATION: '1' });
  ck('a simulated run labels its report SIMULATED from the first line, even when blocked', r.code === 3 && /^> \*\*SIMULATED RUN — NOT REAL RESULTS/.test(r.rep) && /Voice evidence robot \(SIMULATED\)/.test(r.rep) && /SIMULATED — canned providers/.test(r.rep), r.rep.slice(0, 300));
}

console.log(`\nVoice evidence robot checks: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
