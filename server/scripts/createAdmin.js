/**
 * One-time script to create the admin/monitor user (Sachin).
 * Run ONCE after deploying the schema:
 *
 *   node server/scripts/createAdmin.js
 *
 * Then create Mrs. Padmini as a patient via the API:
 *   POST /api/patients
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pool = require('../db/pool');
const bcrypt = require('bcryptjs');

async function seed() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ── Create admin / monitor (Sachin) ─────────────────────────────────────
    const adminPassword = process.env.ADMIN_PASSWORD || 'ChangeMe@123';
    const hash = await bcrypt.hash(adminPassword, 12);

    const adminResult = await client.query(
      `INSERT INTO users (name, email, role, password)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password
       RETURNING id, name, email, role`,
      ['Sachin', 'sachin@healthmonitor.app', 'admin', hash]
    );
    const admin = adminResult.rows[0];
    console.log(`\n✅ Admin created: ${admin.name} (${admin.email}) [id=${admin.id}]`);

    // ── Create patient (Mrs. Padmini) ────────────────────────────────────────
    const patientResult = await client.query(
      `INSERT INTO users (name, phone, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, name, phone, role`,
      ['Mrs. Padmini', '9876543210', 'patient']
    );
    const patient = patientResult.rows[0];

    // Patient profile
    await client.query(
      `INSERT INTO patient_profiles
         (user_id, height_cm, start_weight, target_weight, conditions, water_target)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE
         SET height_cm = EXCLUDED.height_cm,
             start_weight = EXCLUDED.start_weight,
             target_weight = EXCLUDED.target_weight,
             conditions = EXCLUDED.conditions`,
      [
        patient.id,
        165,
        93,
        65,
        JSON.stringify(['fatty_liver', 'pre_diabetic', 'b12_deficient']),
        3000,
      ]
    );
    console.log(`✅ Patient created: ${patient.name} (${patient.phone}) [id=${patient.id}]`);

    // Link patient to admin/monitor
    await client.query(
      `INSERT INTO monitor_patients (monitor_id, patient_id)
       VALUES ($1, $2)
       ON CONFLICT (monitor_id, patient_id) DO NOTHING`,
      [admin.id, patient.id]
    );
    console.log(`✅ Linked ${patient.name} → ${admin.name}`);

    await client.query('COMMIT');

    console.log('\n─────────────────────────────────────────');
    console.log('Seed complete. Login credentials:');
    console.log(`  Monitor email:    sachin@healthmonitor.app`);
    console.log(`  Monitor password: ${adminPassword}`);
    console.log(`  Patient phone:    9876543210  (OTP login)`);
    console.log('─────────────────────────────────────────\n');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed failed:', err.message);
    throw err;
  } finally {
    client.release();
    pool.end();
  }
}

seed().catch(() => process.exit(1));
