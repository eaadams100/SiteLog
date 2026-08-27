/**
 * src/models/User.js
 *
 * All database access for the users table (Phase 7 — authentication).
 * Password hashing/verification lives in authController.js, not here —
 * this model only ever touches password_hash as an opaque string, never
 * plaintext.
 */

const { query } = require('../config/db');

const VALID_ROLES = ['supervisor', 'pm'];

/**
 * Creates a new user. Caller is responsible for hashing the password
 * before calling this — this model never sees plaintext.
 *
 * @param {Object} userData
 * @param {string} userData.email
 * @param {string} userData.passwordHash
 * @param {string} userData.name
 * @param {'supervisor'|'pm'} [userData.role='supervisor']
 * @returns {Promise<Object>} the created user, WITHOUT password_hash
 */
async function create({ email, passwordHash, name, role = 'supervisor' }) {
  if (!VALID_ROLES.includes(role)) {
    const err = new Error(`Invalid role "${role}". Must be one of: ${VALID_ROLES.join(', ')}.`);
    err.status = 400;
    throw err;
  }

  const result = await query(
    `INSERT INTO users (email, password_hash, name, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, name, role, created_at;`,
    [email.toLowerCase().trim(), passwordHash, name, role]
  );

  return result.rows[0];
}

/**
 * Retrieves a user by email, INCLUDING password_hash — this is the one
 * method that returns it, since login needs to compare against it.
 * Returns null if no user has that email.
 *
 * @param {string} email
 * @returns {Promise<Object|null>}
 */
async function getByEmailWithPassword(email) {
  const result = await query(`SELECT * FROM users WHERE email = $1;`, [email.toLowerCase().trim()]);
  return result.rows[0] || null;
}

/**
 * Retrieves a user by id, WITHOUT password_hash. Used for GET /auth/me
 * and anywhere else a user's public profile is needed.
 *
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
async function getById(id) {
  const result = await query(
    `SELECT id, email, name, role, created_at FROM users WHERE id = $1;`,
    [id]
  );
  return result.rows[0] || null;
}

/**
 * Checks whether any user already has this email — used to give a clear
 * "that email is taken" error at registration instead of a raw unique
 * -constraint-violation database error.
 *
 * @param {string} email
 * @returns {Promise<boolean>}
 */
async function emailExists(email) {
  const result = await query(
    `SELECT EXISTS (SELECT 1 FROM users WHERE email = $1) AS "exists";`,
    [email.toLowerCase().trim()]
  );
  return result.rows[0].exists;
}

module.exports = { create, getByEmailWithPassword, getById, emailExists, VALID_ROLES };
