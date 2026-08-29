require('dotenv').config();
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const smsService = require('../services/smsService');
const authMW = require('../middleware/auth');
const roleCheck = require('../middleware/roleCheck');

// ── Token helpers ───────────────────────────────────────────────────────────

/**
 * Converts a JWT duration string (e.g. '15m', '30d', '2h') to milliseconds
 * so cookie maxAge always stays in sync with the JWT expiry env vars.
 */
function parseDurationMs(str) {
  const units = { s: 1000, m: 60 * 1000, h: 3600 * 1000, d: 86400 * 1000 };
  const match = String(str).match(/^(\d+)([smhd])$/);
  if (!match) return null;
  return parseInt(match[1]) * (units[match[2]] || 1000);
}

const ACCESS_DURATION  = process.env.JWT_EXPIRES_IN         || '15m';
const REFRESH_DURATION = process.env.JWT_REFRESH_EXPIRES_IN || '30d';
const ACCESS_MS        = parseDurationMs(ACCESS_DURATION)  || 15 * 60 * 1000;
const REFRESH_MS       = parseDurationMs(REFRESH_DURATION) || 30 * 24 * 60 * 60 * 1000;

/**
 * Signs both access and refresh tokens for a user.
 * Access token:  carries { id, role, name }, expiry from JWT_EXPIRES_IN
 * Refresh token: carries only { id },        expiry from JWT_REFRESH_EXPIRES_IN
 */
const signTokens = (user) => ({
  accessToken: jwt.sign(
    { id: user.id, role: user.role, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_DURATION }
  ),
  refreshToken: jwt.sign(
    { id: user.id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: REFRESH_DURATION }
  ),
});

/** Sets httpOnly refresh token cookie — maxAge derived from JWT_REFRESH_EXPIRES_IN */
const setRefreshCookie = (res, token) => {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: REFRESH_MS,
  });
};

/** Sets httpOnly access token cookie — maxAge derived from JWT_EXPIRES_IN */
const setAccessCookie = (res, token) => {
  res.cookie('accessToken', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: ACCESS_MS,
  });
};

// ── PIN login rate limiter ──────────────────────────────────────────────────
// Simple in-memory store: { ip -> { count, resetAt } }
// ── Auth rate limiting ───────────────────────────────────────────────────────
// Hand-rolled, in-memory, per-IP. Deliberately simple (no extra dependency) —
// fine for this app's scale, and resets automatically so legitimate users
// who mistype a few times aren't locked out for long.
// Each protected route gets its own bucket (keyed by "route:ip") so hammering
// one endpoint doesn't use up the allowance for another.
const _authAttempts = new Map();

function checkRateLimit(bucketKey, max, windowMs) {
  const now    = Date.now();
  const record = _authAttempts.get(bucketKey);
  if (record && now < record.resetAt) {
    if (record.count >= max) return false; // blocked
    record.count++;
  } else {
    _authAttempts.set(bucketKey, { count: 1, resetAt: now + windowMs });
  }
  return true; // allowed
}

function clearRateLimit(bucketKey) {
  _authAttempts.delete(bucketKey);
}

// Periodically prune expired entries so the map doesn't grow forever
setInterval(() => {
  const now = Date.now();
  for (const [key, r] of _authAttempts) {
    if (now >= r.resetAt) _authAttempts.delete(key);
  }
}, 5 * 60 * 1000);

const getIp = (req) => req.ip || req.socket?.remoteAddress || 'unknown';

// ── POST /api/auth/pin-login ────────────────────────────────────────────────
// Patient: phone number + PIN login (replaces OTP)
router.post('/pin-login', async (req, res) => {
  const { phone, pin } = req.body;

  if (!phone || !pin) {
    return res.status(400).json({ error: 'Phone and PIN are required' });
  }

  // Rate-limit on TWO keys before touching the DB.
  //
  // IP alone was the whole bucket, and under Indian carrier-grade NAT a large
  // number of mobile users share one public address — so several members on
  // the same network, or one member on a busy cell, could exhaust the ten
  // attempts without any of them having typed a wrong PIN. The per-phone key
  // is the tighter, fairer limit against actual guessing; the per-IP key is
  // deliberately looser now, and exists to blunt a broad scripted sweep across
  // many numbers rather than to police one household.
  const ip = getIp(req);
  if (!checkRateLimit(`pin-login-phone:${phone}`, 8, 15 * 60 * 1000)) {
    return res.status(429).json({
      error: 'Too many attempts for this number. Please wait 15 minutes and try again.',
    });
  }
  if (!checkRateLimit(`pin-login:${ip}`, 50, 15 * 60 * 1000)) {
    return res.status(429).json({
      error: 'Too many login attempts from this network. Please wait 15 minutes and try again.',
    });
  }

  try {
    // Deliberately NOT filtering on active here. A deactivated member used to
    // get "Invalid phone number or PIN", identical to a typo — so they retyped
    // it, ran into the rate limit, and messaged the coach convinced the app was
    // broken. Fetch first, then say which it actually is.
    const result = await pool.query(
      "SELECT * FROM users WHERE phone = $1 AND role = 'patient'",
      [phone]
    );
    const user = result.rows[0];

    if (!user || !user.password) {
      return res.status(401).json({ error: 'Invalid phone number or PIN' });
    }

    if (user.active === false) {
      // Not a credential failure, so it doesn't count against the rate limit
      // and the member is told to talk to their coach rather than retry.
      return res.status(403).json({
        error: 'This account is paused. Please contact your coach to reactivate it.',
        code:  'account_inactive',
      });
    }

    const isValid = await bcrypt.compare(pin, user.password);
    if (!isValid) {
      return res.status(401).json({ error: 'Incorrect PIN. Contact your coach to reset.' });
    }

    // Successful login — clear both counters. Leaving the phone counter set
    // would carry failed attempts forward into the next session.
    clearRateLimit(`pin-login:${ip}`);
    clearRateLimit(`pin-login-phone:${phone}`);

    const { accessToken, refreshToken } = signTokens(user);
    setRefreshCookie(res, refreshToken);
    setAccessCookie(res, accessToken);

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

  // Rate-limit by IP — OTPs cost money to send (SMS) and this endpoint takes
  // no password, so without a limit it's an easy spam/cost-abuse vector.
  const ip = getIp(req);
  if (!checkRateLimit(`send-otp:${ip}`, 5, 15 * 60 * 1000)) {
    return res.status(429).json({ error: 'Too many OTP requests. Please wait 15 minutes and try again.' });
  }

  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE phone = $1 AND role = 'patient' AND active = true",
      [phone]
    );

    // Always return the same response whether or not the number exists —
    // sending a distinct 404 here would let an attacker enumerate which
    // phone numbers are registered. We just skip the actual SMS silently.
    if (result.rows.length) {
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const hash = await bcrypt.hash(otp, 10);
      const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      await pool.query(
        'UPDATE users SET otp_hash = $1, otp_expires = $2 WHERE phone = $3',
        [hash, expires, phone]
      );

      await smsService.sendOTP(phone, otp);
    }

    res.json({ message: 'If this number is registered, an OTP has been sent.' });
  } catch (err) {
    console.error('send-otp error:', err);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// ── POST /api/auth/verify-otp ───────────────────────────────────────────────
// Patient: verify OTP and receive tokens
router.post('/verify-otp', async (req, res) => {
  const { phone, otp } = req.body;

  if (!phone || !otp) {
    return res.status(400).json({ error: 'Phone and OTP are required' });
  }

  // A 6-digit OTP has only 1M combinations — rate-limit attempts so it can't
  // be brute-forced within its 10-minute validity window.
  const ip = getIp(req);
  if (!checkRateLimit(`verify-otp:${ip}`, 8, 15 * 60 * 1000)) {
    return res.status(429).json({ error: 'Too many attempts. Please wait 15 minutes and try again.' });
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
    clearRateLimit(`verify-otp:${ip}`);

    const { accessToken, refreshToken } = signTokens(user);
    setRefreshCookie(res, refreshToken);
    setAccessCookie(res, accessToken);

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

  // This guards admin/monitor accounts — the highest-privilege logins in the
  // app — so it gets the same protection as the patient PIN login.
  const ip = getIp(req);
  if (!checkRateLimit(`login:${ip}`, 10, 15 * 60 * 1000)) {
    return res.status(429).json({ error: 'Too many login attempts. Please wait 15 minutes and try again.' });
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

    // Successful login — clear the rate-limit counter for this IP
    clearRateLimit(`login:${ip}`);

    const { accessToken, refreshToken } = signTokens(user);
    setRefreshCookie(res, refreshToken);
    setAccessCookie(res, accessToken);

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
  // Accept refresh token from cookie (primary) or request body (fallback)
  const token = req.cookies.refreshToken || req.body?.refreshToken;

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
    setAccessCookie(res, accessToken);
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
    sameSite: 'lax',
  });
  res.json({ message: 'Logged out successfully' });
});

// ── PATCH /api/auth/change-password ────────────────────────────────────────
// Monitor/admin: change their own password. Requires current password to verify.
router.patch('/change-password', authMW, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE id = $1 AND role IN (\'monitor\', \'admin\')',
      [req.user.id]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) return res.status(401).json({ error: 'Current password is incorrect' });

    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hash, req.user.id]);

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    console.error('change-password error:', err.message);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// ── PATCH /api/auth/change-pin ──────────────────────────────────────────────
// Member: change their own PIN. Requires the current one.
//
// Until now a member had no way to change their PIN and no way to recover it —
// every credential change went through the coach on WhatsApp. The coach reset
// path (PATCH /patients/:id/pin) stays, for the genuine forgot-it case.
router.patch('/change-pin', authMW, roleCheck('patient'), async (req, res) => {
  const { currentPin, newPin } = req.body || {};

  if (!currentPin || !newPin) {
    return res.status(400).json({ error: 'Enter your current PIN and a new one' });
  }
  const next = String(newPin).trim();
  // Matches the 4-digit minimum the coach and admin reset paths already
  // enforce, so a member can't set a PIN weaker than one set for them.
  if (next.length < 4) {
    return res.status(400).json({ error: 'Your new PIN must be at least 4 digits' });
  }
  if (!/^\d+$/.test(next)) {
    return res.status(400).json({ error: 'Your PIN can only contain numbers' });
  }
  if (String(currentPin).trim() === next) {
    return res.status(400).json({ error: 'That is already your PIN' });
  }

  // Rate-limited like pin-login: this endpoint verifies a credential, so
  // without a limit it is an oracle for guessing the current PIN.
  const ip = getIp(req);
  if (!checkRateLimit(`change-pin:${ip}`, 10, 15 * 60 * 1000)) {
    return res.status(429).json({
      error: 'Too many attempts. Please wait 15 minutes and try again.',
    });
  }

  try {
    const { rows } = await pool.query(
      "SELECT id, password FROM users WHERE id = $1 AND role = 'patient' AND active = true",
      [req.user.id]
    );
    const user = rows[0];
    if (!user || !user.password) return res.status(404).json({ error: 'Account not found' });

    const isValid = await bcrypt.compare(String(currentPin).trim(), user.password);
    if (!isValid) return res.status(401).json({ error: 'That current PIN is not right' });

    const hash = await bcrypt.hash(next, 10);   // same cost factor as the reset paths
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hash, req.user.id]);
    clearRateLimit(`change-pin:${ip}`);

    res.json({ message: 'PIN changed' });
  } catch (err) {
    console.error('change-pin error:', err.message);
    res.status(500).json({ error: 'Could not change your PIN' });
  }
});

module.exports = router;
