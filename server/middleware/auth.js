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
      : null) || req.cookies.accessToken;

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
