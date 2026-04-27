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

// ── Auto-setup: run schema + seed on first boot ───────────────────────────────
async function autoSetup() {
  const pool = require('./db/pool');
  try {
    // 1. Run schema (all CREATE TABLE IF NOT EXISTS — safe every boot)
    console.log('📦 Running database schema…');
    const sql = fs.readFileSync(path.join(__dirname, 'db/schema.sql'), 'utf8');
    await pool.query(sql);
    console.log('✅ Schema ready');

    // 2. Seed default users only if none exist
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
