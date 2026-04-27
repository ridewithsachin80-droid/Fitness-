/**
 * startup.js — runs on every Railway deploy, before the server starts.
 *
 * On every boot:
 *  1. Runs schema.sql        (CREATE TABLE IF NOT EXISTS — always safe)
 *  2. Upserts admin password (always syncs from ADMIN_PASSWORD env var)
 *  3. Creates Padmini patient if missing
 *  4. Seeds foods table      (NIN India + USDA) — only if table is empty
 *  5. Starts the Express server
 *
 * CRITICAL (from handoff): admin upsert must ALWAYS run — no skip logic.
 * This ensures ADMIN_PASSWORD env var changes take effect on every deploy.
 */

require('dotenv').config();
const path  = require('path');
const fs    = require('fs');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. SCHEMA
// ─────────────────────────────────────────────────────────────────────────────
async function runSchema() {
  console.log('📦 Running database schema…');
  const sql = fs.readFileSync(path.join(__dirname, 'db/schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('✅ Schema ready');
}

// ─────────────────────────────────────────────────────────────────────────────
// 2 & 3. ADMIN + PATIENT SEED
// ─────────────────────────────────────────────────────────────────────────────
async function seedUsers() {
  console.log('🔑 Syncing admin credentials…');
  const bcrypt = require('bcryptjs');
  const adminPassword = process.env.ADMIN_PASSWORD || 'ChangeMe@123';
  const hash = await bcrypt.hash(adminPassword, 12);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const adminRes = await client.query(
      `INSERT INTO users (name, email, role, password)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password
       RETURNING id, name, email`,
      ['Sachin', 'sachin@healthmonitor.app', 'admin', hash]
    );
    const admin = adminRes.rows[0];

    const patientRes = await client.query(
      `INSERT INTO users (name, phone, role)
       VALUES ($1,$2,$3)
       ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, name, phone`,
      ['Mrs. Padmini', '9876543210', 'patient']
    );
    const patient = patientRes.rows[0];

    await client.query(
      `INSERT INTO patient_profiles
         (user_id, height_cm, start_weight, target_weight, conditions, water_target)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id) DO NOTHING`,
      [patient.id, 165, 93, 65,
       JSON.stringify(['fatty_liver','pre_diabetic','b12_deficient']), 3000]
    );

    await client.query(
      `INSERT INTO monitor_patients (monitor_id, patient_id)
       VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [admin.id, patient.id]
    );

    await client.query('COMMIT');
    console.log(`✅ Admin:   ${admin.name} (${admin.email})`);
    console.log(`✅ Patient: ${patient.name} (${patient.phone})`);
    console.log(`   Password synced from ADMIN_PASSWORD env var`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ User seed failed:', err.message);
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. FOODS SEED — only runs when the foods table is empty
//    Uses the same data arrays from the seed scripts but inline so no
//    child_process / execSync needed. Safe on every redeploy.
// ─────────────────────────────────────────────────────────────────────────────
async function seedFoodsIfEmpty() {
  const { rows } = await pool.query('SELECT COUNT(*) FROM foods');
  const count = parseInt(rows[0].count);

  if (count > 0) {
    console.log(`ℹ️  Foods table already has ${count} rows — skipping seed`);
    return;
  }

  console.log('🌱 Foods table is empty — running seed scripts…');

  // Run each seed script as a module. They call pool.end() at the end,
  // so we patch that out temporarily to share this process's pool.
  // Instead we just require the data and insert directly here.

  try {
    console.log('   Seeding NIN India foods…');
    const ninScript = path.join(__dirname, 'scripts/seed-nin-india.js');
    const usdaScript = path.join(__dirname, 'scripts/seed-usda.js');

    // We spawn them as child processes so their pool.end() doesn't
    // kill the startup process's connection.
    const { execFileSync } = require('child_process');
    const nodeExe = process.execPath;

    execFileSync(nodeExe, [ninScript], {
      stdio: 'inherit',
      env: process.env,
      timeout: 120_000,   // 2 min max
    });

    console.log('   Seeding USDA / branded foods…');
    execFileSync(nodeExe, [usdaScript], {
      stdio: 'inherit',
      env: process.env,
      timeout: 60_000,
    });

    console.log('✅ Foods seed complete');
  } catch (err) {
    // Seed failure is non-fatal — app still works, just no food data yet
    console.error('⚠️  Foods seed error (non-fatal):', err.message);
    console.error('   Run manually: node server/scripts/seed-nin-india.js');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  try {
    await runSchema();
    await seedUsers();
    await seedFoodsIfEmpty();
  } catch (err) {
    console.error('❌ Startup error:', err.message);
    // Non-fatal — still start the server
  } finally {
    await pool.end();
  }

  console.log('\n🚀 Starting server…\n');
  require('./index.js');
}

main();
