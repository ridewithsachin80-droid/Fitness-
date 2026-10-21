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
  // Changed in Fixes-2t: the verdict now requires every one of the 5 cases with its stages
  // (transcription, preview or explicit refusal, quality, save + read-back or verified no-save),
  // so the "good run" fixture carries all five. The assertions below are unchanged.
  const saved = (id) => ({ id, collected: true, transcribed: true, status: 200, outcome: 'preview', transcript: 'x', quality: 'PASS', saved: true, save_confirmed: true, readback: { result: 'PASS', reasons: [] } });
  const good = () => ({
    part1: { approved_count: 2, export_ok: true, unapproved_touched: [], samples: [{ phrase_id: 'k01', original_unchanged: true, whisper_kn: { text: 'x' } }, { phrase_id: 'k02', original_unchanged: true, whisper_kn: { text: 'y' } }] },
    part2: { collected: true, real: [1, 2, 3, 4].map(() => ({ phrase_id: 'k01', voice_language: 'kn-IN', status: 200, transcript: 'x' })), cases: [saved('S1'), saved('S2'), saved('S3'),
      { id: 'S4', collected: true, transcribed: true, status: 200, outcome: 'refused', rejected: 'no_speech', quality: 'PASS', retry: { identical: true }, no_save_verified: true },
      { id: 'S5', collected: true, transcribed: true, status: 200, outcome: 'preview', transcript: 'x', quality: 'FAIL', no_save_verified: true }] },
    cleanup: { ok: true, problems: [] }, switch_off: { verified: true, detail: 'off' }, errors: [] });
  let v = L.verdict(good()); ck('everything collected, site left as found → COMPLETE, exit 0', v.run === 'COMPLETE' && v.exitCode === 0, v);
  let r = good(); r.part2.cases[0].quality = 'FAIL'; r.part2.cases[0].saved = false; delete r.part2.cases[0].readback; delete r.part2.cases[0].save_confirmed; r.part2.cases[0].no_save_verified = true;
  v = L.verdict(r); ck('a wrong preview, accurately collected and not saved → still COMPLETE (quality FAIL is reported, never an acceptance)', v.run === 'COMPLETE', v);
  r = good(); r.part1.samples[0].original_unchanged = false; v = L.verdict(r); ck('changed originals → FAILED, exit 1', v.run === 'FAILED' && v.exitCode === 1 && /k01 changed/.test(v.failures.join()), v);
  r = good(); r.part1.samples[1].whisper_kn = null; v = L.verdict(r); ck('a missing Kannada re-run → INCOMPLETE, exit 1', v.run === 'INCOMPLETE' && v.exitCode === 1, v);
  r = good(); r.part1.export_ok = false; v = L.verdict(r); ck('no Excel export → INCOMPLETE', v.run === 'INCOMPLETE' && /Excel/.test(v.incomplete.join()), v);
  r = good(); r.part1.approved_count = 1; v = L.verdict(r); ck('only 1 of the 2 approved recordings → INCOMPLETE', v.run === 'INCOMPLETE', v);
  r = good(); r.part2.cases[0].save_confirmed = false; v = L.verdict(r); ck('no "Saved" confirmation → FAILED', v.run === 'FAILED' && /did not confirm/.test(v.failures.join()), v);
  r = good(); r.part2.cases[0].readback = { result: 'FAIL', reasons: ['weight 85 kg instead of 82.5 kg'] }; v = L.verdict(r); ck('saved entries differing from the preview → FAILED', v.run === 'FAILED' && /85 kg/.test(v.failures.join()), v);
  r = good(); r.part2.cases[3].retry = { identical: false, detail: 'Retry sent nothing' }; v = L.verdict(r); ck('Retry not re-sending the identical recording → FAILED', v.run === 'FAILED' && /Retry/.test(v.failures.join()), v);
  r = good(); r.switch_off = { verified: false, detail: 'still on' }; v = L.verdict(r); ck('switch not confirmed off → FAILED', v.run === 'FAILED' && /NOT confirmed off/.test(v.failures.join()), v);
  r = good(); r.cleanup = { ok: false, problems: ['1 entry left over'] }; v = L.verdict(r); ck('clean-up not equal to before → FAILED', v.run === 'FAILED' && /left over/.test(v.failures.join()), v);
  r = good(); r.part2.scope_problem = "this run's recorded tries: 7, expected 6"; v = L.verdict(r); ck('an unexpected extra try in this run\'s window → FAILED', v.run === 'FAILED', v);
  r = good(); r.part2.cases[0].collected = false; r.part2.cases[0].error = 'no answer in 40 s'; v = L.verdict(r); ck('a case with no server answer → INCOMPLETE', v.run === 'INCOMPLETE', v);
  r = good(); r.part2.real = [{}]; v = L.verdict(r); ck('missing real-recording tries → INCOMPLETE', v.run === 'INCOMPLETE', v);
  // The reviewer's controlled result: it printed "Completed", exit 0.
  r = good(); r.part1.samples[0].original_unchanged = false; r.part1.samples[1].whisper_kn = null; r.part1.export_ok = false;
  r.part2.cases[0].quality = 'FAIL'; r.part2.cases[3].retry = { identical: false }; r.switch_off = { verified: false, detail: 'x' }; r.cleanup = { ok: false, problems: ['totals differ'] };
  v = L.verdict(r); ck('the reviewer\'s controlled bad result → FAILED, exit 1 (was "Completed", 0)', v.run === 'FAILED' && v.exitCode === 1 && v.failures.length >= 4, v);
  v = L.verdict({ blocked: 'missing secrets' }); ck('BLOCKED → exit 3', v.run === 'BLOCKED' && v.exitCode === 3);

  console.log('\n[9] Fixes-2t: the 2s review\'s exact examples');
  // Gap 2: a preview timeout after transcription (the reviewer's S1 fields verbatim).
  r = good(); r.part2.cases[0] = { id: 'S1', collected: true, status: 200, transcript: '2 idli, 1 bowl sambar, weight 82.5 kg', error: 'Waiting for preview Save card failed: timeout after 90000ms' };
  v = L.verdict(r); ck('S1 with a preview timeout after transcription (collected=true, error set) → NOT COMPLETE (was COMPLETE, 0)', v.run !== 'COMPLETE' && v.exitCode === 1 && /S1: Waiting for preview/.test(v.incomplete.join()), v);
  r = good(); r.part2.cases[0] = { ...saved('S1'), transcribed: true, error: 'the preview appeared but its data was not captured' }; v = L.verdict(r);
  ck('an error at any later stage keeps the run from COMPLETE, even with other fields filled', v.run !== 'COMPLETE', v);
  r = good(); delete r.part2.cases[0].quality; v = L.verdict(r); ck('no quality judgement → INCOMPLETE', v.run === 'INCOMPLETE' && /no quality judgement/.test(v.incomplete.join()), v);
  r = good(); delete r.part2.cases[0].readback; v = L.verdict(r); ck('saved but not read back → INCOMPLETE', v.run === 'INCOMPLETE' && /no read-back/.test(v.incomplete.join()), v);
  r = good(); delete r.part2.cases[4].no_save_verified; v = L.verdict(r); ck('not saved and not verified that nothing was saved → INCOMPLETE', v.run === 'INCOMPLETE' && /not verified that nothing was saved/.test(v.incomplete.join()), v);
  r = good(); r.part2.cases[4].no_save_verified = false; r.part2.cases[4].no_save_detail = ['added Idli']; v = L.verdict(r); ck('the day changed although nothing was saved → FAILED', v.run === 'FAILED' && /added Idli/.test(v.failures.join()), v);
  r = good(); r.part2.cases.splice(1, 1); v = L.verdict(r); ck('a missing case (S2) → INCOMPLETE', v.run === 'INCOMPLETE' && /S2: case missing/.test(v.incomplete.join()), v);
  r = good(); r.part2.cases[3] = { ...r.part2.cases[3], status: 502, outcome: 'error', rejected: null }; v = L.verdict(r);
  ck('an HTTP 502 is a provider error, not a refusal → INCOMPLETE (never counted as the expected silence refusal)', v.run === 'INCOMPLETE' && /HTTP 502/.test(v.incomplete.join()), v);
  r = good(); r.part2.cases[3] = { ...r.part2.cases[3], status: 200, outcome: 'error', rejected: null }; v = L.verdict(r);
  ck('a 200 with no words and no reason is also an error, not a refusal', v.run === 'INCOMPLETE' && /without a reason/.test(v.incomplete.join()), v);
  r = good(); delete r.part2.cases[3].retry; v = L.verdict(r); ck('the expected Retry never exercised → INCOMPLETE', v.run === 'INCOMPLETE' && /Retry not exercised/.test(v.incomplete.join()), v);
  r = good(); r.part2.real[1] = { phrase_id: 'k01', voice_language: 'en-IN', status: 502 }; v = L.verdict(r); ck('a real-recording try answered with HTTP 502 → INCOMPLETE (not a refusal)', v.run === 'INCOMPLETE' && /HTTP 502/.test(v.incomplete.join()), v);
  // Gap 1: unapproved recordings re-run.
  r = good(); r.part1.unapproved_touched = ['f01 (id 3)', 'k03 (id 4)']; v = L.verdict(r); ck('re-runs on unapproved recordings (f01, other-day k03) → FAILED', v.run === 'FAILED' && /f01/.test(v.failures.join()) && /k03/.test(v.failures.join()), v);
  // Gap 3: everything Save would apply.
  const s1 = { foods: [{ name: 'Idli', qty_text: '2 idli' }, { name: 'Sambar', qty_text: '1 bowl' }], weight_kg: 82.5 };
  let e = L.evaluatePreview(S.S1.expect, { ...s1, water_ml_add: 1000 });
  ck('correct S1 foods and 82.5 kg plus an unspoken water_ml_add 1000 → FAIL (was PASS)', e.result === 'FAIL' && /water \+1000 ml/.test(e.reasons.join()), e);
  ck('…and without the water → PASS', L.evaluatePreview(S.S1.expect, { ...s1, water_ml_add: null, activities: [], acv: [], supplements: [], corrections: [], workouts: [], sleep: null, notes: '', reply: 'ok', totals: { cal: 1 } }).result === 'PASS');
  for (const [k, v2] of [['sleep', { bedtime: '22:30' }], ['activities', [{ id: 'walk' }]], ['acv', [{ id: 'acv1' }]], ['supplements', [{ id: 'b12' }]], ['corrections', [{ name: 'Idli', grams: 120 }]], ['workouts', [{ name: 'Squat' }]], ['notes', 'felt tired'], ['sent_to_coach', true], ['draft_edit', { id: 1 }]]) {
    e = L.evaluatePreview(S.S1.expect, { ...s1, [k]: v2 }); ck(`an unspoken ${k} in the preview → FAIL, not saved`, e.result === 'FAIL', e);
  }
  e = L.evaluatePreview(S.S1.expect, { ...s1, body_fat: 22 }); ck('a field the robot does not recognise → UNVERIFIED, not saved', e.result === 'UNVERIFIED' && /body_fat/.test(e.reasons.join()), e);
  e = L.evaluatePreview(S.S1.expect, { ...s1, unresolved_foods: [{ name: 'chutney' }] }); ck('something heard but not included → UNVERIFIED', e.result === 'UNVERIFIED', e);
  const base0 = { food_items: [], weight_kg: 81, water_ml: 0, sleep: {}, activities: {}, acv: {}, supplements: {}, notes: '' };
  let c2 = L.verifyCleanup(base0, { ...base0, water_ml: 1000 }); ck('baseline water 0 vs final water 1000 → clean-up FAILED (was ok)', !c2.ok && /water_ml/.test(c2.problems.join()), c2);
  const plan2 = L.planCleanup(base0, { ...base0, water_ml: 1000, notes: 'x', sleep: { bedtime: '22:30' } }, []);
  ck('the day written back restores water, notes and sleep to the baseline', plan2.water_ml === 0 && plan2.notes === '' && JSON.stringify(plan2.sleep) === '{}', plan2);
  for (const k of ['sleep', 'activities', 'acv', 'supplements']) { c2 = L.verifyCleanup(base0, { ...base0, [k]: { x: true } }); ck(`a changed ${k} → clean-up FAILED`, !c2.ok, c2); }
  // Count-aware clean-up for entries without ids (the reviewer's two cases).
  const X0 = { name: 'Dal', qty_text: '1 katori', grams: 150 };
  const plan3 = L.planCleanup({ ...base0, food_items: [X0] }, { ...base0, food_items: [X0, { ...X0 }] }, [L.itemKey(X0)]);
  ck('one earlier entry plus one identical new entry → only the new one removed, the earlier kept (was: both removed)', plan3.food_items.length === 1 && plan3.removed === 1, plan3);
  c2 = L.verifyCleanup({ ...base0, food_items: [X0, { ...X0 }] }, { ...base0, food_items: [X0] });
  ck('baseline with two identical entries, final day with one → the missing entry reported (was: ok)', !c2.ok && /1 entry from before the run/.test(c2.problems.join()), c2);
  c2 = L.verifyCleanup({ ...base0, food_items: [X0] }, { ...base0, food_items: [X0, { ...X0 }] });
  ck('baseline one, final two identical → the extra entry reported', !c2.ok && /left over/.test(c2.problems.join()), c2);
  ck('missingEntries counts duplicates', L.missingEntries([X0, X0, X0], [X0]).length === 2 && L.missingEntries([X0], [X0, X0]).length === 0);
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

console.log('\n[10] Fixes-2u: the first real run\'s exact problems (21 Oct, run 39560221828 #2)');
{
  const { createRequire } = await import('module');
  const SP = createRequire(import.meta.url)('../services/speechPresence');
  const S = (id) => L.CASES.find(c => c.id === id);
  // ── Blank sleep: only the exact template counts as empty ──
  const before = L.daySnapshot({ food_items: [], sleep: {} });
  const after = L.daySnapshot({ food_items: [], sleep: { bedtime: '', quality: 0, waketime: '' } });
  ck('first run S1: sleep {} → {bedtime:"",quality:0,waketime:""} is no change (the app\'s blank template)', L.changedFields(before, after).length === 0, L.changedFields(before, after));
  ck('…the raw values are kept and the report explains the rule', before.sleep_raw && after.sleep_raw.quality === 0 && /blank template/.test(L.sleepNormalisation(before, after) || ''), L.sleepNormalisation(before, after));
  ck('…and the same save now reads back PASS (items right, nothing unrelated changed)', L.readbackResult(S('S1').expect, { created: [{ name: 'Idli', qty_text: '2 pieces', grams: 80 }, { name: 'Sambar', qty_text: '1 bowl', grams: 150 }], weight_kg: 82.5, lost: [], unrelated: L.changedFields(before, after, { except: ['weight_kg'] }) }).result === 'PASS');
  const changedTo = (sl) => L.changedFields(before, L.daySnapshot({ food_items: [], sleep: sl }));
  ck('a real bedtime is a change', changedTo({ bedtime: '22:30', waketime: '', quality: 0 }).length === 1);
  ck('a non-zero quality is a change', changedTo({ bedtime: '', waketime: '', quality: 3 }).length === 1);
  ck('an extra field next to the template is a change', changedTo({ bedtime: '', waketime: '', quality: 0, naps: 1 }).length === 1);
  ck('a zero elsewhere (activities {walk: 0}) is still a change', L.changedFields(before, L.daySnapshot({ food_items: [], sleep: {}, activities: { walk: 0 } })).length === 1);
  ck('clean-up writes sleep back exactly as it was (template stays template)', JSON.stringify(L.planCleanup({ food_items: [], sleep: { bedtime: '', waketime: '', quality: 0 } }, { food_items: [] }, []).sleep) === JSON.stringify({ bedtime: '', waketime: '', quality: 0 }));
  // ── Read-back: two different failures, reported apart ──
  const saved = (id, rb) => ({ id, collected: true, transcribed: true, status: 200, outcome: 'preview', transcript: 'x', quality: 'PASS', saved: true, save_confirmed: true, readback: rb });
  const good = () => ({ part1: { approved_count: 2, export_ok: true, unapproved_touched: [], samples: [{ phrase_id: 'k01', original_unchanged: true, whisper_kn: { text: '' } }, { phrase_id: 'k02', original_unchanged: true, whisper_kn: { text: 'y' } }] },
    part2: { collected: true, real: [1, 2, 3, 4].map(() => ({ phrase_id: 'k01', voice_language: 'kn-IN', status: 200, transcript: 'x' })), cases: [saved('S1', { result: 'PASS', reasons: [] }), saved('S2', { result: 'PASS', reasons: [] }), saved('S3', { result: 'PASS', reasons: [] }),
      { id: 'S4', collected: true, transcribed: true, status: 200, outcome: 'refused', rejected: 'no_speech_detected', quality: 'PASS', retry: { identical: true }, no_save_verified: true },
      { id: 'S5', collected: true, transcribed: true, status: 200, outcome: 'refused', rejected: 'no_speech_detected', quality: 'PASS', no_save_verified: true }] },
    cleanup: { ok: true, problems: [] }, switch_off: { verified: true }, errors: [] });
  ck('an EMPTY pilot answer (k01 \'\') is evidence of a recognition failure, not missing collection → COMPLETE', L.verdict(good()).run === 'COMPLETE', L.verdict(good()));
  let r = good(); r.part2.cases[0].readback = L.readbackResult(S('S1').expect, { created: [{ name: 'Idli', qty_text: '1 piece', grams: 40 }, { name: 'Sambar', qty_text: '1 bowl', grams: 150 }], weight_kg: 82.5 });
  let v = L.verdict(r); ck('saved items differ from the preview → "saved items differ" (FAILED)', v.run === 'FAILED' && /S1: saved items differ from their preview/.test(v.failures.join()) && !/unrelated/.test(v.failures.join()), v.failures);
  r = good(); r.part2.cases[0].readback = L.readbackResult(S('S1').expect, { created: [{ name: 'Idli', qty_text: '2 pieces', grams: 80 }, { name: 'Sambar', qty_text: '1 bowl', grams: 150 }], weight_kg: 82.5, unrelated: ['water_ml 0 → 1000'] });
  v = L.verdict(r); ck('an unrelated field changed → "an unrelated day field changed" (FAILED), not "items differ"', v.run === 'FAILED' && /S1: an unrelated day field changed \(water_ml 0 → 1000\)/.test(v.failures.join()) && !/items differ/.test(v.failures.join()), v.failures);
  // ── Chat-only reply (first run S4) ──
  const j = L.judgeChatReply(S('S4'));
  ck('S4 accepted then answered in chat → quality FAIL, and a chat reply is not a refusal', j.result === 'FAIL' && /not a refusal/.test(j.reasons.join()), j);
  ck('a case that expected a preview but got a chat reply → FAIL', L.judgeChatReply(S('S1')).result === 'FAIL');
  const chat = { id: 'S4', collected: true, transcribed: true, status: 200, outcome: 'chat_reply', transcript: 'Transcription by ESO. Translation by —', reply: 'Nothing new to log there — it may already be in today\'s log.', quality: 'FAIL', quality_reasons: j.reasons, no_save_verified: true };
  r = good(); r.part2.cases[3] = chat; v = L.verdict(r);
  ck('a recorded chat reply with the day verified unchanged → collected (COMPLETE), quality FAIL kept', v.run === 'COMPLETE', v);
  r = good(); r.part2.cases[3] = { ...chat, no_save_verified: undefined }; v = L.verdict(r);
  ck('…without the no-save check → INCOMPLETE', v.run === 'INCOMPLETE' && /S4: not verified that nothing was saved/.test(v.incomplete.join()), v);
  r = good(); r.part2.cases[3] = { ...chat, reply: null }; v = L.verdict(r);
  ck('…with the reply not recorded → INCOMPLETE', v.run === 'INCOMPLETE' && /chat reply was not recorded/.test(v.incomplete.join()), v);
  r = good(); r.part2.cases[3] = { id: 'S4', collected: true, transcribed: true, status: 200, outcome: 'preview', transcript: 'x', error: 'the AI answer failed (HTTP 502)' }; v = L.verdict(r);
  ck('an AI answer that failed (HTTP 502) is an error → INCOMPLETE, never a chat-only outcome', v.run === 'INCOMPLETE' && /HTTP 502/.test(v.incomplete.join()), v);
  r = good(); r.part2.cases[3] = { id: 'S4', collected: true, transcribed: true, status: 200, outcome: 'preview', transcript: 'x', error: 'the transcript was accepted but the AI gave no answer within 60 s' }; v = L.verdict(r);
  ck('an unfinished AI answer (timeout) → INCOMPLETE', v.run === 'INCOMPLETE', v);
  // ── INVALID capture ──
  r = good(); r.part2.cases[4] = { id: 'S5', invalid: true, invalid_reasons: ['attempt 1: the recording does not follow the source sound', 'attempt 2: the recording does not follow the source sound'], attempts: [{}, {}] }; v = L.verdict(r);
  ck('an INVALID capture on every attempt → INCOMPLETE, excluded from quality, never a pass', v.run === 'INCOMPLETE' && /S5: capture INVALID on every attempt/.test(v.incomplete.join()) && /not counted/.test(v.incomplete.join()), v);
  // ── Captured audio against the source (decoded, not bytes) ──
  const F = (f) => fs.readFileSync(path.join(HERE, 'fixtures/voice', f));
  const meas = async (buf) => { const pcm = await SP.decode(buf); const sp = SP.analyse(pcm); return { pcm, env: L.envelopeDb(pcm), duration_ms: sp.duration_ms, speech: sp }; };
  const src = await meas(F('speech-en.webm'));
  const fromPcm = (pcm) => { const sp = SP.analyse(pcm); return { env: L.envelopeDb(pcm), duration_ms: sp.duration_ms, speech: sp }; };
  let c = L.captureCheck({ source: src, captured: src, kind: 'speech' });
  ck('the same sound captured → valid', c.valid && c.correlation > 0.95, c);
  const shifted = new Int16Array(src.pcm.length + 4800); for (let i = 0; i < src.pcm.length; i++) shifted[i + 4800] = Math.round(src.pcm[i] * 0.3);
  c = L.captureCheck({ source: src, captured: fromPcm(shifted), kind: 'speech' });
  ck('captured 300 ms late and 10 dB quieter (a real recorder) → valid, lag 300 ms', c.valid && c.lag_ms === 300, c);
  c = L.captureCheck({ source: src, captured: await meas(F('silence-digital.webm')), kind: 'speech' });
  ck('first run S5: speech played, silence captured → INVALID', !c.valid && /does not follow/.test(c.reasons.join()), c);
  c = L.captureCheck({ source: src, captured: await meas(F('speech-hi.webm')), kind: 'speech' });
  ck('a DIFFERENT speech captured (plausible length, nonzero volume, other hash) → INVALID', !c.valid, c);
  c = L.captureCheck({ source: src, captured: await meas(F('noise-loud-pink.webm')), kind: 'speech' });
  ck('loud noise captured instead of the speech (sounding throughout, so only the envelope match can tell) → INVALID', !c.valid && /does not follow/.test(c.reasons.join()), c);
  const half = new Int16Array(src.pcm.length); half.set(src.pcm.subarray(0, Math.floor(src.pcm.length * 0.4)));
  c = L.captureCheck({ source: src, captured: fromPcm(half), kind: 'speech' });
  ck('a recording that lost the second half of the sound → INVALID', !c.valid, c);
  c = L.captureCheck({ source: await meas(F('silence-digital.webm')), captured: await meas(F('silence-digital.webm')), kind: 'silence' });
  ck('silence played, silence captured → valid', c.valid, c);
  c = L.captureCheck({ source: await meas(F('silence-digital.webm')), captured: src, kind: 'silence' });
  ck('silence played but sound captured → INVALID', !c.valid, c);
  const noisySrc = await meas(F('speech-under-loud-noise.webm'));
  c = L.captureCheck({ source: noisySrc, captured: noisySrc, kind: 'noisy' });
  ck('the noisy S5 sound captured as played → valid (it followed the source; whether speech is heard is the server\'s question)', c.valid, c);
  // ── The dal portion rule (S3) ──
  const S3 = S('S3').expect;
  const pv = (dal) => ({ foods: [{ name: 'Chapati', qty_text: '2 pieces', grams: 60 }, { name: 'Dal', ...dal }] });
  let e = L.evaluatePreview(S3, pv({ qty_text: '1 bowl', grams: 150 }));
  ck('first run S3: "1 katori dal" shown as "1 bowl (150 g)" → PASS by the dal rule, with the wording and grams in a note', e.result === 'PASS' && /said "1 katori", shown "1 bowl" at 150 g/.test(e.notes.join()) && /not a measurement/.test(e.notes.join()), e);
  e = L.evaluatePreview(S3, pv({ qty_text: '1 bowl', grams: 200 }));
  ck('the same words at a different amount (200 g) → FAIL', e.result === 'FAIL' && /200 g, not 150 g/.test(e.reasons.join()), e);
  e = L.evaluatePreview(S3, pv({ qty_text: '2 bowls', grams: 300 }));
  ck('one katori vs two bowls → still FAIL (count)', e.result === 'FAIL' && /dal: 2 instead of 1/.test(e.reasons.join()), e);
  e = L.evaluatePreview(S3, pv({ qty_text: '1 bowl' }));
  ck('shown as a bowl with no grams → UNVERIFIED', e.result === 'UNVERIFIED', e);
  e = L.evaluatePreview({ foods: [{ key: 'sambar', re: /sambar/i, n: 1, unit: 'katori' }], weight: null }, { foods: [{ name: 'Sambar', qty_text: '1 bowl', grams: 150 }] });
  ck('katori vs bowl for a food with no mapping (sambar) → UNVERIFIED, not a pass', e.result === 'UNVERIFIED' && /no portion rule/.test(e.reasons.join()), e);
  e = L.evaluatePreview(S('S1').expect, { foods: [{ name: 'Idli', qty_text: '2 pieces', grams: 80 }, { name: 'Sambar', qty_text: '1 cup', grams: 150 }], weight_kg: 82.5 });
  ck('a cup is still not a bowl (outside the family) → FAIL', e.result === 'FAIL', e);
  e = L.evaluatePreview(S3, pv({ qty_text: '1 bowl', grams: 200 }), { portions: [{ phrase: 'bowl dal', grams: 200 }] });
  ck('the member\'s own learned "bowl dal" = 200 g comes first → 1 bowl at 200 g PASS (member basis named)', e.result === 'PASS' && /member's own 200 g/.test(e.notes.join()), e);
  e = L.evaluatePreview(S3, pv({ qty_text: '1 bowl', grams: 150 }), { portions: [{ phrase: 'katori dal', grams: 120 }] });
  ck('…and the 150 g default does not override a member\'s 120 g katori → FAIL', e.result === 'FAIL', e);
  e = L.evaluatePreview(S3, pv({ qty_text: '1 bowl', grams: 150 }), { portions: [{ phrase: 'bowl rice', grams: 200 }] });
  ck('a learned portion for another food does not apply → the default 150 g decides (PASS)', e.result === 'PASS', e);
  // ── Names ──
  const names = L.nameList(['Krishna Jinka', 'Avinash', 'Pradeep', 'Voice Robot', 'Test', ''], 'Voice Robot');
  const red = L.redactNames('Invited: Avinash, KRISHNA JINKA, Pradeep. This is a test.', names);
  ck('member names replaced (several-word names in any case); the robot\'s own name and the word "test" left alone', red.hits === 3 && !/Avinash|Krishna|Pradeep/i.test(red.text) && /This is a test/.test(red.text) && !names.includes('Voice Robot'), red);
}

console.log(`\nVoice evidence robot checks: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
