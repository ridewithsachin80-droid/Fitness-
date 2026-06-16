/**
 * Role guard — restricts routes to specific roles.
 *
 * Usage (after auth middleware):
 *   router.get('/patients', authMW, roleCheck('monitor', 'admin'), handler)
 *   router.post('/patients', authMW, roleCheck('admin'), handler)
 */
module.exports = (...roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({
      error: `Access denied. Required role: ${roles.join(' or ')}. Your role: ${req.user.role}`,
    });
  }
  next();
};
