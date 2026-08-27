/**
 * src/controllers/authController.js
 *
 * Handles registration, login, and "who am I" for Phase 7's roll-your-own
 * JWT auth. Uses bcryptjs (pure JS) rather than bcrypt (native bindings)
 * — deliberately, to avoid native-module compile risk on deploy, the
 * same reasoning already applied elsewhere in this project (e.g. `fetch`
 * over `axios` on mobile to dodge an unnecessary dependency).
 *
 * SECURITY NOTE — read before deploying this for real:
 * Registration is currently OPEN, and the caller picks their own `role`
 * ("supervisor" or "pm") at signup. That means anyone who can reach
 * POST /api/v1/auth/register can grant themselves project-manager
 * privileges (flagging issues, creating projects, viewing conflict
 * history) just by choosing that role. This is fine for initial setup /
 * a trusted internal rollout, but is a real gap before wider use. Two
 * reasonable fixes, not implemented here since they're a product
 * decision, not a technical default:
 *   1. Remove `role` from the public registration payload entirely;
 *      everyone registers as 'supervisor', and promoting someone to 'pm'
 *      becomes a separate admin-only action (needs an admin/superuser
 *      concept that doesn't exist yet).
 *   2. Invite-code or admin-approval gated registration.
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { JWT_SECRET } = require('../middleware/auth');

const BCRYPT_SALT_ROUNDS = 10;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d';
// 30 days by default, not the more typical 15min-1hr for a web app —
// deliberate, because mobile supervisors are offline-first and may not
// reconnect for days; forcing a re-login the moment a short-lived token
// expires would block a sync that's otherwise ready to go. The dashboard
// could reasonably use a shorter-lived token, but this project doesn't
// currently issue different expiries per client — same trade-off is
// applied everywhere for simplicity, worth revisiting if it matters for
// your threat model.

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/v1/auth/register
 * Body: { email, password, name, role? }
 */
async function register(req, res, next) {
  try {
    const { email, password, name, role } = req.body ?? {};

    if (!email || !EMAIL_REGEX.test(email)) {
      return res.status(400).json({ success: false, error: 'A valid email is required.' });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters.' });
    }
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Name is required.' });
    }
    if (role && !User.VALID_ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        error: `Invalid role. Must be one of: ${User.VALID_ROLES.join(', ')}.`,
      });
    }

    const alreadyExists = await User.emailExists(email);
    if (alreadyExists) {
      return res.status(409).json({ success: false, error: 'An account with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    const user = await User.create({ email, passwordHash, name: name.trim(), role });
    const token = signToken(user);

    res.status(201).json({ success: true, token, user });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/auth/login
 * Body: { email, password }
 */
async function login(req, res, next) {
  try {
    const { email, password } = req.body ?? {};

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required.' });
    }

    const user = await User.getByEmailWithPassword(email);
    // Same generic error whether the email doesn't exist or the password
    // is wrong — doesn't let a caller enumerate which emails are
    // registered by observing different error messages.
    const invalidCredentialsError = { success: false, error: 'Invalid email or password.' };

    if (!user) {
      return res.status(401).json(invalidCredentialsError);
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      return res.status(401).json(invalidCredentialsError);
    }

    const publicUser = { id: user.id, email: user.email, name: user.name, role: user.role };
    const token = signToken(publicUser);

    res.json({ success: true, token, user: publicUser });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/auth/me
 * Requires authenticate middleware to have run first.
 */
async function me(req, res, next) {
  try {
    const user = await User.getById(req.user.id);
    if (!user) {
      // Token is valid but the user was deleted since it was issued.
      return res.status(401).json({ success: false, error: 'User account no longer exists.' });
    }
    res.json({ success: true, user });
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login, me };
