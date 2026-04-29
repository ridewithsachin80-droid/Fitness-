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
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
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
