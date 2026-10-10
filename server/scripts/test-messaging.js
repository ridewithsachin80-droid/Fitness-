/**
 * scripts/test-messaging.js — multi-channel delivery.
 *
 * This is the first thing in the app that spends money per message and acts on
 * consent, so the assertions that matter are the ones about NOT sending:
 * opt-out, quiet hours, unusable numbers, and never paying for a second
 * channel after the first succeeded.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
const pool = require('../db/pool');
const M = require('../services/messaging');

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e || '').slice(0, 200))); };

(async () => {
  console.log('\n[1] phone normalisation for Indian numbers');
  const nums = [
    ['9741771679',     '919741771679'],
    ['+91 97417 71679','919741771679'],
    ['09741771679',    '919741771679'],
    ['919741771679',   '919741771679'],
    ['97417-71679',    '919741771679'],
    ['12345',          null],
    ['',               null],
    [null,             null],
  ];
  for (const [raw, want] of nums) {
    ck(`"${raw}" -> ${want ?? 'rejected'}`, M.normalisePhone(raw) === want, M.normalisePhone(raw));
  }

  console.log('\n[2] quiet hours are in IST regardless of server timezone');
  const at = (istHour) => {
    // Build a UTC instant that is `istHour` in IST
    const d = new Date(Date.UTC(2026, 7, 22, (istHour - 5 + 24) % 24, 30 - 30));
    return d;
  };
  ck('23:00 IST is quiet', M.inQuietHours(at(23)) === true, M.istHour(at(23)));
  ck('03:00 IST is quiet', M.inQuietHours(at(3)) === true, M.istHour(at(3)));
  ck('10:00 IST is not',   M.inQuietHours(at(10)) === false, M.istHour(at(10)));
  ck('18:00 IST is not',   M.inQuietHours(at(18)) === false, M.istHour(at(18)));

  console.log('\n[3] nothing is sent without credentials, and it says so');
  const wa = await M.sendWhatsApp('9741771679', 'nudge', ['Sachin']);
  ck('whatsapp skips cleanly', wa.ok === false && /not configured/.test(wa.skipped || ''), wa);
  const sms = await M.sendSMS('9741771679', 'nudge', ['Sachin']);
  ck('sms skips cleanly', sms.ok === false && /not configured/.test(sms.skipped || ''), sms);
  ck('neither throws', true);

  console.log('\n[4] an unusable number is refused before any API call');
  process.env.WHATSAPP_TOKEN = 'test-token';
  process.env.WHATSAPP_PHONE_ID = '123';
  const badNum = await M.sendWhatsApp('12345', 'nudge', ['X']);
  ck('short number rejected locally', /unusable/.test(badNum.skipped || ''), badNum);
  const noTpl = await M.sendWhatsApp('9741771679', 'nonexistent', ['X']);
  ck('unknown template rejected locally', /no whatsapp template/.test(noTpl.skipped || ''), noTpl);
  delete process.env.WHATSAPP_TOKEN; delete process.env.WHATSAPP_PHONE_ID;

  console.log('\n[5] consent and preferences');
  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  const mk = async (phone) => (await pool.query(
    `INSERT INTO users (name,phone,password,role,active) VALUES ('M',$1,'x','patient',true) RETURNING id`,
    [phone])).rows[0].id;

  const optedOut = await mk('9000000001');
  await pool.query(`INSERT INTO patient_profiles (user_id, notify_opted_out) VALUES ($1, true)`, [optedOut]);
  let r = await M.notify(optedOut, 'nudge', ['A'], { force: true });
  ck('an opted-out member is never contacted', r.delivered === null && /opted out/.test(r.attempts[0].skipped), r);

  const normal = await mk('9000000002');
  await pool.query(`INSERT INTO patient_profiles (user_id) VALUES ($1)`, [normal]);
  const prefs = await M.preferences(normal);
  ck('push defaults on', prefs.push === true, prefs);
  ck('whatsapp defaults on', prefs.whatsapp === true, prefs);
  ck('sms defaults OFF — it costs and it intrudes', prefs.sms === false, prefs);
  ck('not opted out by default', prefs.optedOut === false, prefs);

  console.log('\n[6] quiet hours block a real send unless forced');
  const wasQuiet = M.inQuietHours();
  process.env.QUIET_HOURS_FROM = '0'; process.env.QUIET_HOURS_TO = '24';   // everything is quiet
  r = await M.notify(normal, 'nudge', ['A']);
  ck('blocked during quiet hours', r.delivered === null && /quiet hours/.test(r.attempts[0].skipped), r);
  r = await M.notify(normal, 'nudge', ['A'], { force: true });
  ck('force overrides quiet hours', !/quiet hours/.test(r.attempts[0]?.skipped || ''), r.attempts[0]);
  delete process.env.QUIET_HOURS_FROM; delete process.env.QUIET_HOURS_TO;

  console.log('\n[7] every attempt is logged');
  const { rows: logs } = await pool.query(
    `SELECT channel, ok FROM message_log WHERE user_id = $1 ORDER BY id`, [normal]);
  ck('delivery attempts recorded', logs.length > 0, logs.length);
  ck('each row names its channel', logs.every(l => ['push','whatsapp','sms'].includes(l.channel)), logs);

  console.log('\n[8] a missing member does not throw');
  r = await M.notify(999999, 'nudge', ['X'], { force: true });
  ck('unknown member handled', r.delivered === null && /no such member/.test(r.attempts[0].skipped), r);

  console.log(`\n\u2550\u2550\u2550 MESSAGING: ${pass} passed, ${fail} failed \u2550\u2550\u2550`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
