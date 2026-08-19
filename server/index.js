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
const patientRoutes   = require('./routes/patients');
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
app.use('/api/patients',      patientRoutes);
app.use('/api/notifications', notifRoutes);
app.use('/api/reminders',     remindersRoutes);
app.use('/api/admin',         adminRoutes);
app.use('/api/foods',         aiFoodsRoutes); // must be before foodsRoutes
app.use('/api/trackers',      trackerRoutes);
app.use('/api/workouts',      workoutRoutes);
app.use('/api/programs',      programRoutes);
app.use('/api/ai-chat',       aiChatRoutes);  // Fittr-style AI chat logging
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
