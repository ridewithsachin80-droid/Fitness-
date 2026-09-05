require('dotenv').config();
const express      = require('express');
const http         = require('http');
const { Server }   = require('socket.io');
const cors         = require('cors');
const helmet       = require('helmet');
const cookieParser = require('cookie-parser');
const path         = require('path');

// ── Route imports ─────────────────────────────────────────────────────────────
const authRoutes      = require('./routes/auth');
const logRoutes       = require('./routes/logs');
const memberRoutes    = require('./routes/patients'); // file keeps its name — see RENAME.md
const notifRoutes     = require('./routes/notifications');
const adminRoutes     = require('./routes/admin');
const foodsRoutes     = require('./routes/foods');
const aiFoodsRoutes   = require('./routes/aiFoods');   // AI food identifier
const trackerRoutes   = require('./routes/trackers');   // Wearable device integrations
const remindersRoutes = require('./routes/reminders');  // Custom reminders
const workoutRoutes   = require('./routes/workouts');   // Resistance training
const programRoutes   = require('./routes/programs');   // Coach-assigned workout programs
const aiChatRoutes    = require('./routes/aiChat');     // AI chat natural-language food logging

// ── Service imports ───────────────────────────────────────────────────────────
const cronService = require('./services/cronService');

// ── App setup ─────────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);

// ── Socket.io ─────────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: process.env.CLIENT_URL, credentials: true },
  // Memory optimizations
  pingTimeout:  20000,   // disconnect idle sockets faster (default 20s)
  pingInterval: 25000,   // check every 25s (default 25s)
  maxHttpBufferSize: 1e6, // 1MB max message size (default 1MB)
  transports: ['websocket', 'polling'], // prefer websocket
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
}));
app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
// 12mb: photo food logging posts a base64 image (~1.35x the file size).
// The client downscales to ~1280px before upload, so real payloads are well
// under this; the limit is a backstop, and /ai-chat/photo rejects >8MB itself.
app.use(express.json({ limit: '12mb' }));
app.use(cookieParser());
app.use((req, res, next) => { req.io = io; next(); });

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',          authRoutes);
app.use('/api/logs',          logRoutes);
// Terminology: the product says "member" and "coach". The DB still stores
// role='patient'/'monitor' and patient_id/monitor_id columns — renaming those
// needs a migration, so this is a UI + API rename only.
//
// /api/members is the current path. /api/patients stays mounted because this is
// a PWA: a member whose service worker has not updated yet is still running the
// old bundle and will keep calling /api/patients until it refreshes. Removing
// the alias on deploy day would break every stale client. Drop it once the
// rollout has settled.
app.use('/api/members',       memberRoutes);
app.use('/api/patients',      memberRoutes); // legacy alias — see note above
app.use('/api/notifications', notifRoutes);
app.use('/api/reminders',     remindersRoutes);
app.use('/api/admin',         adminRoutes);
app.use('/api/foods',         aiFoodsRoutes); // must be before foodsRoutes
app.use('/api/trackers',      trackerRoutes);
app.use('/api/workouts',      workoutRoutes);
app.use('/api/programs',      programRoutes);
app.use('/api/ai-chat',       aiChatRoutes);  // Fittr-style AI chat logging
// Voice logging. Its own mount, NOT under /api/ai-chat, because that router
// applies authMW to everything in it — and this endpoint is authenticated by a
// write-only token instead, since the caller is a phone shortcut with no
// login session. A separate path also avoids any route-ordering subtlety.
app.use('/api/quick-log',     require('./routes/quickLog'));
app.use('/api/foods',         foodsRoutes);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Digital Asset Links ────────────────────────────────────────────────
// Android verifies that the installed app owns this domain before it will
// hide the browser chrome in a Trusted Web Activity. Without this file the
// app shows a URL bar and looks broken to every member.
//
// Served from Express rather than dropped in client/public so it survives
// the Vite build and cannot be lost to a stale dist/. If it ever 404s, every
// Android member gets a browser bar overnight — smoke-routes asserts it.
//
// TWA_FINGERPRINT is the SHA-256 of the app signing certificate, from
// `keytool -list -v -keystore <your.keystore>` or the Play Console under
// Setup > App signing. Until it is set, this returns an empty list, which is
// valid JSON and simply means "no app is verified yet".
app.get('/.well-known/assetlinks.json', (req, res) => {
  const fp  = process.env.TWA_FINGERPRINT || '';
  const pkg = process.env.TWA_PACKAGE || 'app.upscale.fitlife';
  res.type('application/json');
  if (!fp) return res.json([]);
  res.json([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: pkg,
      sha256_cert_fingerprints: fp.split(',').map(f => f.trim()).filter(Boolean),
    },
  }]);
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

// ── Memory monitoring ────────────────────────────────────────────────────────
// Log memory every 30min and force GC if available
setInterval(() => {
  const mem = process.memoryUsage();
  const mb = (b) => Math.round(b / 1024 / 1024);
  if (mb(mem.heapUsed) > 400) {
    console.log(`⚠️  Memory: heap ${mb(mem.heapUsed)}MB / ${mb(mem.heapTotal)}MB, RSS ${mb(mem.rss)}MB`);
  }
  // Force GC if available (start node with --expose-gc)
  if (global.gc) global.gc();
}, 30 * 60 * 1000);

// ── Start ─────────────────────────────────────────────────────────────────────
// startup.js (the Railway entry point) handles all DB setup before requiring
// this file. So here we just start listening immediately.
const PORT = process.env.PORT || 3000;

cronService.start();
server.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(`   Environment:  ${process.env.NODE_ENV || 'development'}\n`);
});

module.exports = { app, io };
