/**
 * startup.js — Railway entry point
 *
 * On every boot:
 *  1. Runs schema.sql  (CREATE TABLE IF NOT EXISTS — safe to repeat)
 *  2. Creates default admin + patient if they don't exist yet
 *  3. Starts the Express server
 */
require('dotenv').config();
const { execSync } = require('child_process');
const path  = require('path');
const fs    = require('fs');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function runSchema() {
  console.log('📦 Running database schema…');
  const sql = fs.readFileSync(path.join(__dirname, 'db/schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('✅ Schema ready');
}

async function seedIfEmpty() {
  console.log('🌱 Syncing admin credentials…');
  const bcrypt = require('bcryptjs');

  const adminPassword = process.env.ADMIN_PASSWORD || 'ChangeMe@123';
  const hash = await bcrypt.hash(adminPassword, 12);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const adminRes = await client.query(
      `INSERT INTO users (name, email, role, password)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password
       RETURNING id, name, email`,
      ['Sachin', 'sachin@healthmonitor.app', 'admin', hash]
    );
    const admin = adminRes.rows[0];

    const patientRes = await client.query(
      `INSERT INTO users (name, phone, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, name, phone`,
      ['Mrs. Padmini', '9876543210', 'patient']
    );
    const patient = patientRes.rows[0];

    await client.query(
      `INSERT INTO patient_profiles
         (user_id, height_cm, start_weight, target_weight, conditions, water_target)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO NOTHING`,
      [patient.id, 165, 93, 65,
       JSON.stringify(['fatty_liver', 'pre_diabetic', 'b12_deficient']), 3000]
    );

    await client.query(
      `INSERT INTO monitor_patients (monitor_id, patient_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [admin.id, patient.id]
    );

    await client.query('COMMIT');
    console.log(`✅ Admin:   ${admin.name} (${admin.email})`);
    console.log(`✅ Patient: ${patient.name} (${patient.phone})`);
    console.log(`   Password: ${adminPassword}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed failed:', err.message);
  } finally {
    client.release();
  }
}

async function main() {
  try {
    await runSchema();
    await seedIfEmpty();
  } catch (err) {
    console.error('❌ Startup error:', err.message);
    // Don't exit — still start the server even if seed fails
  } finally {
    await pool.end();
  }

  // Hand off to the main server
  console.log('\n🚀 Starting server…\n');
  require('./index.js');
}

main();
