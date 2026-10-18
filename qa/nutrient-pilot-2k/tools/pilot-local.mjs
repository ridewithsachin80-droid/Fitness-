// Dry run of the 2k pilot on a LOCAL copy of the 25 live records (never the live database):
// copy → propose (real API) → apply (real API) → log a day → screenshots → roll back → compare.
import fs from 'fs'; import { createRequire } from 'module'; import { execFileSync } from 'child_process';
const require = createRequire('/home/claude/fitness-/server/package.json');
const jwt = require('jsonwebtoken');
const puppeteer = createRequire('/home/claude/t3/server/package.json')('puppeteer-core');
const S = process.env.PILOT_DATA || '/tmp/pilot-data';   // holds ifctpkg/ and sr28/ (see README)
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:4104';
const sql = q => execFileSync('psql', ['-h', '/tmp', '-p', '5433', '-U', 'postgres', '-d', 'fitlife_ux', '-qAtc', q], { encoding: 'utf8' }).trim();
const { MICRO_KEYS } = require('/home/claude/fitness-/server/services/nutrientStatus.js');
const inv = fs.readFileSync('/home/claude/deliver2k/live-inventory.jsonl', 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const { proposals } = JSON.parse(fs.readFileSync(`${S}/pilot/pilot-proposals.json`, 'utf8'));
const A = 'Bearer ' + jwt.sign({ id: 1, role: 'admin', name: 'Local admin' }, 'uxsecret', { expiresIn: '1h' });
const call = async (method, p, body) => { const r = await fetch(BASE + p, { method, headers: { Authorization: A, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: await r.json().catch(() => ({})) }; };
const log = []; const say = (ok, m) => { log.push(`${ok ? '✓' : '✗'} ${m}`); console.log(`${ok ? '✓' : '✗'} ${m}`); };
const idMap = new Map(); const before = new Map();
const prevLog = sql(`select coalesce(food_items::text,'') from daily_logs where patient_id=6 and log_date=(now() at time zone 'Asia/Kolkata')::date`);
let batchId = null;
try {
  // 1. Copy the live records exactly (values, uncertain zeros, everything else empty).
  for (const f of inv) {
    const per = { calories: f.kcal, protein: f.p, total_carbs: f.c, fat: f.f, net_carbs: Math.max(0, f.c - (f.values.fiber || 0)),
      ...Object.fromEntries(MICRO_KEYS.map(k => [k, null])), ...Object.fromEntries(f.uncertain_zero.map(k => [k, 0])), ...f.values };
    if (Object.keys(f.statuses || {}).length) per._status = f.statuses;
    const id = sql(`insert into foods (name, category, source, verified, per_100g) values ('${f.name.replace(/'/g, "''")}', 'other', 'ai', false, '${JSON.stringify(per)}'::jsonb) returning id`);
    idMap.set(f.id, parseInt(id)); before.set(parseInt(id), sql(`select per_100g::text || '|' || coalesce(nutrient_meta::text,'') from foods where id=${id}`));
  }
  say(idMap.size === inv.length, `copied ${idMap.size} live records locally (live ids → local ids)`);
  // 2. Propose with the real API.
  const local = proposals.map(p => ({ ...p, food_id: idMap.get(p.food_id) }));
  const r = await call('POST', '/api/nutrient-enrichment/batches', { label: 'Fixes-2k pilot (local dry run)', proposals: local });
  batchId = r.data.batch?.id;
  const prop = (r.data.review || []).filter(x => x.outcome === 'proposed').length, skip = (r.data.review || []).filter(x => x.outcome !== 'proposed');
  say(r.status === 201 && prop === proposals.length && skip.length === 0, `proposed: ${prop} of ${proposals.length} accepted by the real batch check, ${skip.length} refused ${skip.slice(0, 3).map(x => x.food + ' ' + x.nutrient + ': ' + x.reason).join('; ')}`);
  const unchanged = [...before].every(([id, b]) => sql(`select per_100g::text || '|' || coalesce(nutrient_meta::text,'') from foods where id=${id}`) === b);
  say(unchanged, 'proposing changed no food');
  // 3. Apply (local only).
  const ap = await call('POST', `/api/nutrient-enrichment/batches/${batchId}/apply`, { confirm: `apply batch ${batchId}` });
  say(ap.status === 200 && ap.data.applied === proposals.length, `applied locally: ${ap.data.applied}, skipped ${ap.data.skipped}`);
  // 4. A member's day from the enriched foods, as the app copies them (GET /foods/:id carries the statuses).
  const pick = async (liveId, grams, meal) => { const g = await call('GET', `/api/foods/${idMap.get(liveId)}`); return { name: g.data.name, grams, meal, food_id: g.data.id, source: 'db', per_100g: g.data.per_100g }; };
  const items = [await pick(854, 150, 'Lunch'), await pick(954, 100, 'Lunch'), await pick(835, 200, 'Dinner'), await pick(794, 150, 'Breakfast'), await pick(860, 50, 'Lunch')];
  const st = items[1].per_100g._status || {};
  say(st.iron === 'ai' && st.folate === 'reference' && st.vit_a === 'reference', `a logged copy keeps its statuses (Greens: iron "${st.iron}" (the old AI value), folate "${st.folate}", vit A "${st.vit_a}")`);
  sql(`insert into daily_logs (patient_id, log_date, food_items) values (6, (now() at time zone 'Asia/Kolkata')::date, '${JSON.stringify(items).replace(/'/g, "''")}'::jsonb) on conflict (patient_id, log_date) do update set food_items = excluded.food_items`);
  // 5. Screens.
  const b = await puppeteer.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'], headless: true });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const VIEW = { width: 360, height: 800, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  const clickText = (p, re) => p.evaluate((src) => { const r = new RegExp(src); const el = [...document.querySelectorAll('button')].find(b => r.test(b.textContent.trim())); el?.scrollIntoView({ block: 'center' }); el?.click(); return !!el; }, re.source);
  const open = async (theme) => { const ctx = await b.createBrowserContext(); const p = await ctx.newPage(); await p.setViewport(VIEW); await p.goto(BASE, { waitUntil: 'networkidle2' }); await p.waitForSelector('input[type=tel]');
    await p.evaluate(t => { localStorage.setItem('fitlife-settings-v2', JSON.stringify({ state: { theme: t }, version: 0 })); localStorage.setItem('fitlife-whats-new-2026-10', '1'); }, theme); await p.reload({ waitUntil: 'networkidle2' }); await p.waitForSelector('input[type=tel]'); return p; };
  const rows = (p, scope) => p.evaluate((scope) => { const root = scope === 'dialog' ? [...document.querySelectorAll('[role=dialog]')].pop() : document.querySelector('[data-testid="coach-key-nutrients"]');
    return Object.fromEntries([...(root?.querySelectorAll('[data-testid="micro-row"]') || [])].map(r => [r.dataset.key, `${r.dataset.status} | ${r.textContent.replace(/\s+/g, ' ').trim()}`])); }, scope);
  for (const theme of ['light', 'dark']) {
    const m = await open(theme);
    await m.type('input[type=tel]', '9000000301'); await m.type('input[type=password]', '2468');
    await clickText(m, /^Log In/); await m.waitForSelector('[data-testid="daily-essentials"]', { timeout: 30000 }); await wait(1200);
    if (!(await m.$('[data-testid="chip-nutrition"]'))) { await clickText(m, /^Plan & tools/); await wait(700); }
    await m.evaluate(() => document.querySelector('[data-testid="chip-nutrition"]')?.click()); await wait(1300);
    const title = await m.evaluate(() => [...document.querySelectorAll('[role=dialog]')].pop()?.querySelector('h2')?.textContent);
    const v = await rows(m, 'dialog');
    await m.screenshot({ path: `${OUT}/p-${theme}-member-vitamins.png` });
    await clickText(m, /Minerals/); await wait(500);
    const mi = await rows(m, 'dialog');
    await m.evaluate(() => [...document.querySelectorAll('[role=dialog]')].pop()?.querySelector('[data-key="calcium"]')?.scrollIntoView({ block: 'center' })); await wait(300);
    await m.screenshot({ path: `${OUT}/p-${theme}-member-minerals.png` });
    say(/estimated/.test(title || '') || /met/.test(title || ''), `${theme} member sheet title after the pilot: "${title}"`);
    say(true, `${theme} member rows: folate ${v.folate} · B12 ${v.vit_b12} · vit A ${v.vit_a} · calcium ${mi.calcium} · iron ${mi.iron} · zinc ${mi.zinc} · magnesium ${mi.magnesium}`);
    await m.browserContext().close();
    const c = await open(theme);
    await clickText(c, /Coach \/ Admin/); await wait(400);
    await c.type('input[type=email]', 'autocoach@ux.test'); await c.type('input[type=password]', 'robotpass1');
    await clickText(c, /^(Log In|Sign In)/); await wait(4000);
    await c.evaluate(() => { history.pushState({}, '', '/coach/6'); dispatchEvent(new PopStateEvent('popstate')); }); await wait(3500);
    await c.evaluate(() => { const f = document.querySelector('[data-testid="full-log"]'); const t = f?.querySelector('button') || f; t?.click(); }); await wait(1200);
    await c.evaluate(() => { const d = document.querySelector('[data-testid="coach-key-nutrients"]'); if (d) { d.open = true; d.scrollIntoView({ block: 'start' }); } }); await wait(500);
    const cr = await rows(c, 'coach');
    const same = ['vit_b12', 'calcium', 'iron', 'zinc', 'folate', 'magnesium'].every(k => cr[k] === (mi[k] || v[k]));
    say(same, `${theme} coach Key Nutrients rows identical to the member's (B12, calcium, iron, zinc, folate, magnesium)`);
    await c.screenshot({ path: `${OUT}/p-${theme}-coach-key-nutrients.png` });
    await c.browserContext().close();
  }
  await b.close();
  // 6. Roll back and compare every record with its copy.
  const rb = await call('POST', `/api/nutrient-enrichment/batches/${batchId}/rollback`, {});
  const diff = [...before].filter(([id, bf]) => sql(`select per_100g::text || '|' || coalesce(nutrient_meta::text,'') from foods where id=${id}`) !== bf.replace(/\|$/, '|{}') && sql(`select per_100g::text || '|' || coalesce(nutrient_meta::text,'') from foods where id=${id}`) !== bf);
  say(rb.status === 200 && rb.data.restored === proposals.length && rb.data.conflicts === 0, `rolled back: ${rb.data.restored} restored, ${rb.data.conflicts} conflicts`);
  if (diff.length) { const id = diff[0][0]; fs.writeFileSync(`${OUT}/diff-before.json`, before.get(id)); fs.writeFileSync(`${OUT}/diff-after.json`, sql(`select per_100g::text || '|' || coalesce(nutrient_meta::text,'') from foods where id=${id}`)); }
  say(diff.length === 0, `after rollback every record equals its copy before the batch (${before.size - diff.length}/${before.size})${diff.length ? ' — differ: ' + diff.map(d => d[0]).join(',') : ''}`);
} finally {
  if (prevLog === '') sql(`delete from daily_logs where patient_id=6 and log_date=(now() at time zone 'Asia/Kolkata')::date`);
  else sql(`update daily_logs set food_items='${prevLog.replace(/'/g, "''")}'::jsonb where patient_id=6 and log_date=(now() at time zone 'Asia/Kolkata')::date`);
  if (batchId) sql(`delete from nutrient_enrichment_batches where id=${batchId}`);
  if (idMap.size && !process.env.KEEP) sql(`delete from foods where id in (${[...idMap.values()].join(',')})`);
  fs.writeFileSync(`${OUT}/pilot-dry-run.log`, log.join('\n') + '\n');
}
