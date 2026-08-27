/**
 * src/middleware/auth.js
 *
 * Two middleware functions for Phase 7's JWT auth:
 *   - authenticate: verifies the Authorization header, attaches req.user
 *   - requireRole(...roles): must run AFTER authenticate; 403s if the
 *     authenticated user's role isn't in the allowed list
 *
 * req.user is set to { id, email, name, role } — the JWT payload itself,
 * not a fresh database read. That means a role change or account
 * deactivation won't take effect until the user's current token expires
 * and they log in again — a real, deliberate trade-off for a simple
 * roll-your-own system without a token-revocation list. Worth knowing if
 * you ever need to immediately revoke someone's access.
 */

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error(
    'JWT_SECRET is not set. Add it to your .env file (see .env.example) — a long, random string.'
  );
}

/**
 * Requires a valid `Authorization: Bearer <token>` header. Attaches the
 * decoded payload to req.user on success.
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required. Include an "Authorization: Bearer <token>" header.',
    });
  }

  const token = header.slice('Bearer '.length).trim();

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.id, email: payload.email, name: payload.name, role: payload.role };
    next();
  } catch (err) {
    const message =
      err.name === 'TokenExpiredError'
        ? 'Session expired. Please log in again.'
        : 'Invalid authentication token.';
    return res.status(401).json({ success: false, error: message });
  }
}

/**
 * Must be used after `authenticate`. Restricts a route to specific
 * roles.
 *
 * @param {...string} allowedRoles
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      // Programmer error (requireRole used without authenticate first) —
      // fail closed rather than silently allowing the request through.
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: `This action requires one of these roles: ${allowedRoles.join(', ')}.`,
      });
    }
    next();
  };
}

module.exports = { authenticate, requireRole, JWT_SECRET };
