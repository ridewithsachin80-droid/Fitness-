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
// 5. PATCH FOODS — always runs, inserts missing foods ON CONFLICT DO NOTHING
//    Add any food here and it will appear on next deploy even if the table
//    already has data. Safe to re-run — duplicates are silently skipped.
// ─────────────────────────────────────────────────────────────────────────────
const FOOD_PATCHES = [
  // ── format: [ name, name_hindi, name_local, category, source, verified, per_100g ] ──

  // Mixed Vegetables — cooked, standard Indian sabzi mix
  // (carrot, beans, peas, capsicum, corn — average nutrient values)
  ['Mixed Vegetables (Cooked)', 'मिक्स सब्जी', 'Mixed Sabzi', 'vegetable', 'nin', true, {
    calories: 65, protein: 2.5, total_carbs: 11.5, net_carbs: 8.5,
    fat: 1.5, fiber: 3.0, sugar: 4.5, saturated_fat: 0.2, trans_fat: 0, cholesterol: 0,
    omega3_ala: 0, omega3_epa: 0, omega3_dha: 0, omega6: 0, omega9_mufa: 0.8,
    vit_a: 120, vit_b1: 0.08, vit_b2: 0.07, vit_b3: 0.8, vit_b5: 0.3,
    vit_b6: 0.15, vit_b12: 0, vit_c: 22, vit_d: 0, vit_e: 0.8, vit_k: 35,
    folate: 45, biotin: 0, choline: 18,
    calcium: 40, iron: 1.2, magnesium: 22, phosphorus: 55,
    potassium: 310, sodium: 25, zinc: 0.5, copper: 0.1, manganese: 0.3, selenium: 1.2,
    glycemic_index: 32, glycemic_load: 4, probiotic: false, prebiotic_fiber: 1.0,
    lycopene: 0, beta_glucan: 0,
  }],

  // Mixed Vegetables (Stir-fried with oil)
  ['Mixed Vegetables (Stir-fried)', 'मिक्स सब्जी (तली)', 'Mixed Stir Fry', 'vegetable', 'nin', true, {
    calories: 95, protein: 2.5, total_carbs: 11.0, net_carbs: 8.0,
    fat: 4.5, fiber: 3.0, sugar: 4.0, saturated_fat: 0.5, trans_fat: 0, cholesterol: 0,
    omega3_ala: 80, omega3_epa: 0, omega3_dha: 0, omega6: 900, omega9_mufa: 2.5,
    vit_a: 115, vit_b1: 0.08, vit_b2: 0.07, vit_b3: 0.8, vit_b5: 0.3,
    vit_b6: 0.14, vit_b12: 0, vit_c: 20, vit_d: 0, vit_e: 1.2, vit_k: 32,
    folate: 42, biotin: 0, choline: 16,
    calcium: 38, iron: 1.1, magnesium: 20, phosphorus: 52,
    potassium: 295, sodium: 180, zinc: 0.5, copper: 0.1, manganese: 0.3, selenium: 1.0,
    glycemic_index: 35, glycemic_load: 4, probiotic: false, prebiotic_fiber: 1.0,
    lycopene: 0, beta_glucan: 0,
  }],

  // Mixed Vegetables (Frozen, uncooked) — for raw weight logging
  ['Mixed Vegetables (Frozen, Raw)', 'फ्रोज़न मिक्स सब्जी', 'Frozen Mixed Veg', 'vegetable', 'usda', true, {
    calories: 42, protein: 2.2, total_carbs: 8.5, net_carbs: 6.0,
    fat: 0.3, fiber: 2.5, sugar: 3.0, saturated_fat: 0.1, trans_fat: 0, cholesterol: 0,
    omega3_ala: 0, omega3_epa: 0, omega3_dha: 0, omega6: 0, omega9_mufa: 0,
    vit_a: 190, vit_b1: 0.07, vit_b2: 0.06, vit_b3: 0.7, vit_b5: 0.2,
    vit_b6: 0.12, vit_b12: 0, vit_c: 8, vit_d: 0, vit_e: 0.4, vit_k: 22,
    folate: 30, biotin: 0, choline: 12,
    calcium: 25, iron: 0.8, magnesium: 15, phosphorus: 40,
    potassium: 200, sodium: 45, zinc: 0.3, copper: 0.05, manganese: 0.2, selenium: 0.8,
    glycemic_index: 30, glycemic_load: 3, probiotic: false, prebiotic_fiber: 0.8,
    lycopene: 0, beta_glucan: 0,
  }],
];

async function patchFoods() {
  if (!FOOD_PATCHES.length) return;

  const client = await pool.connect();
  let added = 0;
  try {
    for (const [name, name_hindi, name_local, category, source, verified, per_100g] of FOOD_PATCHES) {
      const result = await client.query(
        `INSERT INTO foods (name, name_hindi, name_local, category, source, verified, per_100g)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (lower(name), source) DO NOTHING
         RETURNING id`,
        [name, name_hindi, name_local, category, source, verified, JSON.stringify(per_100g)]
      );
      if (result.rowCount > 0) added++;
    }
    if (added > 0) console.log(`🥦 Food patches: added ${added} new item(s)`);
    else           console.log(`ℹ️  Food patches: all items already present`);
  } catch (err) {
    console.error('⚠️  Food patch error (non-fatal):', err.message);
  } finally {
    client.release();
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
    await patchFoods();          // ← always runs, adds missing foods
  } catch (err) {
    console.error('❌ Startup error:', err.message);
  } finally {
    await pool.end();
  }

  console.log('\n🚀 Starting server…\n');
  require('./index.js');
}

main();
