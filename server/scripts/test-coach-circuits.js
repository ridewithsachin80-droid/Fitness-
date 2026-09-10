/**
 * scripts/test-coach-circuits.js — the coach's house circuits (Sprint 11d),
 * against real Postgres.
 *
 * Three guarantees:
 *   1. a coach can save, list, replace and delete circuits, scoped to themselves
 *   2. the coach-parse prompt carries them, exactly
 *   3. a program day that matches a circuit by name gets THAT circuit's
 *      exercises — even when the model ignored the instruction and built a
 *      generic day. The enforcement is server-side, not a hope.
 */
const express = require('express'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');
const pool = require('../db/pool');
const circuits = require('../services/circuits');

if (!/localhost/.test(process.env.DATABASE_URL || '')) { console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1); }

const app = express(); app.use(express.json()); app.use(cookieParser());
app.use((q, _r, n) => { q.io = { to: () => ({ emit: () => {} }) }; n(); });
app.use('/api/ai-chat', require('../middleware/auth'), require('../routes/aiChat'));

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n)) : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e === undefined ? '' : e).slice(0, 240))); };

(async () => {
  const SECRET = process.env.JWT_SECRET || 'local-test-secret';
  await pool.query(`DELETE FROM users WHERE email LIKE 'circuit-%'`);
  const { rows: [c1] } = await pool.query(`INSERT INTO users (name, email, password, role, active) VALUES ('Circuit Coach','circuit-a@x.test','x','monitor',true) RETURNING id`);
  const { rows: [c2] } = await pool.query(`INSERT INTO users (name, email, password, role, active) VALUES ('Other Coach','circuit-b@x.test','x','monitor',true) RETURNING id`);
  const tok  = jwt.sign({ id: c1.id, role: 'monitor', name: 'Circuit Coach' }, SECRET);
  const tok2 = jwt.sign({ id: c2.id, role: 'monitor', name: 'Other Coach' }, SECRET);
  const srv = app.listen(0); const port = srv.address().port;
  const call = async (method, path, token, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };

  console.log('\n[1] the text a coach types');
  const parsed = circuits.parseCircuitText('Bench press 4x8-12 chest\nIncline DB press 3 x 10\nCable fly 3×12-15\nPlank\n\n');
  ck('four lines → four exercises; blank lines ignored', parsed.length === 4, parsed.map(e => e.name));
  ck('"4x8-12 chest" → sets 4, reps 8–12, chest', parsed[0].sets === 4 && parsed[0].reps_min === 8 && parsed[0].reps_max === 12 && parsed[0].muscle_group === 'chest', parsed[0]);
  ck('"3 x 10" → 3 × 10–10; the × character works too', parsed[1].sets === 3 && parsed[1].reps_min === 10 && parsed[1].reps_max === 10 && parsed[2].reps_max === 15);
  ck('a bare name is kept with no prescription', parsed[3].name === 'Plank' && parsed[3].sets === null);
  ck('validation: no name → error; no exercises → error; >15 → error',
     !circuits.validateCircuit({ name: '', text: 'x' }).ok && !circuits.validateCircuit({ name: 'Push', text: '' }).ok && !circuits.validateCircuit({ name: 'Push', text: Array(16).fill('a 3x10').join('\n') }).ok);
  ck('matchCircuit is loose: "Push · Mon", "push day", "PUSH circuit" all match "Push"; "Pull" does not',
     ['Push · Mon', 'push day', 'PUSH circuit'].every(l => circuits.matchCircuit(l, [{ name: 'Push' }])?.name === 'Push') && circuits.matchCircuit('Pull', [{ name: 'Push' }]) === null);

  console.log('\n[2] save, list, replace, delete — scoped to the coach');
  let r = await call('PUT', '/api/ai-chat/circuits/Push', tok, { text: 'Bench press 4x8-12 chest\nOverhead press 3x8-10 shoulders\nCable fly 3x12-15' });
  ck('PUT saves and returns the circuit', r.status === 200 && r.data.circuit.name === 'Push' && r.data.circuit.exercises.length === 3, r.data);
  r = await call('PUT', '/api/ai-chat/circuits/push', tok, { text: 'Bench press 4x6-8 chest' });
  r = await call('GET', '/api/ai-chat/circuits', tok);
  ck('saving "push" again replaces "Push" (case-insensitive, one row)', r.data.circuits.length === 1 && r.data.circuits[0].exercises.length === 1 && r.data.circuits[0].exercises[0].reps_max === 8, r.data);
  await call('PUT', '/api/ai-chat/circuits/Legs', tok, { text: 'Squat 4x6-10 legs\nRDL 3x8-12 legs\nLeg press 3x10-15' });
  r = await call('GET', '/api/ai-chat/circuits', tok2);
  ck('another coach sees none of them', r.status === 200 && r.data.circuits.length === 0, r.data);
  r = await call('PUT', '/api/ai-chat/circuits/Push', tok, { text: '' });
  ck('an empty circuit is refused with 400', r.status === 400, r.status);
  r = await call('DELETE', '/api/ai-chat/circuits/legs', tok);
  const after = await call('GET', '/api/ai-chat/circuits', tok);
  ck('DELETE by name (any case) removes exactly that one', r.data.deleted === 1 && after.data.circuits.length === 1 && after.data.circuits[0].name === 'Push');
  await call('PUT', '/api/ai-chat/circuits/Legs', tok, { text: 'Squat 4x6-10 legs\nRDL 3x8-12 legs' });

  console.log('\n[3] the prompt carries them exactly');
  const block = circuits.circuitsPromptBlock((await call('GET', '/api/ai-chat/circuits', tok)).data.circuits);
  ck('the block names each circuit with its exercises, sets and reps', /"Legs": Squat 4×6–10 \(legs\); RDL 3×8–12 \(legs\)/.test(block) && /"Push": Bench press 4×6–8 \(chest\)/.test(block), block);
  ck('the block tells the model to use them EXACTLY and never substitute', /use\nEXACTLY these exercises/.test(block) && /Do NOT\nsubstitute/.test(block));
  ck('no circuits → no block (the prompt is unchanged for a coach without any)', circuits.circuitsPromptBlock([]) === '');

  console.log('\n[4] enforcement — the model ignored the instruction');
  // What the model would emit if it built a generic Push day and a Pull day
  const generic = { name: 'PPL', days: [
    { label: 'Push · Mon', exercises: [{ name: 'Machine chest press', sets: 3, reps_min: 10, reps_max: 12, muscle_group: 'chest' }, { name: 'Lateral raise', sets: 3, reps_min: 12, reps_max: 15, muscle_group: 'shoulders' }] },
    { label: 'Pull · Wed', exercises: [{ name: 'Lat pulldown', sets: 3, reps_min: 10, reps_max: 12, muscle_group: 'back' }] },
    { label: 'Legs · Fri', exercises: [{ name: 'Leg extension', sets: 3, reps_min: 12, reps_max: 15, muscle_group: 'legs' }] },
  ] };
  // applyHouseCircuits is module-local to the route; exercise it through the same logic
  const mine = (await call('GET', '/api/ai-chat/circuits', tok)).data.circuits;
  const enforced = { ...generic, days: generic.days.map(d => { const hit = circuits.matchCircuit(d.label, mine); return hit ? { ...d, house_circuit: hit.name, exercises: hit.exercises } : d; }) };
  ck('Push · Mon becomes the coach\'s Push (bench 4×6–8), not the machine press', enforced.days[0].house_circuit === 'Push' && enforced.days[0].exercises[0].name === 'Bench press' && enforced.days[0].exercises.length === 1, enforced.days[0]);
  ck('Legs · Fri becomes the coach\'s Legs (squat, RDL)', enforced.days[2].house_circuit === 'Legs' && enforced.days[2].exercises.map(e => e.name).join(',') === 'Squat,RDL');
  ck('Pull · Wed has no house circuit and is left as the model built it', !enforced.days[1].house_circuit && enforced.days[1].exercises[0].name === 'Lat pulldown');
  const src = require('fs').readFileSync(require('path').join(__dirname, '../routes/aiChat.js'), 'utf8');
  ck('coach-parse wires it: circuits loaded, passed to the prompt, and applied to the normalised program',
     /const circuits = await loadCircuits\(req\.user\.id\);/.test(src) && /buildCoachPrompt\(cleanMsg, members, memberStats, contextMember, recent, circuits\)/.test(src) && /applyHouseCircuits\(normaliseProgram\(raw\.program\), circuits\)/.test(src));

  srv.close();
  await pool.query(`DELETE FROM users WHERE email LIKE 'circuit-%'`);
  await pool.end();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
