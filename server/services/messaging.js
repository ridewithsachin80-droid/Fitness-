/**
 * messaging.js — reaches a member on whatever channel actually works.
 *
 * ── The problem this solves ─────────────────────────────────────────────────
 *
 * Coach messages currently live in the app. A member who has stopped logging
 * does not open the app, so "we miss your logs" is delivered precisely to the
 * people who do not need it and never reaches the people who do. Push helps a
 * little, but push permission is usually granted by engaged members and
 * revoked or ignored by everyone else.
 *
 * WhatsApp is where Indian members already are. SMS reaches a phone that has
 * no data. Between them they cover almost everyone.
 *
 * ── Channel order, and why ──────────────────────────────────────────────────
 *
 *   push      free, instant, but only for members who granted permission
 *   whatsapp  highest read rate, costs per conversation, needs an approved
 *             template for anything business-initiated
 *   sms       reaches a feature phone with no data, cheapest, most limited
 *
 * We try in that order and stop at the first success, because paying for a
 * WhatsApp conversation to a member who just read the push is waste, and three
 * copies of the same nudge reads as pestering.
 *
 * ── What this file will not do ──────────────────────────────────────────────
 *
 * It will not send outside quiet hours, it will not send to a member who has
 * opted out, and it will not send free-form text on WhatsApp — business
 * -initiated messages must match a template Meta has approved, and inventing
 * text at runtime gets a number banned rather than delivered.
 */

const axios = require('axios');
const pool = require('../db/pool');

const IST_OFFSET_MIN = 330;

// ── configuration ────────────────────────────────────────────────────────────
const cfg = () => ({
  msg91Key:      process.env.MSG91_API_KEY,
  msg91Sender:   process.env.MSG91_SENDER_ID,          // 6-char DLT header
  smsTemplates:  {                                      // DLT template IDs
    nudge:   process.env.MSG91_TPL_NUDGE,
    summary: process.env.MSG91_TPL_SUMMARY,
    coach:   process.env.MSG91_TPL_COACH,
  },
  waNumber:      process.env.WHATSAPP_NUMBER,           // sender, digits only
  waToken:       process.env.WHATSAPP_TOKEN,            // Meta / BSP token
  waPhoneId:     process.env.WHATSAPP_PHONE_ID,         // Meta phone number id
  waTemplates:   {
    nudge:   process.env.WA_TPL_NUDGE   || 'fitlife_log_reminder',
    summary: process.env.WA_TPL_SUMMARY || 'fitlife_weekly_summary',
    coach:   process.env.WA_TPL_COACH   || 'fitlife_coach_message',
  },
  quietFrom:     parseInt(process.env.QUIET_HOURS_FROM ?? '21', 10),  // 21:00
  quietTo:       parseInt(process.env.QUIET_HOURS_TO   ?? '7',  10),  // 07:00
});

const has = (...vals) => vals.every(v => v && String(v).trim() && !/^your-/.test(String(v)));

/** Current hour in IST, regardless of where the server runs. */
function istHour(now = new Date()) {
  return new Date(now.getTime() + IST_OFFSET_MIN * 60000).getUTCHours();
}

/**
 * Nobody wants a nutrition nudge at 2am. Urgent messages may override, but
 * nothing this app sends is genuinely urgent.
 */
function inQuietHours(now = new Date()) {
  const { quietFrom, quietTo } = cfg();
  const h = istHour(now);
  return quietFrom > quietTo ? (h >= quietFrom || h < quietTo)
                             : (h >= quietFrom && h < quietTo);
}

/** Indian mobile numbers, normalised to the 91XXXXXXXXXX form providers expect. */
function normalisePhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 10) return `91${d}`;
  if (d.length === 12 && d.startsWith('91')) return d;
  if (d.length === 11 && d.startsWith('0')) return `91${d.slice(1)}`;
  return null;                                   // not a number we can send to
}

// ── channel implementations ──────────────────────────────────────────────────

async function sendWhatsApp(phone, templateKey, params) {
  const c = cfg();
  if (!has(c.waToken, c.waPhoneId)) return { ok: false, skipped: 'whatsapp not configured' };

  const to = normalisePhone(phone);
  if (!to) return { ok: false, skipped: 'unusable phone number' };

  const name = c.waTemplates[templateKey];
  if (!name) return { ok: false, skipped: `no whatsapp template for "${templateKey}"` };

  try {
    const { data } = await axios.post(
      `https://graph.facebook.com/v21.0/${c.waPhoneId}/messages`,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name,
          language: { code: 'en' },
          // Body variables only. Free-form text is not permitted for a
          // business-initiated message and would be rejected outright.
          components: params.length
            ? [{ type: 'body', parameters: params.map(t => ({ type: 'text', text: String(t).slice(0, 200) })) }]
            : undefined,
        },
      },
      { headers: { Authorization: `Bearer ${c.waToken}`, 'content-type': 'application/json' }, timeout: 15000 }
    );
    return { ok: true, id: data?.messages?.[0]?.id || null };
  } catch (err) {
    const detail = err.response?.data?.error?.message || err.message;
    return { ok: false, error: detail };
  }
}

async function sendSMS(phone, templateKey, params) {
  const c = cfg();
  const tpl = c.smsTemplates[templateKey];
  if (!has(c.msg91Key, tpl)) return { ok: false, skipped: 'sms not configured for this message type' };

  const to = normalisePhone(phone);
  if (!to) return { ok: false, skipped: 'unusable phone number' };

  try {
    // MSG91 flow API: variables are named var1..varN in the DLT template
    const vars = {};
    params.forEach((v, i) => { vars[`var${i + 1}`] = String(v).slice(0, 60); });

    const { data } = await axios.post(
      'https://control.msg91.com/api/v5/flow/',
      { template_id: tpl, sender: c.msg91Sender, recipients: [{ mobiles: to, ...vars }] },
      { headers: { authkey: c.msg91Key, 'content-type': 'application/json' }, timeout: 15000 }
    );
    return data?.type === 'success' || data?.message
      ? { ok: true, id: data?.request_id || null }
      : { ok: false, error: JSON.stringify(data).slice(0, 200) };
  } catch (err) {
    return { ok: false, error: err.response?.data?.message || err.message };
  }
}

async function sendPush(userId, title, body, type) {
  try {
    const push = require('./pushService');
    await push.sendToUser(userId, title, body, type);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── preferences and opt-out ──────────────────────────────────────────────────

async function preferences(userId) {
  try {
    const { rows } = await pool.query(
      `SELECT notify_push, notify_whatsapp, notify_sms, notify_opted_out
       FROM patient_profiles WHERE user_id = $1`, [userId]);
    const p = rows[0] || {};
    return {
      push:     p.notify_push     !== false,
      whatsapp: p.notify_whatsapp !== false,
      sms:      p.notify_sms      !== false,
      optedOut: p.notify_opted_out === true,
    };
  } catch {
    // Default to permissive on push only. If we cannot read preferences we
    // must not assume consent for a paid channel.
    return { push: true, whatsapp: false, sms: false, optedOut: false };
  }
}

async function logDelivery(userId, channel, templateKey, result) {
  try {
    await pool.query(
      `INSERT INTO message_log (user_id, channel, template_key, ok, detail)
       VALUES ($1,$2,$3,$4,$5)`,
      [userId, channel, templateKey, !!result.ok,
       (result.error || result.skipped || result.id || '').toString().slice(0, 300)]);
  } catch { /* logging must never break sending */ }
}

// ── the entry point ──────────────────────────────────────────────────────────

/**
 * @param userId       member
 * @param templateKey  'nudge' | 'summary' | 'coach'
 * @param params       ordered template variables, e.g. [firstName, detail]
 * @param opts.title   push title
 * @param opts.body    push body, and the in-app fallback text
 * @param opts.force   ignore quiet hours (use sparingly; nothing here is urgent)
 * @returns { delivered:string|null, attempts:[] }
 */
async function notify(userId, templateKey, params = [], opts = {}) {
  const attempts = [];

  const { rows } = await pool.query(`SELECT phone, name FROM users WHERE id = $1`, [userId]);
  const user = rows[0];
  if (!user) return { delivered: null, attempts: [{ channel: 'none', skipped: 'no such member' }] };

  const prefs = await preferences(userId);
  if (prefs.optedOut) {
    return { delivered: null, attempts: [{ channel: 'none', skipped: 'member has opted out' }] };
  }
  if (!opts.force && inQuietHours()) {
    return { delivered: null, attempts: [{ channel: 'none', skipped: 'quiet hours' }] };
  }

  // Cheapest first, stop at the first success. Sending all three is both
  // wasteful and irritating.
  const chain = [
    prefs.push     && ['push',     () => sendPush(userId, opts.title || 'FitLife', opts.body || '', templateKey)],
    prefs.whatsapp && ['whatsapp', () => sendWhatsApp(user.phone, templateKey, params)],
    prefs.sms      && ['sms',      () => sendSMS(user.phone, templateKey, params)],
  ].filter(Boolean);

  for (const [channel, run] of chain) {
    const result = await run();
    attempts.push({ channel, ...result });
    await logDelivery(userId, channel, templateKey, result);
    if (result.ok) return { delivered: channel, attempts };
  }

  return { delivered: null, attempts };
}

module.exports = {
  notify, sendWhatsApp, sendSMS, preferences,
  normalisePhone, inQuietHours, istHour,
};
