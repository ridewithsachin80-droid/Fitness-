require('dotenv').config();
const { Pool, types } = require('pg');

// Tell pg to return DATE columns as plain 'YYYY-MM-DD' strings instead of
// JavaScript Date objects. This prevents dates serialising to ISO timestamps
// ("2026-04-29T00:00:00.000Z") which break every +T00:00:00 concatenation and
// every log_date === "YYYY-MM-DD" comparison in the client.
types.setTypeParser(types.builtins.DATE, val => val);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }  // Required for Railway
    : false,
  max: 3,                    // 5 users = 3 connections is plenty (was 10)
  min: 1,                    // keep 1 warm connection always
  idleTimeoutMillis: 10000,  // release idle connections after 10s (was 30s)
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
