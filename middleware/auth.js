function requireAuth(req, res, next) {
  const userId = req.session.user?.user_id || req.session.user_id;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized access. Please log in.' });
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    const userRole = req.session.user?.role || req.session.role;
    if (!roles.includes(userRole)) {
      return res.status(403).json({ error: 'Forbidden. You lack permissions for this resource.' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
