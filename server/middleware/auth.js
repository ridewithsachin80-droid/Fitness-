const jwt = require('jsonwebtoken');

/**
 * Verifies the JWT access token from:
 *   1. Authorization: Bearer <token>  header
 *   2. accessToken cookie (fallback)
 *
 * On success: populates req.user = { id, role, name }
 * On failure: returns 401 with descriptive error
 */
module.exports = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token =
    (authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.split(' ')[1]
      : null) || req.cookies?.accessToken;   // optional-chain: cookie-parser may not be mounted (e.g. in tests), and a missing cookie jar should be a 401, not a 500

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
};
