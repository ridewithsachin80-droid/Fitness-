require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');

// ── Route imports ───────────────────────────────────────────────────────────
const authRoutes    = require('./routes/auth');
const logRoutes     = require('./routes/logs');
const patientRoutes = require('./routes/patients');
const notifRoutes   = require('./routes/notifications');

// ── Service imports ──────────────────────────────────────────────────────────
const cronService = require('./services/cronService');

// ── App setup ───────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);

// ── Socket.io ───────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL,
    credentials: true,
  },
});

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(
  helmet({
    // Allow inline scripts for the React SPA in production
    contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
  })
);

app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,           // Required for cookies (refresh token)
  })
);

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// Attach Socket.io instance to every request so routes can emit events
app.use((req, res, next) => {
  req.io = io;
  next();
});

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/auth',          authRoutes);
app.use('/api/logs',          logRoutes);
app.use('/api/patients',      patientRoutes);
app.use('/api/notifications', notifRoutes);

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Serve built React app in production ──────────────────────────────────────
// Sprint 6 (deployment) will activate this:
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
}

// ── Socket.io event handlers ─────────────────────────────────────────────────
io.on('connection', (socket) => {
  // Patient joins their own room to receive push ack / real-time updates
  socket.on('join_room', (userId) => {
    socket.join(`user_${userId}`);
    console.log(`User ${userId} joined their room`);
  });

  // Monitor joins their room; when a patient saves a log,
  // the server emits 'log_updated' to this room
  socket.on('join_monitor_room', (monitorId) => {
    socket.join(`monitor_${monitorId}`);
    console.log(`Monitor ${monitorId} joined monitor room`);
  });

  socket.on('disconnect', () => {});
});

// ── Start cron jobs ───────────────────────────────────────────────────────────
cronService.start();

// ── Start server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(`   Environment:  ${process.env.NODE_ENV || 'development'}\n`);
});

module.exports = { app, io };
