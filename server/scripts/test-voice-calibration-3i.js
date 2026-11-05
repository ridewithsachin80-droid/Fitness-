/**
 * scripts/test-voice-calibration-3i.js — Fixes-3i (5 Nov 2026): the Kannada wording after the fluent speaker's review (R1).
 * R1 asked for the everyday words: k02 "upma" → "uppittu", k04 "katori" → "battalu", and said any spelling is fine, so the app
 * must recognise every common spelling (and Kannada script). Module-level, no database: the real script, scorer and preview judge.
 *
 *   [1] the lines: k02 and k04 carry the new words; Kannada gets a NEW hash, so a check recorded against the old hash
 *       (02dc7a808038…) no longer counts (the route confirms only when the stored hash equals scriptSha); Hindi and English
 *       hashes are byte-for-byte unchanged; the script and judge versions moved on; the older pilot (Kannada Voice Test) is untouched;
 *   [2] spellings: uppittu / uppitu / upittu / upitu / uppit / upma / Kannada script all score k02 correct; battalu / battlu /
 *       batalu / batlu / bataalu / Kannada script / katori all score k04's dal correct, "bowl" stays the accepted alias;
 *       negative controls: another food (poha) is not upma, and a cup or glass of dal is still a wrong unit;
 *   [3] the preview judge (rule 3) reads the same words: "Uppittu" and "1 battalu" in a parsed preview are correct.
 */
const C = require('../services/voiceCalibration');
const Pilot = require('../services/voicePilot');

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 500))); };
const OLD = { kn: '02dc7a808038d6ae886bc38086a0f8751fba4edabe34d754a2227ce1839b9250', hi: '21ef021a6c57d6e593691b83d01247e443d76cd3ef80ad23658214e4f499daff', en: '9bd51a13bb0664e0c0db584c1dc59c8f6b9df16305dea50c79f34782c2e6d948' };
const NEW_KN = '4087ba15e0a683b81a346f844d0f8dc2dd010637213bc3e8220a791ccd138fc0';
const sc = (id, text) => { const r = C.scoreTranscript(C.LINES[id].items, text, 'kn'); return { line: r.line, out: r.items.map(i => i.outcome).join(',') }; };

try {
  console.log('\n[1] the lines and their hashes');
  ck('k02 says "uppittu" (meaning and scored item follow); k04 says "battalu" (meaning and scored item follow)',
    C.LINES.k02.say === 'Breakfast-ge ondu plate uppittu, ondu cup coffee' && /uppittu \(upma\)/.test(C.LINES.k02.means) && C.LINES.k02.items[0].label === '1 plate uppittu' && C.LINES.k02.items[0].food === 'upma'
    && C.LINES.k04.say === 'Lunch-ge eradu chapati, ondu battalu dal mattu mosaru' && /battalu \(bowl\)/.test(C.LINES.k04.means) && C.LINES.k04.items[1].label === '1 battalu dal' && C.LINES.k04.items[1].unit === 'katori' && C.LINES.k04.items[1].unitAlias === 'bowl',
    [C.LINES.k02, C.LINES.k04]);
  ck('the other five Kannada lines are unchanged (k01, k06, k11, k13, sk1)', C.LINES.k01.say === 'Belagge eradu idli mattu ondu bowl sambar thinde' && C.LINES.k06.say === 'Ivattu mooru litre neeru kudide'
    && C.LINES.k11.say === 'Ivattu belagge nanna tooka eppattu eradu point aidu kg' && C.LINES.k13.say === 'Gym-alli squat mooru set, hattu reps maadide' && C.LINES.sk1.say === 'Eradu idli');
  ck(`Kannada has a NEW hash (${NEW_KN.slice(0, 12)}…), so a check recorded against the old ${OLD.kn.slice(0, 12)}… does not count`, C.scriptSha('kn') === NEW_KN && C.scriptSha('kn') !== OLD.kn, C.scriptSha('kn'));
  ck('Hindi and English hashes are unchanged (any confirmation of them stays valid)', C.scriptSha('hi') === OLD.hi && C.scriptSha('en') === OLD.en);
  ck('the script version moved to round1-script-v2 and the judge version to judge-3i.2 (3i.1 tightened the battalu spellings; earlier judgments are stale, never reused)', C.SCRIPT_VERSION === 'round1-script-v2' && C.JUDGE_VERSION === 'judge-3i.2');
  ck('the older pilot (Kannada Voice Test) is untouched: its k02 still says "upma" (its history and verdicts stay as they were)', Pilot.PHRASES ? Pilot.PHRASES.find(p => p.id === 'k02')?.say === 'Breakfast-ge ondu plate upma, ondu cup coffee' : /ondu plate upma, ondu cup coffee/.test(require('fs').readFileSync(require.resolve('../services/voicePilot'), 'utf8')));

  console.log('\n[2] any spelling is recognised');
  const UP = ['uppittu', 'uppitu', 'upittu', 'upitu', 'uppit', 'upma', 'upmaa', 'Uppittu', 'ಉಪ್ಪಿಟ್ಟು', 'ಉಪ್ಮಾ'];
  const upOut = UP.map(w => [w, sc('k02', `Breakfast-ge ondu plate ${w} ondu cup coffee`)]);
  ck(`k02: ${UP.join(' / ')} → all correct`, upOut.every(([, r]) => r.line === 'all correct' && r.out === 'correct,correct'), upOut);
  const BT = ['battalu', 'battlu', 'batalu', 'batlu', 'bataalu', 'Battalu', 'ಬಟ್ಟಲು', 'katori', 'katoris', 'ಕಟೋರಿ'];
  const btOut = BT.map(w => [w, sc('k04', `Lunch-ge eradu chapati ondu ${w} dal mattu mosaru`)]);
  ck(`k04: ${BT.join(' / ')} → all correct (the dal's container is right)`, btOut.every(([, r]) => r.line === 'all correct' && r.out === 'correct,correct,correct (no amount spoken)'), btOut);
  ck('k04 wholly in Kannada script ("ಎರಡು ಚಪಾತಿ ಒಂದು ಬಟ್ಟಲು ದಾಲ್ ಮತ್ತು ಮೊಸರು") → all correct', sc('k04', 'ಎರಡು ಚಪಾತಿ ಒಂದು ಬಟ್ಟಲು ದಾಲ್ ಮತ್ತು ಮೊಸರು').line === 'all correct', sc('k04', 'ಎರಡು ಚಪಾತಿ ಒಂದು ಬಟ್ಟಲು ದಾಲ್ ಮತ್ತು ಮೊಸರು'));
  ck('k04 "1 bowl dal" stays the accepted alias, as before', sc('k04', 'Lunch-ge eradu chapati ondu bowl dal mattu mosaru').out === 'correct,unit alias,correct (no amount spoken)' && sc('k04', 'Lunch-ge eradu chapati ondu bowl dal mattu mosaru').line === 'all correct');
  ck('negative control: "ondu plate poha" is NOT uppittu (the upma item is missing)', sc('k02', 'Breakfast-ge ondu plate poha ondu cup coffee').line !== 'all correct' && /^missing/.test(sc('k02', 'Breakfast-ge ondu plate poha ondu cup coffee').out), sc('k02', 'Breakfast-ge ondu plate poha ondu cup coffee'));
  ck('negative control: a cup or a glass of dal is still a wrong unit (battalu did not loosen the container check)', ['cup', 'glass'].every(u => sc('k04', `Lunch-ge eradu chapati ondu ${u} dal mattu mosaru`).line === 'wrong unit'));
  ck('negative control: the wrong amount ("eradu battalu dal") is still wrong', sc('k04', 'Lunch-ge eradu chapati eradu battalu dal mattu mosaru').line !== 'all correct', sc('k04', 'Lunch-ge eradu chapati eradu battalu dal mattu mosaru'));

  // Fixes-3i.1 (independent QA review): bare prefixes matched other words. These must NOT count as battalu, on any line.
  const L = (id, text) => C.scoreTranscript(C.LINES[id].items, text, C.LINES[id].lang).line;
  const notBowl = [['e02', 'Three chapati and one battle dal for lunch'], ['h01', 'Do roti aur ek batli dal khaya'], ['h01', 'Do roti aur ek bataliye dal khaya'], ['k04', 'Lunch-ge eradu chapati ondu battle dal mattu mosaru']].map(([id, t]) => [id, t, L(id, t)]);
  ck('negative control: "battle", "batli" (bottle), "bataliye" are NOT a battalu of dal (e02, h01, k04 not all correct)', notBowl.every(([, , r]) => r !== 'all correct'), notBowl);
  ck('negative control: Hindi "batlaya" (told) is not swallowed as a unit word: h02 with it is not "all correct"', L('h02', 'Subah ek glass doodh aur do ande khaye maine batlaya') !== 'all correct', L('h02', 'Subah ek glass doodh aur do ande khaye maine batlaya'));
  ck('…while battalalli ("in the bowl") still reads as battalu', sc('k04', 'Lunch-ge eradu chapati ondu battalalli dal mattu mosaru').line === 'all correct', sc('k04', 'Lunch-ge eradu chapati ondu battalalli dal mattu mosaru'));

  console.log('\n[3] the preview judge reads the same words');
  const P = (o) => ({ weight_kg: null, activities: [], acv: [], supplements: [], water_ml_add: null, sleep: null, foods: [], workouts: [], corrections: [], ...o });
  const j2 = C.judgePreview(C.LINES.k02.items, P({ foods: [{ name: 'Uppittu', qty_text: '1 plate', grams: 250 }, { name: 'Coffee', qty_text: '1 cup', grams: 150 }] }), 'kn');
  ck('k02 preview "Uppittu, 1 plate" + "Coffee, 1 cup" → correct reviewable', j2.result === 'correct reviewable', j2);
  const j2u = C.judgePreview(C.LINES.k02.items, P({ foods: [{ name: 'Upitu', qty_text: '1 plate', grams: 250 }, { name: 'Coffee', qty_text: '1 cup', grams: 150 }] }), 'kn');
  ck('k02 preview with a NEW spelling, "Upitu, 1 plate" → correct reviewable (3h: disqualifying)', j2u.result === 'correct reviewable', j2u);
  const j4 = C.judgePreview(C.LINES.k04.items, P({ foods: [{ name: 'Chapati', qty_text: '2 chapati', grams: 80 }, { name: 'Dal', qty_text: '1 battalu', grams: 150 }, { name: 'Curd', qty_text: 'curd', grams: null }] }), 'kn');
  const j4k = C.judgePreview(C.LINES.k04.items, P({ foods: [{ name: 'Chapati', qty_text: '2 chapati', grams: 80 }, { name: 'Dal', qty_text: '1 katori', grams: 150 }, { name: 'Curd', qty_text: 'curd', grams: null }] }), 'kn');
  ck('k04 preview "Dal, 1 battalu" is judged exactly as "Dal, 1 katori" (same result and outcomes), and the dal item itself is correct', j4.result === j4k.result && JSON.stringify(j4.items.map(i => i.outcome)) === JSON.stringify(j4k.items.map(i => i.outcome)) && j4.items[1].outcome === j4k.items[1].outcome && j4.items[1].outcome === 'correct', { battalu: j4, katori: j4k });
  const j4c = C.judgePreview(C.LINES.k04.items, P({ foods: [{ name: 'Chapati', qty_text: '2 chapati', grams: 80 }, { name: 'Dal', qty_text: '1 cup', grams: 150 }, { name: 'Curd', qty_text: 'curd', grams: null }] }), 'kn');
  ck('negative control: "Dal, 1 cup" in the preview is still not the battalu outcome', JSON.stringify(j4c.items.map(i => i.outcome)) !== JSON.stringify(j4.items.map(i => i.outcome)), { cup: j4c.items.map(i => i.outcome), battalu: j4.items.map(i => i.outcome) });
} catch (e) { ck('the suite ran to the end', false, e.stack); }
console.log(`\nVoice calibration 3i (Kannada wording after review): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
