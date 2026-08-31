require('dotenv').config();
const { Pool, types } = require('pg');

// Tell pg to return DATE columns as plain 'YYYY-MM-DD' strings instead of
// JavaScript Date objects. This prevents dates serialising to ISO timestamps
// ("2026-04-29T00:00:00.000Z") which break every +T00:00:00 concatenation and
// every log_date === "YYYY-MM-DD" comparison in the client.
types.setTypeParser(types.builtins.DATE, val => val);

// Tell pg to return BIGINT (int8) as a JavaScript number.
//
// node-postgres returns int8 as a STRING by default, because a 64-bit integer
// can exceed Number.MAX_SAFE_INTEGER. Nothing in this schema declares BIGINT
// or BIGSERIAL — every id is SERIAL (int4) — so the only int8 values that ever
// reach us are COUNT()/SUM() results, which for a coaching roster are tiny.
//
// Leaving them as strings caused a whole class of silent bug. Some routes
// remembered to parseInt(); others didn't, and the ones that forgot produced
// things like "1 members assigned" — because `"1" !== 1` is true, so a plural
// check that looks correct always appends the s. Type-dependent bugs like that
// don't announce themselves; they just read as sloppy copy.
//
// Fixing it here rather than at ~20 call sites means the next COUNT someone
// adds is correct by default instead of correct only if they remember.
//
// NOTE: deliberately NOT touching NUMERIC (OID 1700). weight_kg, height_cm and
// the macro columns are numeric, the codebase parseFloat()s them everywhere,
// and pg returns numeric as a string on purpose to preserve precision.
types.setTypeParser(types.builtins.INT8, val => (val === null ? null : parseInt(val, 10)));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }  // Required for Railway
    : false,
  max: 3,                    // 3 connections max — enough for 5-10 users
  min: 0,                    // 0 warm connections — release when idle
  idleTimeoutMillis: 5000,   // release connection after 5s idle (was 30s)
  connectionTimeoutMillis: 3000,
});

pool.on('error', (err) => {
  // Log but do NOT exit — Railway recycles idle connections normally.
  // Calling process.exit() here would crash the server and cause 502 errors.
  console.error('Unexpected error on idle PostgreSQL client:', err.message);
});

// Verify connection on startup
pool.query('SELECT NOW()')
  .then(() => console.log('✅ PostgreSQL connected'))
  .catch((err) => console.error('❌ PostgreSQL connection failed:', err.message));

module.exports = pool;
