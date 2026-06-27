/**
 * startup.js — Railway entry point, runs before the server starts on every deploy.
 *
 * Steps on every boot:
 *  1. Runs schema.sql        (CREATE TABLE IF NOT EXISTS — always safe)
 *  2. Upserts admin account  (always syncs password from ADMIN_PASSWORD env var)
 *  3. Seeds foods table      (NIN India + USDA) — only if table is empty
 *  4. Patches foods          (adds missing items ON CONFLICT DO NOTHING)
 *  5. Runs Kannada aliases migration — once only, tracked in migrations table
 *  6. Starts the Express server (require('./index.js'))
 *
 * CRITICAL: Admin upsert always runs — no skip logic.
 * This ensures ADMIN_PASSWORD env var changes take effect on every deploy.
 *
 * Required env vars:
 *   DATABASE_URL      — PostgreSQL connection string (set by Railway)
 *   ADMIN_NAME        — Admin display name         (default: 'Admin')
 *   ADMIN_EMAIL       — Admin login email          (default: 'admin@fitlife.app')
 *   ADMIN_PASSWORD    — Admin login password       (default: 'ChangeMe@123')
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
// 2. ADMIN SEED — always upserts from env vars, never hardcoded credentials
// ─────────────────────────────────────────────────────────────────────────────
async function seedUsers() {
  console.log('🔑 Syncing admin credentials…');
  const bcrypt = require('bcryptjs');

  const adminName     = process.env.ADMIN_NAME     || 'Admin';
  const adminEmail    = process.env.ADMIN_EMAIL    || 'admin@fitlife.app';
  const adminPassword = process.env.ADMIN_PASSWORD || 'ChangeMe@123';

  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
    console.warn('⚠️  ADMIN_EMAIL or ADMIN_PASSWORD env var not set — using insecure defaults!');
    console.warn('   Set these in Railway environment variables before going to production.');
  }

  const hash = await bcrypt.hash(adminPassword, 12);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const adminRes = await client.query(
      `INSERT INTO users (name, email, role, password)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE
         SET name = EXCLUDED.name,
             password = EXCLUDED.password
       RETURNING id, name, email`,
      [adminName, adminEmail, 'admin', hash]
    );
    const admin = adminRes.rows[0];

    await client.query('COMMIT');
    console.log(`✅ Admin: ${admin.name} (${admin.email}) — password synced`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Admin seed failed:', err.message);
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. FOODS SEED — only runs when the foods table is empty
// ─────────────────────────────────────────────────────────────────────────────
async function seedFoodsIfEmpty() {
  const { rows } = await pool.query('SELECT COUNT(*) FROM foods');
  const count = parseInt(rows[0].count);

  if (count > 0) {
    console.log(`ℹ️  Foods table already has ${count} rows — skipping seed`);
    return;
  }

  console.log('🌱 Foods table is empty — running seed scripts…');

  try {
    const ninScript  = path.join(__dirname, 'scripts/seed-nin-india.js');
    const usdaScript = path.join(__dirname, 'scripts/seed-usda.js');
    const { execFileSync } = require('child_process');
    const nodeExe = process.execPath;

    console.log('   Seeding NIN India foods…');
    execFileSync(nodeExe, [ninScript], {
      stdio: 'inherit',
      env: process.env,
      timeout: 120_000,
    });

    console.log('   Seeding USDA / branded foods…');
    execFileSync(nodeExe, [usdaScript], {
      stdio: 'inherit',
      env: process.env,
      timeout: 60_000,
    });

    console.log('✅ Foods seed complete');
  } catch (err) {
    console.error('⚠️  Foods seed error (non-fatal):', err.message);
    console.error('   Run manually: node server/scripts/seed-nin-india.js');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3b. EXERCISE LIBRARY SEED — only runs when the exercises table is empty
// ─────────────────────────────────────────────────────────────────────────────
const BUILT_IN_EXERCISES = [
  // [name, muscle_group, equipment]
  ['Barbell Bench Press',      'chest',     'barbell'],
  ['Incline Bench Press',      'chest',     'barbell'],
  ['Dumbbell Bench Press',     'chest',     'dumbbell'],
  ['Decline Bench Press',      'chest',     'barbell'],
  ['Push-ups',                 'chest',     'bodyweight'],
  ['Cable Chest Fly',          'chest',     'cable'],
  ['Dumbbell Flyes',           'chest',     'dumbbell'],
  ['Chest Dips',               'chest',     'bodyweight'],

  ['Deadlift',                 'back',      'barbell'],
  ['Barbell Row',              'back',      'barbell'],
  ['Lat Pulldown',             'back',      'machine'],
  ['Pull-ups',                 'back',      'bodyweight'],
  ['Seated Cable Row',         'back',      'cable'],
  ['T-Bar Row',                'back',      'barbell'],
  ['Single-Arm Dumbbell Row',  'back',      'dumbbell'],

  ['Back Squat',               'legs',      'barbell'],
  ['Front Squat',              'legs',      'barbell'],
  ['Leg Press',                'legs',      'machine'],
  ['Romanian Deadlift',        'legs',      'barbell'],
  ['Leg Curl',                 'legs',      'machine'],
  ['Leg Extension',            'legs',      'machine'],
  ['Walking Lunges',           'legs',      'dumbbell'],
  ['Bulgarian Split Squat',    'legs',      'dumbbell'],
  ['Calf Raise',               'legs',      'machine'],
  ['Hip Thrust',               'legs',      'barbell'],

  ['Overhead Press',           'shoulders', 'barbell'],
  ['Dumbbell Shoulder Press',  'shoulders', 'dumbbell'],
  ['Lateral Raise',            'shoulders', 'dumbbell'],
  ['Front Raise',              'shoulders', 'dumbbell'],
  ['Face Pull',                'shoulders', 'cable'],
  ['Arnold Press',             'shoulders', 'dumbbell'],
  ['Rear Delt Fly',            'shoulders', 'dumbbell'],

  ['Barbell Curl',             'arms',      'barbell'],
  ['Dumbbell Curl',            'arms',      'dumbbell'],
  ['Hammer Curl',               'arms',      'dumbbell'],
  ['Tricep Pushdown',          'arms',      'cable'],
  ['Skull Crusher',            'arms',      'barbell'],
  ['Close-Grip Bench Press',   'arms',      'barbell'],
  ['Tricep Dips',              'arms',      'bodyweight'],

  ['Plank',                    'core',      'bodyweight'],
  ['Hanging Leg Raise',        'core',      'bodyweight'],
  ['Cable Crunch',             'core',      'cable'],
  ['Russian Twist',            'core',      'bodyweight'],
  ['Ab Wheel Rollout',         'core',      'bodyweight'],

  ['Clean and Press',          'full_body', 'barbell'],
  ['Kettlebell Swing',         'full_body', 'kettlebell'],
  ['Burpees',                  'full_body', 'bodyweight'],
  ["Farmer's Carry",           'full_body', 'dumbbell'],
];

async function seedExercisesIfEmpty() {
  const { rows } = await pool.query('SELECT COUNT(*) FROM exercises');
  const count = parseInt(rows[0].count);

  if (count > 0) {
    console.log(`ℹ️  Exercises table already has ${count} rows — skipping seed`);
    return;
  }

  console.log('🏋️  Seeding exercise library…');
  try {
    for (const [name, muscle_group, equipment] of BUILT_IN_EXERCISES) {
      await pool.query(
        `INSERT INTO exercises (name, muscle_group, equipment, created_by)
         VALUES ($1, $2, $3, NULL)
         ON CONFLICT (name) DO NOTHING`,
        [name, muscle_group, equipment]
      );
    }
    console.log(`✅ Exercise library seeded — ${BUILT_IN_EXERCISES.length} exercises`);
  } catch (err) {
    console.error('⚠️  Exercise seed error (non-fatal):', err.message);
  }
}

//    Add any food here and it will appear on next deploy. Safe to re-run.
// ─────────────────────────────────────────────────────────────────────────────
const FOOD_PATCHES = [
  // format: [ name, name_hindi, name_local, category, source, verified, per_100g ]

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
// 5. KANNADA ALIASES MIGRATION — runs once, tracked in migrations table
// ─────────────────────────────────────────────────────────────────────────────
async function runKannadaMigration() {
  const MIGRATION_NAME = 'kannada_aliases_v1';
  try {
    const already = await pool.query(
      'SELECT id FROM migrations WHERE name = $1',
      [MIGRATION_NAME]
    );
    if (already.rows.length > 0) {
      console.log('ℹ️  Kannada aliases already seeded — skipping');
      return;
    }

    console.log('🌿 Seeding Kannada food aliases…');

    const aliases = [
      // Vegetables
      ['["Bendekai","ಬೆಂಡೆಕಾಯಿ","Bendekaayi","Bhindi"]',
       ['%okra%','%ladies finger%','%bhindi%','%bendekai%']],
      ['["Badanekai","ಬದನೆಕಾಯಿ","Badanekaayi","Baingan"]',
       ['%brinjal%','%eggplant%','%aubergine%','%baingan%']],
      ['["Hagalakai","ಹಾಗಲಕಾಯಿ","Hagalakaayi","Karela"]',
       ['%bitter gourd%','%bitter melon%','%karela%']],
      ['["Balekai","ಬಾಳೆಕಾಯಿ","Balekaayi","Kachcha Kela"]',
       ['%raw banana%','%green banana%','%plantain%','%kacha kela%']],
      ['["Nuggekai","ನುಗ್ಗೆಕಾಯಿ","Nuggekaayi","Murungakkai","Sahjan"]',
       ['%drumstick%','%moringa pod%','%sahjan%']],
      ['["Heerekai","ಹೀರೆಕಾಯಿ","Heerekaayi","Turai","Ridge gourd"]',
       ['%ridge gourd%','%luffa%','%turai%']],
      ['["Kumbalakai","ಕುಂಬಳಕಾಯಿ","Kumbalakaayi","Ash gourd","Petha"]',
       ['%ash gourd%','%white pumpkin%','%winter melon%','%petha%']],
      ['["Sihi kumbalakai","ಸಿಹಿ ಕುಂಬಳಕಾಯಿ","Kaddu","Pumpkin"]',
       ['%pumpkin%','%yellow pumpkin%','%kaddu%']],
      ['["Padavalakai","ಪಡವಲಕಾಯಿ","Padavalakaayi","Chichinda"]',
       ['%snake gourd%','%chichinda%']],
      ['["Gorikai","ಗೋರಿಕಾಯಿ","Gorikaayi","Gawar","Cluster beans"]',
       ['%cluster beans%','%guar beans%','%gawar%']],
      ['["Kesavina gedde","ಕೆಸವಿನ ಗೆಡ್ಡೆ","Arbi","Taro"]',
       ['%colocasia%','%taro%','%arbi%','%eddoe%']],
      ['["Avarekai","ಅವರೆಕಾಯಿ","Avarekaayi","Hyacinth bean","Field bean"]',
       ['%hyacinth bean%','%field bean%','%avare%']],
      ['["Mavinakai","ಮಾವಿನಕಾಯಿ","Mavinakaayi","Raw mango","Kacha Aam"]',
       ['%raw mango%','%green mango%','%kacha aam%']],
      ['["Halasina kai","ಹಲಸಿನ ಕಾಯಿ","Raw jackfruit","Kathal"]',
       ['%raw jackfruit%','%green jackfruit%','%kathal%']],
      ['["Sorekai","ಸೊರೆಕಾಯಿ","Lauki","Bottle gourd"]',
       ['%bottle gourd%','%lauki%','%dudhi%','%ghiya%']],
      // Leafy greens & herbs
      ['["Nugge soppu","ನುಗ್ಗೆ ಸೊಪ್ಪು","Moringa leaves","Drumstick leaves"]',
       ['%moringa leaves%','%drumstick leaves%','%murungai keerai%']],
      ['["Menthya soppu","ಮೆಂತ್ಯ ಸೊಪ್ಪು","Methi leaves","Fenugreek leaves"]',
       ['%fenugreek leaves%','%methi leaves%','%methi saag%']],
      ['["Karibevu","ಕರಿಬೇವು","Curry leaves","Kadi patta"]',
       ['%curry leaves%','%curry leaf%','%kadi patta%']],
      ['["Kottambari soppu","ಕೊತ್ತಂಬರಿ ಸೊಪ್ಪು","Coriander leaves","Dhania","Cilantro"]',
       ['%coriander leaves%','%cilantro%','%dhania leaves%','%fresh coriander%']],
      ['["Sabbasige soppu","ಸಬ್ಬಸಿಗೆ ಸೊಪ್ಪು","Dill leaves","Suva bhaji","Shepu"]',
       ['%dill leaves%','%dill greens%','%suva%','%shepu%']],
      ['["Palak","ಪಾಲಕ","Spinach"]',
       ['%spinach%','%palak%']],
      ['["Sabbasige","ಸಬ್ಬಸಿಗೆ","Dill seeds"]',
       ['%dill seeds%','%dill seed%']],
      ['["Mentya","ಮೆಂತ್ಯ","Fenugreek seeds","Methi seeds"]',
       ['%fenugreek seeds%','%methi seeds%']],
      // Fruits
      ['["Elaneeru","ಎಳನೀರು","Tender coconut water","Naariyal paani"]',
       ['%tender coconut%','%coconut water%','%naariyal paani%']],
      ['["Thenkaayi","ತೆಂಗಿನಕಾಯಿ","Coconut","Nariyal"]',
       ['%fresh coconut%','%coconut grated%','%coconut flesh%']],
      ['["Seethaphal","ಸೀತಾಫಲ","Custard apple","Sharifa"]',
       ['%custard apple%','%sharifa%','%sitaphal%']],
      ['["Nellikai","ನೆಲ್ಲಿಕಾಯಿ","Amla","Indian gooseberry"]',
       ['%amla%','%indian gooseberry%','%nellikai%','%gooseberry%']],
      // Grains & pulses
      ['["Ragi","ರಾಗಿ","Finger millet","Nachni"]',
       ['%finger millet%','%ragi%','%nachni%','%eleusine%']],
      ['["Jowar","ಜ್ವಾರಿ","Sorghum","Jola"]',
       ['%sorghum%','%jowar%','%jola%']],
      ['["Hesarubele","ಹೆಸರುಬೇಳೆ","Moong dal","Green gram dal"]',
       ['%moong dal%','%mung dal%','%green gram split%']],
      ['["Togari bele","ತೊಗರಿ ಬೇಳೆ","Toor dal","Arhar dal"]',
       ['%toor dal%','%arhar dal%','%pigeon pea%','%split pigeon%']],
      ['["Kadale bele","ಕಡಲೆ ಬೇಳೆ","Chana dal","Bengal gram dal"]',
       ['%chana dal%','%bengal gram%','%split chickpea%']],
      ['["Uddina bele","ಉದ್ದಿನ ಬೇಳೆ","Urad dal","Black gram dal"]',
       ['%urad dal%','%black gram dal%','%split urad%']],
      ['["Hesaru","ಹೆಸರು","Whole moong","Green gram whole"]',
       ['%whole moong%','%whole mung%','%green gram whole%']],
      ['["Kadale","ಕಡಲೆ","Chana","Chickpea"]',
       ['%chickpea%','%chana%','%kabuli%','%garbanzo%']],
    ];

    let totalUpdated = 0;
    for (const [aliasJson, patterns] of aliases) {
      const conditions = patterns.map((_, i) => `name ILIKE $${i + 2}`).join(' OR ');
      const result = await pool.query(
        `UPDATE foods SET name_aliases = $1::jsonb
         WHERE (${conditions})
           AND (name_aliases = '[]'::jsonb OR name_aliases IS NULL)`,
        [aliasJson, ...patterns]
      );
      totalUpdated += result.rowCount;
    }

    await pool.query(
      'INSERT INTO migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
      [MIGRATION_NAME]
    );

    console.log(`✅ Kannada aliases seeded — ${totalUpdated} foods updated`);
  } catch (err) {
    console.error('⚠️  Kannada alias migration failed (non-fatal):', err.message);
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
    await seedExercisesIfEmpty();
    await patchFoods();
    await runKannadaMigration();
  } catch (err) {
    console.error('❌ Startup error:', err.message);
  } finally {
    await pool.end();
  }

  console.log('\n🚀 Starting server…\n');
  require('./index.js');
}

main();
