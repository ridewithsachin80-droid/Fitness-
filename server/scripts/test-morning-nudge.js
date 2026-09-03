/**
 * scripts/test-morning-nudge.js — the 06:30 IST daily prompt to log.
 *
 * WHAT THIS PROTECTS
 * ------------------
 * The original request was FIVE scheduled reminders a day: weight at 6,
 * activity at 8, and one per meal. One replaced them deliberately — five push
 * notifications a day is how members mute the app, and a muted app also loses
 * the evening recap and the coach's messages. The single message therefore has
 * to earn its place by carrying real numbers, which is what most of these
 * assertions are about.
 *
 * It also covers services/programDay.js, extracted here because the logic
 * existed in three places and two of them disagreed:
 *
 *   /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i     <- server, MISSING the trailing \b
 *   /\bMon\b/i                             <- client, correct
 *
 * "Monsoon Circuit" matched Mon and "Sunrise Flow" matched Sun, so the server
 * reported such a program as weekday-scheduled while the day lookup — which
 * did check both boundaries — found nothing for today. Rest-day copy only
 * shows for weekday-scheduled programs, so a member on that program was told
 * it was a rest day every single day.
 *
 * Every assertion below was written by reintroducing the bug it describes and
 * confirming it goes red.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const pool = require('../db/pool');
const P    = require('../services/programDay');
const D    = require('../services/digests');

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 220))); };

// 2026-09-07 is a Monday, 2026-09-09 a Wednesday, 2026-09-13 a Sunday.
const MON = '2026-09-07', WED = '2026-09-09', SUN = '2026-09-13';

(async () => {
  try {
    // ── services/programDay.js ────────────────────────────────────────────
    console.log('\nProgram day derivation');

    ck('a Monday date resolves to Mon', P.weekdayFor(MON) === 'Mon', P.weekdayFor(MON));
    ck('a Wednesday date resolves to Wed', P.weekdayFor(WED) === 'Wed');
    ck('a Sunday date resolves to Sun — the (dow+6)%7 shift is where off-by-one lives',
       P.weekdayFor(SUN) === 'Sun', P.weekdayFor(SUN));

    const real = [{ day_number: 1, day_label: 'Push · Mon' },
                  { day_number: 2, day_label: 'Pull · Wed' }];
    ck('a weekday-labelled program is recognised', P.isWeekdayScheduled(real) === true);
    ck('Monday finds the Monday day', P.programDayForDate(real, MON)?.day_label === 'Push · Mon');
    ck('Wednesday finds the Wednesday day', P.programDayForDate(real, WED)?.day_label === 'Pull · Wed');
    ck('a day with nothing scheduled returns null, rather than guessing',
       P.programDayForDate(real, SUN) === null);

    // THE REGRESSION.
    const trap = [{ day_number: 1, day_label: 'Monsoon Circuit' },
                  { day_number: 2, day_label: 'Sunrise Flow' }];
    ck('"Monsoon Circuit" and "Sunrise Flow" are NOT weekday-scheduled (the bug: a member on this program was told rest day every day)',
       P.isWeekdayScheduled(trap) === false, P.isWeekdayScheduled(trap));
    ck('...and Monsoon is not scheduled on a Monday', P.programDayForDate(trap, MON) === null);
    ck('...and Sunrise is not scheduled on a Sunday', P.programDayForDate(trap, SUN) === null);

    ck('an unlabelled program is not weekday-scheduled',
       P.isWeekdayScheduled([{ day_number: 1, day_label: 'Day 1' }]) === false);
    ck('...and deriveTodayDay offers its first day as next-up rather than as today',
       (() => { const r = P.deriveTodayDay([{ day_number: 1, day_label: 'Day 1' }], MON);
                return r.scheduled === false && r.todayDay?.day_label === 'Day 1'; })());

    ck('an empty program is safe', P.programDayForDate([], MON) === null);
    ck('a null program is safe', P.programDayForDate(null, MON) === null);
    ck('a day with a null label does not throw',
       P.programDayForDate([{ day_number: 1, day_label: null }], MON) === null);
    ck('a nonsense date returns null rather than NaN-indexing the weekday table',
       P.weekdayFor('not-a-date') === null);

    // Parity with the client. They cannot import each other; this is what
    // stops them drifting apart again.
    const { importClient } = require('./lib/client-bundle');
    const C = importClient('utils/programDay.js');
    for (const label of ['Push · Mon', 'Monsoon Circuit', 'Sunrise Flow', 'Day 1', 'Core Workout']) {
      const days = [{ day_number: 1, day_label: label }];
      ck(`client and server agree on "${label}"`,
         C.isWeekdayScheduled(days) === P.isWeekdayScheduled(days),
         { client: C.isWeekdayScheduled(days), server: P.isWeekdayScheduled(days) });
    }

    // ── The copy ──────────────────────────────────────────────────────────
    console.log('\nMorning message copy');

    const full = D.buildMorningBody({
      yesterday: { logged: true, kcal: 1780, weightKg: 78.4 },
      todayDay: { day_label: 'Push · Mon' }, scheduled: true, weighedToday: false,
    });
    ck('carries yesterday\'s calories', /1,780 kcal/.test(full), full);
    ck('carries yesterday\'s weight', /78\.4 kg/.test(full), full);
    ck('names today\'s program day', /Push · Mon/.test(full), full);
    ck('asks for the weigh-in', /Weigh-in/.test(full), full);
    ck('sections are separated by a full stop, not a middot — day labels already contain a middot, so "kcal · 78.4 kg · Today: Push · Mon" had four dots of equal weight',
       /kg\. Today/.test(full), full);

    ck('a member who already weighed in is NOT asked to weigh in',
       !/Weigh-in/.test(D.buildMorningBody({
         yesterday: { logged: true, kcal: 1780, weightKg: 78.4 },
         todayDay: null, scheduled: false, weighedToday: true })));

    ck('a scheduled program with no day today says rest day',
       /rest day/.test(D.buildMorningBody({
         yesterday: { logged: false }, todayDay: null, scheduled: true, weighedToday: false })));

    ck('an UNSCHEDULED program never claims a rest day — that is the visible half of the Monsoon bug',
       !/rest day/.test(D.buildMorningBody({
         yesterday: { logged: false }, todayDay: null, scheduled: false, weighedToday: false })));

    ck('a member who logged nothing yesterday gets no "Yesterday:" line rather than a zero',
       !/Yesterday/.test(D.buildMorningBody({
         yesterday: { logged: false }, todayDay: null, scheduled: false, weighedToday: false })));

    ck('a day logged with no food and no weight does not print "Yesterday: " with nothing after it',
       !/Yesterday/.test(D.buildMorningBody({
         yesterday: { logged: true, kcal: 0, weightKg: null },
         todayDay: null, scheduled: false, weighedToday: false })));

    ck('when there is nothing worth saying the body is empty, so no message is sent',
       D.buildMorningBody({ yesterday: { logged: true, kcal: 0, weightKg: null },
                            todayDay: null, scheduled: false, weighedToday: true }) === '');

    ck('no emoji in the body — this is read by screen readers and shown in a notification shade',
       !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(full), full);

    // ── WhatsApp template parameters ──────────────────────────────────────
    // A business-initiated WhatsApp message must match a template Meta
    // approved in advance; free text outside a service window gets the number
    // BANNED, not merely rejected. Meta also rejects an EMPTY parameter, so
    // unlike the push copy — which drops clauses that do not apply — every
    // slot here must always carry content.
    console.log('\nWhatsApp template parameters');

    const pFull = D.buildMorningParams({
      name: 'Avinash Kumar', yesterday: { logged: true, kcal: 1780, weightKg: 78.4 },
      todayDay: { day_label: 'Push · Mon' }, scheduled: true });
    ck('three parameters, matching the three template slots', pFull.length === 3, pFull);
    ck('first name only in slot 1', pFull[0] === 'Avinash', pFull[0]);
    ck('yesterday\'s numbers in slot 2', /1,780 kcal, 78\.4 kg/.test(pFull[1]), pFull[1]);
    ck('today\'s day in slot 3', pFull[2] === 'Push · Mon', pFull[2]);

    // THE REGRESSION RISK. Meta rejects a blank parameter, per member, at send
    // time, with an unhelpful error.
    const cases = [
      { name: '',      yesterday: { logged: false },                          todayDay: null, scheduled: false },
      { name: null,    yesterday: null,                                       todayDay: null, scheduled: true  },
      { name: 'Asha',  yesterday: { logged: true, kcal: 0, weightKg: null },  todayDay: null, scheduled: true  },
      { name: '  ',    yesterday: { logged: true, kcal: 1200, weightKg: null },todayDay: null, scheduled: false },
    ];
    let allFilled = true;
    for (const c of cases) {
      const p = D.buildMorningParams(c);
      if (p.length !== 3 || p.some(x => typeof x !== 'string' || x.trim() === '')) {
        allFilled = false; console.log('      empty slot for', JSON.stringify(c), '->', JSON.stringify(p));
      }
    }
    ck('NO parameter is ever empty, whatever the member data — Meta rejects a blank slot',
       allFilled);

    ck('a member with no name still gets a usable greeting rather than "Good morning, ."',
       D.buildMorningParams({ name: null, yesterday: null, todayDay: null, scheduled: false })[0] === 'there');

    ck('an unscheduled program never claims a rest day in the template either',
       D.buildMorningParams({ name: 'A', yesterday: null, todayDay: null, scheduled: false })[2] === 'your usual plan');

    // Meta rejects parameters containing newlines, tabs or long space runs.
    const { cleanTemplateParam } = require('../services/messaging');
    ck('a newline in a parameter is flattened, not sent — Meta rejects it',
       !/[\r\n]/.test(cleanTemplateParam('Push\nMon')));
    ck('a tab is flattened', !/\t/.test(cleanTemplateParam('Push\tMon')));
    ck('a long run of spaces is collapsed', !/ {4,}/.test(cleanTemplateParam('Push      Mon')));
    ck('null becomes an empty string rather than the text "null"',
       cleanTemplateParam(null) === '');
    ck('a parameter is capped at 200 characters', cleanTemplateParam('x'.repeat(500)).length === 200);

    // ── Sending ───────────────────────────────────────────────────────────
    console.log('\nSending');

    await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
    const mk = async (name, phone) => (await pool.query(
      `INSERT INTO users (name, phone, password, role, active)
       VALUES ($1,$2,'x','patient',true) RETURNING id`, [name, phone])).rows[0].id;

    const a = await mk('Avinash Kumar', '9000000011');
    const b = await mk('Asha Rao',      '9000000012');

    // The dedupe check compares notifications_log.sent_at (wall clock, DEFAULT
    // NOW()) against the istDate passed in. Seeding a FUTURE date therefore
    // makes dedupe look broken when it is working perfectly: no row written
    // today can ever match 2026-09-07. Use the real IST date, exactly as
    // cronService does, and seed the logs relative to it.
    const istNow = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const today     = istNow();
    const yesterday = new Date(new Date(today + 'T00:00:00Z').getTime() - 86400000)
                        .toISOString().slice(0, 10);

    await pool.query(
      `INSERT INTO daily_logs (patient_id, log_date, weight_kg, food_items)
       VALUES ($1,$2,78.4,$3)`,
      [a, yesterday, JSON.stringify([{ name: 'Dal', grams: 200, per_100g: { calories: 120 } }])]);

    // Opted out, and must stay silent.
    await pool.query(
      `INSERT INTO patient_profiles (user_id, notify_opted_out)
       VALUES ($1, true)
       ON CONFLICT (user_id) DO UPDATE SET notify_opted_out = true`, [b]);

    const sent = await D.sendMorningNudges(today);
    ck('the opted-out member is skipped', sent <= 1, sent);

    const logged = await pool.query(
      `SELECT user_id, type, title, body FROM notifications_log WHERE type='morning_nudge'`);
    ck('nothing was logged for the opted-out member',
       !logged.rows.some(r => r.user_id === b), logged.rows);

    const mine = logged.rows.find(r => r.user_id === a);
    if (mine) {
      ck('the title greets them by first name only', /^Good morning, Avinash$/.test(mine.title), mine.title);
      ck('the body carries yesterday\'s real numbers', /240 kcal|78\.4 kg/.test(mine.body), mine.body);
    } else {
      // Push is not configured in the test environment, so delivery may fail —
      // but the row must still be written with failed=true, or a silent
      // outage would be indistinguishable from a quiet day.
      const anyRow = await pool.query(
        `SELECT * FROM notifications_log WHERE user_id=$1 AND type='morning_nudge'`, [a]);
      ck('a failed send is still recorded, so an outage is visible', anyRow.rows.length === 1, anyRow.rows);
    }

    // Dedupe. The same cron minute must not fire twice, and a restart at 06:30
    // must not double-send.
    const before = (await pool.query(
      `SELECT COUNT(*)::int n FROM notifications_log WHERE type='morning_nudge'`)).rows[0].n;
    await D.sendMorningNudges(today);
    const after = (await pool.query(
      `SELECT COUNT(*)::int n FROM notifications_log WHERE type='morning_nudge'`)).rows[0].n;
    ck('running twice on the same day sends once — a restart at 06:30 must not double-send',
       after === before, { before, after });

    // The dedupe must count ATTEMPTS, not successes. A member with no push
    // subscription — never granted permission, or on iOS Safari without
    // installing — fails every single time, so a dedupe that ignores failed
    // rows would write a new one on every run and could deliver twice if a
    // send threw AFTER the notification had already gone out.
    await pool.query(`UPDATE notifications_log SET failed = true WHERE type='morning_nudge'`);
    await D.sendMorningNudges(today);
    const afterFailed = (await pool.query(
      `SELECT COUNT(*)::int n FROM notifications_log WHERE type='morning_nudge'`)).rows[0].n;
    ck('a FAILED send still counts as today\'s message — otherwise a member without a push subscription is retried forever',
       afterFailed === before, { before, afterFailed });

    // A member with no data at all must not crash the loop, and must not be
    // sent an empty greeting.
    const c = await mk('Bujju S', '9000000013');
    const tomorrow = new Date(new Date(today + 'T00:00:00Z').getTime() + 86400000)
                       .toISOString().slice(0, 10);
    await D.sendMorningNudges(tomorrow);
    const cRows = await pool.query(
      `SELECT body FROM notifications_log WHERE user_id=$1 AND type='morning_nudge'`, [c]);
    ck('a member with no history either gets a real message or none — never an empty one',
       cRows.rows.every(r => (r.body || '').trim().length > 0), cRows.rows);

    // ── Manual coach send ─────────────────────────────────────────────────
    // While the Meta template awaits approval, the coach sends today's message
    // from their own WhatsApp. It must be composed by the SAME code as the
    // cron — a second copy in a route is how the weekday logic ended up with
    // three implementations and two answers.
    console.log('\nManual coach send');

    await pool.query(`DELETE FROM notifications_log WHERE type='morning_nudge'`);
    const d2 = await mk('Manual Test', '9000000021');
    await pool.query(
      `INSERT INTO daily_logs (patient_id, log_date, weight_kg, food_items)
       VALUES ($1,$2,80.1,$3)`,
      [d2, yesterday, JSON.stringify([{ name: 'Rice', grams: 150, per_100g: { calories: 130 } }])]);

    let composed = await D.composeMorningMessages(today, [d2]);
    ck('one row per member', composed.length === 1, composed);
    ck('the message is not empty', (composed[0].message || '').length > 0, composed[0]);
    ck('it greets by first name', /^Good morning, Manual\./.test(composed[0].message), composed[0].message);
    ck('it carries yesterday\'s real numbers', /80\.1 kg/.test(composed[0].message), composed[0].message);
    ck('the phone is returned so the coach can open WhatsApp',
       composed[0].phone === '9000000021', composed[0].phone);
    ck('not yet marked as sent', composed[0].already_sent === false);

    // Composing must NOT send or record anything — a coach opening the screen
    // twice would otherwise suppress the 06:30 message for everyone.
    const afterCompose = (await pool.query(
      `SELECT COUNT(*)::int n FROM notifications_log WHERE type='morning_nudge'`)).rows[0].n;
    ck('composing records nothing — opening the screen must not suppress the automatic send',
       afterCompose === 0, afterCompose);

    // Recording a manual send must block the cron, or the member gets two.
    await D.logSent(d2, 'morning_nudge', 'Good morning (sent by coach)', composed[0].message, true);
    composed = await D.composeMorningMessages(today, [d2]);
    ck('a manually sent member shows as sent', composed[0].already_sent === true);

    const sentCount = await D.sendMorningNudges(today);
    const rowsNow = (await pool.query(
      `SELECT COUNT(*)::int n FROM notifications_log WHERE user_id=$1 AND type='morning_nudge'`,
      [d2])).rows[0].n;
    ck('the 06:30 cron does NOT send a second copy to a member the coach already messaged',
       rowsNow === 1, { rowsNow, sentCount });

    // An opted-out member must never be offered to the coach either.
    const d3 = await mk('Opted Out', '9000000022');
    await pool.query(
      `INSERT INTO patient_profiles (user_id, notify_opted_out) VALUES ($1, true)
       ON CONFLICT (user_id) DO UPDATE SET notify_opted_out = true`, [d3]);
    const optedRow = (await D.composeMorningMessages(today, [d3]))[0];
    ck('an opted-out member is flagged so the coach screen can hide them',
       optedRow.opted_out === true, optedRow);

    ck('composing for nobody returns an empty list rather than throwing',
       (await D.composeMorningMessages(today, [])).length === 0);

    // ── Coach AI chat: "send morning msg to Asha" ─────────────────────────
    // The apply handler in routes/aiChat.js builds the WhatsApp template
    // parameters from the composed row. If composeMorningMessages stops
    // returning the raw facts, that handler silently sends a malformed
    // template — Meta rejects it per member, at send time, with an unhelpful
    // error. These assertions pin the shape.
    console.log('\nCoach AI chat op');

    const d4 = await mk('Asha Chat', '9000000023');
    await pool.query(
      `INSERT INTO daily_logs (patient_id, log_date, weight_kg, food_items)
       VALUES ($1,$2,66.3,$3)`,
      [d4, yesterday, JSON.stringify([{ name: 'Idli', grams: 100, per_100g: { calories: 160 } }])]);

    const [row] = await D.composeMorningMessages(today, [d4]);
    for (const k of ['first_name', 'body', 'yesterday', 'todayDay', 'scheduled', 'phone']) {
      ck(`composed row carries "${k}" — the AI apply handler reads it`, k in row, Object.keys(row));
    }
    ck('first_name is never blank, so the greeting cannot read "Good morning, ."',
       typeof row.first_name === 'string' && row.first_name.trim().length > 0, row.first_name);

    // The AI path must produce the SAME template parameters as the cron.
    const viaChat = D.buildMorningParams({
      name: row.name, yesterday: row.yesterday, todayDay: row.todayDay, scheduled: row.scheduled });
    ck('template parameters built from a composed row are valid (3 slots, none empty)',
       viaChat.length === 3 && viaChat.every(x => typeof x === 'string' && x.trim()), viaChat);
    ck('the coach-sent message says the same thing as the automatic one',
       viaChat[1].includes('66.3 kg'), viaChat);

    // Sending from chat must block the cron, exactly as the manual card does.
    await D.logSent(d4, 'morning_nudge', 'Good morning (sent by coach)', row.message, true);
    await D.sendMorningNudges(today);
    const n4 = (await pool.query(
      `SELECT COUNT(*)::int n FROM notifications_log WHERE user_id=$1 AND type='morning_nudge'`,
      [d4])).rows[0].n;
    ck('a message sent from the coach AI chat stops the 06:30 cron sending a second copy',
       n4 === 1, n4);

    // ── Honest delivery reporting ─────────────────────────────────────────
    // pushService.sendToUser returns undefined in THREE not-delivered cases:
    // VAPID unconfigured, the subscription lookup failing, and the member
    // simply having no subscriptions. A caller that only watches for a thrown
    // error cannot tell any of them from success — and that is exactly what
    // happened: the coach AI chat reported "morning message sent" for a member
    // who had never granted notification permission. Nothing left the server.
    console.log('\nHonest delivery reporting');

    const push = require('../services/pushService');
    const d5 = await mk('No Subscription', '9000000024');

    const r = await push.sendToUser(d5, 'Title', 'Body', 'morning_nudge');
    ck('sendToUser RETURNS a result rather than undefined', r && typeof r === 'object', r);
    ck('a member with no push subscription is reported as NOT ok', r.ok === false, r);
    ck('...with a reason the coach can act on', typeof r.reason === 'string' && r.reason.length > 0, r.reason);
    ck('nothing is counted as sent', r.sent === 0, r);

    // deliveredToday must distinguish an attempt from an arrival.
    await pool.query(`DELETE FROM notifications_log WHERE user_id=$1`, [d5]);
    await D.logSent(d5, 'morning_nudge', 'T', 'B', false);      // attempted, failed
    ck('a FAILED attempt counts as attempted', await D.alreadyAttemptedToday(d5, 'morning_nudge', today) === true);
    ck('...but NOT as delivered — the coach needs to know it never arrived',
       await D.deliveredToday(d5, 'morning_nudge', today) === false);

    await D.logSent(d5, 'morning_nudge', 'T', 'B', true);       // then sent by hand
    ck('a later successful send marks it delivered',
       await D.deliveredToday(d5, 'morning_nudge', today) === true);

    // The composed row must carry both, or the card cannot show the difference.
    const d6 = await mk('Undelivered Member', '9000000025');
    await pool.query(
      `INSERT INTO daily_logs (patient_id, log_date, weight_kg) VALUES ($1,$2,70.0)`, [d6, yesterday]);
    await D.logSent(d6, 'morning_nudge', 'T', 'B', false);
    const [urow] = await D.composeMorningMessages(today, [d6]);
    ck('a member the cron failed to reach shows attempted', urow.already_sent === true, urow);
    ck('...and NOT delivered, so the card can offer a retry', urow.delivered === false, urow);

    // ── An explicit coach instruction must never be refused ──────────────
    // The dedupe exists to stop the 06:30 CRON sending twice. It must not
    // argue with a coach who typed "send morning msg to Sachin".
    //
    // This was a real dead end: the first buggy send logged itself as
    // delivered while nothing had left the server, and every attempt
    // afterwards answered "already sent today" with no way to override.
    console.log('\nExplicit coach instruction');

    const d7 = await mk('Resend Member', '9000000026');
    await pool.query(
      `INSERT INTO daily_logs (patient_id, log_date, weight_kg) VALUES ($1,$2,72.5)`,
      [d7, yesterday]);

    // A prior record — as the buggy send would have left behind.
    await D.logSent(d7, 'morning_nudge', 'T', 'B', true);
    ck('the member is recorded as messaged today',
       await D.alreadyAttemptedToday(d7, 'morning_nudge', today) === true);

    // Composing must still hand back a message. Returning nothing here is what
    // left the coach with no way forward.
    const [again] = await D.composeMorningMessages(today, [d7]);
    ck('a message is still composed for a member already messaged today — the coach must be able to resend',
       !!(again && again.message), again);
    ck('...and it still carries the phone, so WhatsApp can be opened',
       again.phone === '9000000026', again.phone);
    ck('...and is flagged as already sent, so the reply can say "sent again"',
       again.already_sent === true);

    // The cron, by contrast, must still refuse.
    const before7 = (await pool.query(
      `SELECT COUNT(*)::int n FROM notifications_log WHERE user_id=$1 AND type='morning_nudge'`,
      [d7])).rows[0].n;
    await D.sendMorningNudges(today);
    const after7 = (await pool.query(
      `SELECT COUNT(*)::int n FROM notifications_log WHERE user_id=$1 AND type='morning_nudge'`,
      [d7])).rows[0].n;
    ck('the 06:30 cron still refuses — the dedupe applies to the schedule, not to the coach',
       after7 === before7, { before7, after7 });

    // ── The coach routes, over real HTTP ──────────────────────────────────
    // These exist because the service layer passing told us nothing. The
    // route crashed with `ReferenceError: getISTDate is not defined` — it was
    // called in patients.js as if it were global, which is how it looks when
    // every other file that uses it defines its own copy at the top. The
    // endpoint 500'd and the coach's card said "Couldn't load today's
    // messages" with no clue why.
    //
    // Calling composeMorningMessages directly could never have caught that.
    // The route has to be exercised through HTTP, with a real token.
    console.log('\nCoach routes over HTTP');

    const express = require('express');
    const cookieParser = require('cookie-parser');
    const jwt = require('jsonwebtoken');
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/members', require('../routes/patients'));

    const coachId = (await pool.query(
      `INSERT INTO users (name, email, password, role, active)
       VALUES ('Route Coach','routecoach@x.com','x','monitor',true) RETURNING id`)).rows[0].id;
    const mem = await mk('Route Member', '9000000031');
    await pool.query(
      `INSERT INTO monitor_patients (monitor_id, patient_id, active) VALUES ($1,$2,true)`,
      [coachId, mem]);
    await pool.query(
      `INSERT INTO daily_logs (patient_id, log_date, weight_kg) VALUES ($1,$2,72.5)`,
      [mem, yesterday]);

    const srv2 = express().listen(0);
    srv2.close();
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    const tok = jwt.sign({ id: coachId, role: 'monitor', name: 'Route Coach' },
                         process.env.JWT_SECRET, { expiresIn: '1h' });
    const authed = (path, opts = {}) => fetch(base + path, {
      ...opts, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });

    try {
      const list = await authed('/api/members/morning-nudges');
      ck('GET /morning-nudges returns 200, not 500 (the getISTDate crash)',
         list.status === 200, list.status);
      const listBody = await list.json();
      ck('...and carries a date', typeof listBody.date === 'string', listBody.date);
      ck('...and the assigned member', Array.isArray(listBody.members), listBody);

      const one = await authed(`/api/members/${mem}/morning-message`);
      ck('GET /:id/morning-message returns 200', one.status === 200, one.status);
      const oneBody = await one.json();
      ck('...with a composed message', (oneBody.message || '').includes('72.5 kg'), oneBody.message);
      ck('...and the phone to open WhatsApp with', oneBody.phone === '9000000031', oneBody.phone);
      ck('...and a delivered flag so the card can show the difference',
         'delivered' in oneBody, Object.keys(oneBody));

      const rec = await authed(`/api/members/${mem}/morning-nudges/sent`,
        { method: 'POST', body: JSON.stringify({ message: oneBody.message }) });
      ck('POST /:id/morning-nudges/sent records it', rec.status === 200, rec.status);
      ck('...and is reflected as delivered',
         (await (await authed(`/api/members/${mem}/morning-message`)).json()).delivered === true);

      // A coach must not be able to read or message someone else's member.
      const otherCoach = (await pool.query(
        `INSERT INTO users (name, email, password, role, active)
         VALUES ('Other Coach','other@x.com','x','monitor',true) RETURNING id`)).rows[0].id;
      const otherTok = jwt.sign({ id: otherCoach, role: 'monitor', name: 'Other' },
                                process.env.JWT_SECRET, { expiresIn: '1h' });
      const forbidden = await fetch(`${base}/api/members/${mem}/morning-message`,
        { headers: { Authorization: `Bearer ${otherTok}` } });
      ck('a coach cannot read the morning message of a member who is not theirs',
         forbidden.status === 403 || forbidden.status === 404, forbidden.status);

      const noAuth = await fetch(`${base}/api/members/morning-nudges`);
      ck('the route requires a token', noAuth.status === 401, noAuth.status);
    } finally {
      server.close();
    }

  } catch (err) {
    fail++;
    console.log('  \u2717 suite threw: ' + (err && err.stack ? err.stack : err));
  } finally {
    await pool.end();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
