/**
 * services/aiReads.js — one cached line per member per day (Sprint 10).
 *
 * WHY THIS EXISTS
 * Before this, three things described the same day in three places: Today's
 * read (computed on the phone), the 06:30 WhatsApp/push message (computed in
 * digests.js), and the evening recap. They agreed by luck. A member who read
 * "protein's behind" on the phone and "great day" in WhatsApp had no way to
 * know which was true.
 *
 * Now: the crons write the line into `ai_reads`, and Today, WhatsApp and push
 * read that row. Same words everywhere, once per member per day per kind.
 *
 * Pure text-building stays in digests.js/weeklyReport.js — this module only
 * stores, reads and hands out. `save` is idempotent: the UNIQUE index makes a
 * re-run (a cron restart, a manual replay) an update rather than a duplicate.
 */
const pool = require('../db/pool');

const KINDS = ['morning', 'evening', 'weekly'];

/** IST date string for an instant (the app's calendar day everywhere). */
function istDateStr(d = new Date()) {
  return new Date(d.getTime() + 5.5 * 3600000).toISOString().slice(0, 10);
}

/**
 * Store (or replace) the read for a member/day/kind.
 * Returns the saved row, or null when there is nothing to say — an empty text
 * is not worth a row, and writing one would make `get` report a read that
 * says nothing.
 */
async function save({ memberId, date, kind, text, facts = {}, source = 'cron' }) {
  if (!memberId || !date || !KINDS.includes(kind)) {
    throw new Error(`ai_reads.save: bad arguments (${memberId}, ${date}, ${kind})`);
  }
  const clean = String(text || '').trim();
  if (!clean) return null;
  const { rows } = await pool.query(
    `INSERT INTO ai_reads (patient_id, read_date, kind, text, facts, source)
     VALUES ($1, $2::date, $3, $4, $5, $6)
     ON CONFLICT (patient_id, read_date, kind)
     DO UPDATE SET text = EXCLUDED.text, facts = EXCLUDED.facts,
                   source = EXCLUDED.source, created_at = NOW()
     RETURNING id, patient_id, read_date, kind, text, facts, source, created_at`,
    [memberId, date, kind, clean, JSON.stringify(facts || {}), source]);
  return rows[0] || null;
}

/** One read, or null. */
async function get({ memberId, date, kind }) {
  const { rows } = await pool.query(
    `SELECT id, patient_id, read_date, kind, text, facts, source, created_at
       FROM ai_reads WHERE patient_id = $1 AND read_date = $2::date AND kind = $3`,
    [memberId, date, kind]);
  return rows[0] || null;
}

/**
 * The read to show a member right now: the evening one once it exists,
 * otherwise the morning one. Returns null when neither has been written —
 * the client then falls back to its own local read, so a missed cron never
 * leaves Today blank.
 */
async function current({ memberId, date, hour = null }) {
  const { rows } = await pool.query(
    `SELECT kind, text, facts, created_at FROM ai_reads
      WHERE patient_id = $1 AND read_date = $2::date AND kind IN ('morning','evening')
      ORDER BY CASE kind WHEN 'evening' THEN 0 ELSE 1 END
      LIMIT 1`,
    [memberId, date]);
  return rows[0] || null;
}

/** Every read for a day (debugging, the coach view, tests). */
async function forDay({ memberId, date }) {
  const { rows } = await pool.query(
    `SELECT kind, text, facts, source, created_at FROM ai_reads
      WHERE patient_id = $1 AND read_date = $2::date ORDER BY kind`,
    [memberId, date]);
  return rows;
}

module.exports = { save, get, current, forDay, istDateStr, KINDS };
