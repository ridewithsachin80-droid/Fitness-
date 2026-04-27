require('dotenv').config();
const { Pool } = require('pg');

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
