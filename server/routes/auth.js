require('dotenv').config();
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const smsService = require('../services/smsService');

// ── Token helpers ───────────────────────────────────────────────────────────

/**
 * Signs both access and refresh tokens for a user.
 * Access token: 15 min, carries { id, role, name }
 * Refresh token: 30 days, carries only { id }
 */
const signTokens = (user) => ({
  accessToken: jwt.sign(
    { id: user.id, role: user.role, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  ),
  refreshToken: jwt.sign(
    { id: user.id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' }
  ),
});

/** Sets httpOnly refresh token cookie */
const setRefreshCookie = (res, token) => {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days in ms
  });
};

// ── POST /api/auth/pin-login ────────────────────────────────────────────────
// Patient: phone number + PIN login (replaces OTP)
router.post('/pin-login', async (req, res) => {
  const { phone, pin } = req.body;

  if (!phone || !pin) {
    return res.status(400).json({ error: 'Phone and PIN are required' });
  }

  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE phone = $1 AND role = 'patient' AND active = true",
      [phone]
    );
    const user = result.rows[0];

    if (!user || !user.password) {
      return res.status(401).json({ error: 'Invalid phone number or PIN' });
    }

    const isValid = await bcrypt.compare(pin, user.password);
    if (!isValid) {
      return res.status(401).json({ error: 'Incorrect PIN. Contact your monitor to reset.' });
    }

    const { accessToken, refreshToken } = signTokens(user);
    setRefreshCookie(res, refreshToken);

    res.json({
      accessToken,
      user: { id: user.id, name: user.name, role: user.role },
    });
  } catch (err) {
    console.error('pin-login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── POST /api/auth/send-otp ─────────────────────────────────────────────────
// Patient: request OTP to their registered phone number
router.post('/send-otp', async (req, res) => {
  const { phone } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'Phone number is required' });
  }

  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE phone = $1 AND role = 'patient' AND active = true",
      [phone]
    );

    if (!result.rows.length) {
      // Don't reveal whether the number exists — generic error
      return res.status(404).json({ error: 'No patient account found for this number' });
    }

    // Generate a 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const hash = await bcrypt.hash(otp, 10);
    const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await pool.query(
      'UPDATE users SET otp_hash = $1, otp_expires = $2 WHERE phone = $3',
      [hash, expires, phone]
    );

    await smsService.sendOTP(phone, otp);

    res.json({ message: 'OTP sent successfully' });
  } catch (err) {
    console.error('send-otp error:', err);
    res.status(500).json({ error: err.message || 'Failed to send OTP' });
  }
});

// ── POST /api/auth/verify-otp ───────────────────────────────────────────────
// Patient: verify OTP and receive tokens
router.post('/verify-otp', async (req, res) => {
  const { phone, otp } = req.body;

  if (!phone || !otp) {
    return res.status(400).json({ error: 'Phone and OTP are required' });
  }

  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE phone = $1 AND active = true',
      [phone]
    );
    const user = result.rows[0];

    if (!user || !user.otp_hash) {
      return res.status(400).json({ error: 'Invalid request. Please request a new OTP.' });
    }

    if (new Date() > new Date(user.otp_expires)) {
      return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
    }

    const isValid = await bcrypt.compare(otp, user.otp_hash);
    if (!isValid) {
      return res.status(400).json({ error: 'Incorrect OTP' });
    }

    // Clear OTP so it can't be reused
    await pool.query(
      'UPDATE users SET otp_hash = NULL, otp_expires = NULL WHERE id = $1',
      [user.id]
    );

    const { accessToken, refreshToken } = signTokens(user);
    setRefreshCookie(res, refreshToken);

    res.json({
      accessToken,
      user: { id: user.id, name: user.name, role: user.role },
    });
  } catch (err) {
    console.error('verify-otp error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ── POST /api/auth/login ────────────────────────────────────────────────────
// Monitor/Admin: email + password login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND active = true',
      [email]
    );
    const user = result.rows[0];

    if (!user || !user.password) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const { accessToken, refreshToken } = signTokens(user);
    setRefreshCookie(res, refreshToken);

    res.json({
      accessToken,
      user: { id: user.id, name: user.name, role: user.role },
    });
  } catch (err) {
    console.error('login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── POST /api/auth/refresh ──────────────────────────────────────────────────
// Silently issue a new access token using the httpOnly refresh cookie
router.post('/refresh', async (req, res) => {
  const token = req.cookies.refreshToken;

  if (!token) {
    return res.status(401).json({ error: 'No refresh token' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET);

    const result = await pool.query(
      'SELECT * FROM users WHERE id = $1 AND active = true',
      [payload.id]
    );
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    const { accessToken } = signTokens(user);
    res.json({ accessToken });
  } catch (err) {
    // Invalid or expired refresh token — force re-login
    res.clearCookie('refreshToken');
    res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
});

// ── POST /api/auth/logout ───────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  });
  res.json({ message: 'Logged out successfully' });
});

module.exports = router;
