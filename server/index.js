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

// ── Service imports ───────────────────────────────────────────────────────────
const cronService = require('./services/cronService');

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
app.use('/api/reminders',     remindersRoutes);
app.use('/api/admin',         adminRoutes);
app.use('/api/foods',         aiFoodsRoutes); // must be before foodsRoutes
app.use('/api/trackers',      trackerRoutes);
app.use('/api/workouts',      workoutRoutes);
app.use('/api/programs',      programRoutes);
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
