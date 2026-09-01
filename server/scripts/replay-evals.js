#!/usr/bin/env node
/**
 * replay-evals.js — score a prompt change against real member corrections.
 *
 * WHAT THIS IS FOR
 * ----------------
 * Every prompt change in this app has been a guess. We reword something, it
 * feels better, we ship, and nothing tells us whether it broke three other
 * things. This replays every correction a member or coach has ever made
 * through the CURRENT prompt and reports what got fixed and what got broken.
 *
 *   cd server && node scripts/replay-evals.js --dry-run    # plan, no API calls
 *   cd server && node scripts/replay-evals.js              # run and score
 *   cd server && node scripts/replay-evals.js --save       # run and set the baseline
 *
 * DELIBERATELY NOT IN `npm test`
 * ------------------------------
 * It makes real API calls: it costs money and takes minutes. A gate step that
 * costs money on every commit gets switched off, and a gate step that skips
 * itself silently is worse than no gate at all — test-weekly-report printed a
 * green tick for months while asserting nothing. The wiring around this tool is
 * covered by `test-evals.js`, which runs in the gate and calls no model.
 *
 * FLAGS
 *   --dry-run           count what would run, make no API calls, spend nothing
 *   --save              write .eval-baseline.json so the next run can compare
 *   --limit N           only the N most recent samples
 *   --source X          member_parse | coach_parse
 *   --field X           grams | food_name | meal | ops
 *   --with-portions     feed the member's learned portions into the prompt
 *   --delay MS          pause between calls (default 400)
 *
 * ON --with-portions
 * ------------------
 * Off by default, and that is a real decision rather than laziness. The
 * correction that created a sample also updated that member's portion memory.
 * Replay with portions on and the model may get "2 roti" right because it was
 * handed the answer, not because the prompt improved — the score would drift
 * upward on its own with nobody touching a prompt. Off measures the PROMPT.
 * On measures the LIVE SYSTEM. Both are useful; they are not the same number,
 * so the mode is printed in the header and stored in the baseline, and a run
 * in one mode never compares itself against a baseline from the other.
 */

const path = require('path');
const fs   = require('fs');

const pool = require('../db/pool');
const ai   = require('../routes/aiChat');

const BASELINE_PATH = path.join(__dirname, '.eval-baseline.json');

// ── Args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has  = (f) => argv.includes(f);
const val  = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const DRY_RUN       = has('--dry-run');
const SAVE          = has('--save');
const WITH_PORTIONS = has('--with-portions');
const LIMIT         = Math.max(1, parseInt(val('--limit', '500')) || 500);
const DELAY_MS      = Math.max(0, parseInt(val('--delay', '400')) || 0);
const ONLY_SOURCE   = val('--source', null);
const ONLY_FIELD    = val('--field', null);
const MODE          = WITH_PORTIONS ? 'with-portions' : 'prompt-only';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Structural comparison ────────────────────────────────────────────────────
// Compare meaning, not strings. "Dal (Toor) 248g" and "dal 250g" are the same
// answer; a string compare would call that a regression and the score would be
// noise. Grams within 5%, meal slot exact, food name case-insensitive.

const GRAMS_TOLERANCE = 0.05;

/** "Dal (Toor)" -> "dal". Drops the parenthetical the food DB appends. */
function normName(n) {
  return String(n || '').toLowerCase().replace(/\s*\(.*$/, '').replace(/\s+/g, ' ').trim();
}

/** Find the model's version of a food by name — exact, then either-way substring. */
function findFood(foods, name) {
  const want = normName(name);
  if (!want) return null;
  const list = Array.isArray(foods) ? foods : [];
  return list.find(f => normName(f.name) === want)
      || list.find(f => normName(f.name).includes(want) || want.includes(normName(f.name)))
      || null;
}

function gramsMatch(actual, expected) {
  const a = Number(actual), e = Number(expected);
  if (!Number.isFinite(a) || !Number.isFinite(e) || e <= 0) return false;
  return Math.abs(a - e) / e <= GRAMS_TOLERANCE;
}

/**
 * Did the current model get this sample right?
 * Returns { pass, detail } — detail is what to print when it did not.
 */
function scoreMemberSample(sample, parsed) {
  const foods = Array.isArray(parsed?.foods) ? parsed.foods : [];
  const corrected = sample.corrected;
  const aiOutput  = sample.ai_output;

  // The member unticked an item: the model invented a food. Passing means the
  // model no longer returns it at all.
  if (sample.field === 'food_name' || corrected === null) {
    const still = findFood(foods, aiOutput?.name);
    return still
      ? { pass: false, detail: `still invents "${still.name}"` }
      : { pass: true,  detail: `no longer invents "${aiOutput?.name}"` };
  }

  const got = findFood(foods, corrected.name);
  if (!got) return { pass: false, detail: `did not return "${corrected.name}" at all` };

  if (sample.field === 'meal') {
    const ok = String(got.meal || '') === String(corrected.meal || '');
    return { pass: ok, detail: ok ? '' : `meal ${got.meal || '—'}, expected ${corrected.meal || '—'}` };
  }

  // Default: portion.
  const ok = gramsMatch(got.grams, corrected.grams);
  return { pass: ok, detail: ok ? '' : `${got.grams}g, expected ${corrected.grams}g` };
}

/**
 * Coach samples record which proposed actions the coach switched OFF. Passing
 * means the model now proposes exactly the set that was kept — same members,
 * same operation keys. Op VALUES are not compared: "water 4L" vs "water 4000ml"
 * is the same instruction and this is a wiring check, not a units check.
 */
function actionKey(a) {
  const ops = a?.ops && typeof a.ops === 'object' ? Object.keys(a.ops).sort().join(',') : '';
  return `${String(a?.member_name || '').toLowerCase()}|${a?.is_all ? 'all' : 'one'}|${ops}`;
}

function scoreCoachSample(sample, parsed) {
  const want = new Set((sample.corrected || []).map(actionKey));
  const got  = new Set((Array.isArray(parsed?.actions) ? parsed.actions : []).map(a =>
    actionKey({ member_name: a.member_name, is_all: a.is_all, ops: a.ops })));
  const missing = [...want].filter(k => !got.has(k));
  const extra   = [...got].filter(k => !want.has(k));
  if (!missing.length && !extra.length) return { pass: true, detail: '' };
  return {
    pass: false,
    detail: [missing.length && `missing ${missing.length}`,
             extra.length   && `${extra.length} unwanted`].filter(Boolean).join(', '),
  };
}

// ── Prompt inputs ────────────────────────────────────────────────────────────
// The protocol context a member had at the time is not stored — only the
// message and the answer. A neutral context is used instead, which is honest
// for what these samples test: portions and invented items do not depend on
// which supplements someone is ticking.
const NEUTRAL_CTX = {
  mealSlots: ['Breakfast', 'Lunch', 'Snack', 'Dinner'],
  activities: [], acv: [], supplements: [],
  waterTargetMl: 3000, recent: [], lastFoods: [],
};

function parseModelJSON(raw) {
  const t = String(raw || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(t);
}

async function loadPortionsFor(patientId) {
  if (!WITH_PORTIONS || !patientId) return [];
  const { rows } = await pool.query(
    `SELECT phrase, grams, samples FROM member_portions
      WHERE patient_id = $1 ORDER BY samples DESC, updated_at DESC LIMIT 40`,
    [patientId]
  );
  return rows.map(r => ({ phrase: r.phrase, grams: Math.round(r.grams), samples: r.samples }));
}

async function coachRosterFor(coachId) {
  const { rows } = await pool.query(
    `SELECT u.id, u.name FROM users u
       JOIN monitor_patients mp ON mp.patient_id = u.id AND mp.active = true
      WHERE mp.monitor_id = $1 AND u.role = 'patient' AND u.active = true
      ORDER BY u.name`,
    [coachId]
  );
  return rows;
}

// ── Baseline ─────────────────────────────────────────────────────────────────
function readBaseline() {
  try {
    const b = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
    return (b && typeof b === 'object' && b.results) ? b : null;
  } catch { return null; }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const where  = ['dismissed = false', "source <> 'photo'"];
  const params = [];
  if (ONLY_SOURCE) { params.push(ONLY_SOURCE); where.push(`source = $${params.length}`); }
  if (ONLY_FIELD)  { params.push(ONLY_FIELD);  where.push(`field  = $${params.length}`); }
  params.push(LIMIT);

  const { rows: samples } = await pool.query(
    `SELECT id, patient_id, source, message, ai_output, corrected, field, created_at
       FROM ai_parse_samples
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length}`,
    params
  );

  // Photo samples are excluded above, deliberately and out loud. Replaying
  // "photo attached" through a text prompt would produce a confident score for
  // a question the model was never asked.
  const { rows: skipped } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM ai_parse_samples
      WHERE dismissed = false AND source = 'photo'`
  );

  console.log('');
  console.log('  FitLife — eval replay');
  console.log(`  mode      : ${MODE}`);
  console.log(`  samples   : ${samples.length}${ONLY_SOURCE ? ` (source=${ONLY_SOURCE})` : ''}${ONLY_FIELD ? ` (field=${ONLY_FIELD})` : ''}`);
  if (skipped[0]?.n) {
    console.log(`  skipped   : ${skipped[0].n} photo samples — no replayable text`);
  }

  if (!samples.length) {
    console.log('\n  Nothing to replay. Samples appear as members correct the AI.\n');
    return 0;
  }

  const baseline = readBaseline();
  if (baseline && baseline.mode !== MODE) {
    console.log(`  baseline  : ignored — recorded in "${baseline.mode}" mode, not comparable`);
  } else if (baseline) {
    console.log(`  baseline  : ${baseline.results.length} samples from ${baseline.ran_at}`);
  } else {
    console.log('  baseline  : none yet — run with --save to set one');
  }

  console.log(`  API calls : ${samples.length}  (~${Math.ceil(samples.length * (DELAY_MS + 1500) / 60000)} min)`);

  if (DRY_RUN) {
    console.log('\n  --dry-run: stopping here. No API calls made, nothing spent.\n');
    return 0;
  }
  console.log('');

  const results = [];
  let pass = 0, fail = 0, errored = 0;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    let outcome;
    try {
      if (s.source === 'coach_parse') {
        const members = await coachRosterFor(s.patient_id);
        if (!members.length) {
          outcome = { pass: null, detail: 'coach has no active members — cannot replay' };
        } else {
          const { text } = await ai.callAI(ai.buildCoachPrompt(s.message, members, [], null, []));
          outcome = scoreCoachSample(s, parseModelJSON(text));
        }
      } else {
        const portions = await loadPortionsFor(s.patient_id);
        const { text } = await ai.callAI(ai.buildParsePrompt(s.message, NEUTRAL_CTX, portions));
        outcome = scoreMemberSample(s, parseModelJSON(text));
      }
    } catch (err) {
      outcome = { pass: null, detail: `error: ${err.message.slice(0, 80)}` };
    }

    if (outcome.pass === true)  pass++;
    else if (outcome.pass === false) fail++;
    else errored++;

    results.push({ id: s.id, pass: outcome.pass, detail: outcome.detail,
                   message: s.message, field: s.field, source: s.source });

    const mark = outcome.pass === true ? '✓' : outcome.pass === false ? '✗' : '·';
    process.stdout.write(`\r  ${mark} ${i + 1}/${samples.length}   `);
    if (DELAY_MS) await sleep(DELAY_MS);
  }
  process.stdout.write('\r' + ' '.repeat(40) + '\r');

  // ── Compare against the previous run ───────────────────────────────────────
  const comparable = baseline && baseline.mode === MODE ? baseline : null;
  const prev = new Map((comparable?.results || []).map(r => [r.id, r.pass]));

  const fixed       = results.filter(r => r.pass === true  && prev.get(r.id) === false);
  const newlyBroken = results.filter(r => r.pass === false && prev.get(r.id) === true);
  const stillWrong  = results.filter(r => r.pass === false && prev.get(r.id) !== true);

  const pct = results.length ? Math.round((pass / (pass + fail || 1)) * 100) : 0;

  console.log(`  ${pass} correct · ${fail} wrong${errored ? ` · ${errored} could not be replayed` : ''}   (${pct}%)`);
  if (comparable) {
    const prevPass = comparable.results.filter(r => r.pass === true).length;
    const prevTot  = comparable.results.filter(r => r.pass !== null).length;
    const prevPct  = prevTot ? Math.round((prevPass / prevTot) * 100) : 0;
    console.log(`  previous run: ${prevPct}%  (${pct >= prevPct ? '+' : ''}${pct - prevPct} points)`);
  }
  console.log('');

  const show = (title, list) => {
    if (!list.length) return;
    console.log(`  ${title} (${list.length})`);
    for (const r of list.slice(0, 25)) {
      console.log(`    · "${String(r.message).slice(0, 60)}"${r.detail ? ` — ${r.detail}` : ''}`);
    }
    if (list.length > 25) console.log(`    … and ${list.length - 25} more`);
    console.log('');
  };

  if (comparable) {
    show('FIXED since the last run', fixed);
    show('NEWLY BROKEN since the last run', newlyBroken);
  }
  show('STILL WRONG', stillWrong);

  if (newlyBroken.length && comparable) {
    console.log(`  ⚠ ${newlyBroken.length} ${newlyBroken.length === 1 ? 'sample' : 'samples'} the previous prompt got right are now wrong.`);
    console.log('');
  }

  if (SAVE) {
    fs.writeFileSync(BASELINE_PATH, JSON.stringify({
      ran_at: new Date().toISOString(),
      mode: MODE,
      results: results.map(({ id, pass: p }) => ({ id, pass: p })),
    }, null, 2));
    console.log(`  Baseline written to ${path.relative(process.cwd(), BASELINE_PATH)}\n`);
  } else if (results.length) {
    console.log('  Not saved. Re-run with --save once you are happy with this prompt.\n');
  }

  return 0;
}

// The scoring logic is exported so `test-evals.js` can assert on it in the
// gate WITHOUT making a single API call. A comparison rule nobody tests is how
// you end up with a scoreboard that quietly rates every prompt 100%.
module.exports = { normName, findFood, gramsMatch, scoreMemberSample, scoreCoachSample, actionKey, GRAMS_TOLERANCE };

if (require.main === module) {
  main()
    .then(code => pool.end().then(() => process.exit(code)))
    .catch(err => {
      console.error('\nreplay-evals failed:', err.message);
      pool.end().then(() => process.exit(1));
    });
}
