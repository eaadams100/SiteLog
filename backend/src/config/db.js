/**
 * src/config/db.js
 *
 * Central PostgreSQL connection module. Everything else in the backend
 * talks to the database through `query()` (or `getClient()` for
 * multi-statement transactions) — nothing outside this file should import
 * `pg` directly.
 *
 * SSL: Neon (and most managed Postgres) requires SSL, but a local
 * Postgres instance during development typically doesn't have a cert set
 * up at all. Rather than gate this on NODE_ENV (easy to get wrong when
 * testing "production" locally), this checks whether the connection
 * string points at localhost and disables SSL only in that case.
 */

const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  // Fail fast and loud — every other module assumes this is configured.
  throw new Error(
    'DATABASE_URL is not set. Add it to your .env file (see .env.example).'
  );
}

const isLocalDatabase =
  connectionString.includes('localhost') || connectionString.includes('127.0.0.1');

const pool = new Pool({
  connectionString,
  ssl: isLocalDatabase ? false : { rejectUnauthorized: false },
  max: parseInt(process.env.DB_POOL_MAX || '10', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  // Fired on idle client errors (e.g. the backing connection was dropped
  // by the server) — log it, but don't crash the whole process over one
  // bad pooled connection.
  console.error('Unexpected error on idle PostgreSQL client:', err);
});

const SLOW_QUERY_THRESHOLD_MS = 1000;

/**
 * Runs a parameterized query through the shared pool. Logs a warning for
 * any query slower than SLOW_QUERY_THRESHOLD_MS, and logs (then rethrows)
 * on failure so callers can handle/report the error without every call
 * site needing its own try/catch just for logging.
 *
 * @param {string} text - SQL with $1, $2, ... placeholders
 * @param {Array} [params]
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > SLOW_QUERY_THRESHOLD_MS) {
      console.warn(
        `[SLOW QUERY] ${duration}ms :: ${text.replace(/\s+/g, ' ').trim()}`
      );
    }
    return result;
  } catch (err) {
    const duration = Date.now() - start;
    console.error(
      `[DB ERROR] after ${duration}ms :: ${text.replace(/\s+/g, ' ').trim()} :: ${err.message}`
    );
    throw err;
  }
}

/**
 * Checks out a dedicated client from the pool for multi-statement
 * transactions (BEGIN/COMMIT/ROLLBACK). Callers MUST call client.release()
 * in a finally block — this module cannot do that for you.
 *
 * @returns {Promise<import('pg').PoolClient>}
 */
async function getClient() {
  return pool.connect();
}

module.exports = { pool, query, getClient };
