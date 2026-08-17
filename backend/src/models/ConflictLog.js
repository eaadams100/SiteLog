/**
 * src/models/ConflictLog.js
 *
 * All database access for the conflict_log audit table (Phase 5). Not
 * explicitly named in the spec's file list, but added for the same reason
 * every other table has its own model (Project.js, Photo.js, DailyLog.js)
 * — keeps each table's query logic in one predictable place.
 *
 * Every method here optionally takes a `client` (a checked-out pg client
 * from db.js's getClient(), mid-transaction) instead of using the shared
 * pool directly — conflict resolution writes need to be atomic with the
 * daily_logs update they accompany, so syncController.js runs them all
 * through the same transaction. Falls back to the shared pool via
 * query() when no client is passed, for standalone reads (e.g. the
 * conflict history endpoint, which isn't part of any transaction).
 */

const { query } = require('../config/db');

/**
 * Records one conflict resolution event.
 *
 * @param {Object} entry
 * @param {string} entry.logId - the PRIMARY log's id (the row that received the merge)
 * @param {string} entry.conflictDate - "YYYY-MM-DD"
 * @param {string} entry.resolutionStrategy - e.g. 'lww+union'
 * @param {Object} entry.resolutionDetails - arbitrary JSON: merged fields, involved log ids, etc.
 * @param {import('pg').PoolClient} [client] - pass to participate in an existing transaction
 * @returns {Promise<Object>} the inserted row
 */
async function create(entry, client = null) {
  const exec = client
    ? (text, params) => client.query(text, params)
    : query;

  const result = await exec(
    `INSERT INTO conflict_log (log_id, conflict_date, resolution_strategy, resolution_details)
     VALUES ($1, $2, $3, $4::jsonb)
     RETURNING *;`,
    [entry.logId, entry.conflictDate, entry.resolutionStrategy, JSON.stringify(entry.resolutionDetails ?? {})]
  );

  return result.rows[0];
}

/**
 * Retrieves conflict history, newest first, optionally scoped to a
 * project. Joins in the primary log's current state so callers don't
 * need a second round trip to show "what does this log look like now".
 *
 * @param {string|null} [projectId]
 * @param {number} [limit=50]
 * @param {number} [offset=0]
 * @returns {Promise<Array<Object>>}
 */
async function getHistory(projectId = null, limit = 50, offset = 0) {
  const result = await query(
    `SELECT
       cl.conflict_id,
       cl.log_id,
       cl.conflict_date,
       cl.resolution_strategy,
       cl.resolved_at,
       cl.resolution_details,
       dl.project_id,
       dl.supervisor_name,
       dl.merged_from_logs,
       dl.conflict_resolved
     FROM conflict_log cl
     JOIN daily_logs dl ON dl.log_id = cl.log_id
     WHERE ($1::uuid IS NULL OR dl.project_id = $1::uuid)
     ORDER BY cl.resolved_at DESC
     LIMIT $2 OFFSET $3;`,
    [projectId, limit, offset]
  );
  return result.rows;
}

module.exports = { create, getHistory };
