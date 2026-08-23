const { getSessionFromReq } = require('../routes/auth');

/**
 * Middleware ensuring user is authenticated and provisioned
 */
async function requireAuth(req, res, next) {
  try {
    const session = await getSessionFromReq(req);
    if (!session) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required. Please sign in with a provisioned Google or Microsoft account.'
      });
    }

    req.user = {
      email: session.email,
      name: session.name,
      picture: session.picture,
      role: session.role
    };

    next();
  } catch (err) {
    res.status(500).json({ error: 'Auth middleware error: ' + err.message });
  }
}

/**
 * Middleware ensuring user has Admin role
 */
async function requireAdmin(req, res, next) {
  try {
    const session = await getSessionFromReq(req);
    if (!session || session.role !== 'admin') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Admin authorization required.'
      });
    }

    req.user = session;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Admin middleware error: ' + err.message });
  }
}

module.exports = {
  requireAuth,
  requireAdmin
};
