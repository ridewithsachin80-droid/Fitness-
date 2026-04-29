require('dotenv').config();
const express      = require('express');
const http         = require('http');
const { Server }   = require('socket.io');
const cors         = require('cors');
const helmet       = require('helmet');
const cookieParser = require('cookie-parser');
const path         = require('path');
const fs           = require('fs');

// ── Route imports ─────────────────────────────────────────────────────────────
const authRoutes    = require('./routes/auth');
const logRoutes     = require('./routes/logs');
const patientRoutes = require('./routes/patients');
const notifRoutes   = require('./routes/notifications');
const adminRoutes   = require('./routes/admin');
const foodsRoutes   = require('./routes/foods');

// ── Service imports ───────────────────────────────────────────────────────────
const cronService = require('./services/cronService');

// ── Kannada alias migration ───────────────────────────────────────────────────
// Runs exactly once at boot (tracked in the migrations table).
// Updates the name_aliases JSONB column on existing foods rows so members
// can search by Kannada names like "bendekai" and find "Ladies Finger".
// Safe to re-deploy — the migrations table prevents double-runs.
async function runKannadaMigration(pool) {
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

    // Each entry: [ aliasArray, ...ILIKE patterns to match existing food names ]
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
      // Grains & pulses common in Karnataka
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
      // Build WHERE clause: name ILIKE $1 OR name ILIKE $2 OR ...
      const conditions = patterns.map((_, i) => `name ILIKE $${i + 2}`).join(' OR ');
      const result = await pool.query(
        `UPDATE foods SET name_aliases = $1::jsonb
         WHERE (${conditions})
           AND (name_aliases = '[]'::jsonb OR name_aliases IS NULL)`,
        [aliasJson, ...patterns]
      );
      totalUpdated += result.rowCount;
    }

    // Record migration as done
    await pool.query(
      'INSERT INTO migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
      [MIGRATION_NAME]
    );

    console.log(`✅ Kannada aliases seeded — ${totalUpdated} foods updated`);
  } catch (err) {
    // Non-fatal — app still starts, aliases just won't be available yet
    console.error('⚠️  Kannada alias migration failed (non-fatal):', err.message);
  }
}

// ── Auto-setup: run schema + seed on first boot ───────────────────────────────
async function autoSetup() {
  const pool = require('./db/pool');
  try {
    // 1. Run schema (all CREATE TABLE IF NOT EXISTS — safe every boot)
    console.log('📦 Running database schema…');
    const sql = fs.readFileSync(path.join(__dirname, 'db/schema.sql'), 'utf8');
    await pool.query(sql);
    console.log('✅ Schema ready');

    // 2. Run one-time data migrations
    await runKannadaMigration(pool);

    // 3. Seed default users only if none exist
    const { rows } = await pool.query("SELECT id FROM users WHERE role='admin' LIMIT 1");
    if (rows.length > 0) {
      console.log('ℹ️  Users exist — skipping seed');
      return;
    }

    console.log('🌱 Creating default users…');
    const bcrypt = require('bcryptjs');
    const pw     = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'ChangeMe@123', 12);
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const adminRes = await client.query(
        `INSERT INTO users (name, email, role, password)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password
         RETURNING id, name, email`,
        ['Sachin', 'sachin@healthmonitor.app', 'admin', pw]
      );
      const admin = adminRes.rows[0];

      const patRes = await client.query(
        `INSERT INTO users (name, phone, role)
         VALUES ($1,$2,$3)
         ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name
         RETURNING id, name, phone`,
        ['Mrs. Padmini', '9876543210', 'patient']
      );
      const patient = patRes.rows[0];

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
      console.log(`✅ Admin:   ${admin.name} → ${admin.email}`);
      console.log(`✅ Patient: ${patient.name} → ${patient.phone}`);
      console.log(`   Login password: ${process.env.ADMIN_PASSWORD || 'ChangeMe@123'}`);
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('❌ Seed error:', e.message);
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('❌ Auto-setup error:', err.message);
  }
}

// ── App setup ─────────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);

// ── Socket.io ─────────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: process.env.CLIENT_URL, credentials: true },
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
}));
app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use((req, res, next) => { req.io = io; next(); });

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',          authRoutes);
app.use('/api/logs',          logRoutes);
app.use('/api/patients',      patientRoutes);
app.use('/api/notifications', notifRoutes);
app.use('/api/admin',         adminRoutes);
app.use('/api/foods',         foodsRoutes);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Serve React app in production ─────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '../client/dist');
  app.use(express.static(distPath));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// ── Socket.io rooms ───────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.on('join_room',         (userId)    => socket.join(`user_${userId}`));
  socket.on('join_monitor_room', (monitorId) => socket.join(`monitor_${monitorId}`));
  socket.on('disconnect', () => {});
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

autoSetup().finally(() => {
  cronService.start();
  server.listen(PORT, () => {
    console.log(`\n🚀 Server running on port ${PORT}`);
    console.log(`   Health check: http://localhost:${PORT}/health`);
    console.log(`   Environment:  ${process.env.NODE_ENV || 'development'}\n`);
  });
});

module.exports = { app, io };
