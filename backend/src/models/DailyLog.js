/**
 * src/models/DailyLog.js
 *
 * All database access for the daily_logs table. Field naming note: the
 * mobile app's SQLite table calls its primary key `id`; this backend's
 * Postgres table calls it `log_id` (per the Phase 3 schema spec). The
 * mapping between the two happens at the edges — sync payloads use `id`,
 * this model's functions take/return `log_id` — see syncController.js for
 * where that translation happens.
 */

const { query } = require('../config/db');

const VALID_SYNC_STATUSES = ['pending', 'synced', 'failed', 'conflict'];

/**
 * Inserts a new daily log, or updates it in place if a row with the same
 * log_id already exists. created_at is preserved on update (only ever set
 * on first insert); updated_at always advances to now().
 *
 * @param {Object} logData
 * @param {string} logData.id - the log's UUID (log_id in the DB)
 * @param {string} logData.project_id
 * @param {string} [logData.supervisor_id]
 * @param {string} logData.log_date - "YYYY-MM-DD"
 * @param {Object} [logData.weather]
 * @param {Array} [logData.workers]
 * @param {Array} [logData.materials]
 * @param {Array} [logData.issues]
 * @param {string} [logData.notes]
 * @param {string} logData.supervisor_name
 * @param {'pending'|'synced'|'failed'|'conflict'} [logData.sync_status='synced']
 * @param {string} [logData.created_at] - ISO timestamp from the client; only used on first insert
 * @returns {Promise<Object>} the saved row
 */
async function upsert(logData) {
  const {
    id,
    project_id,
    supervisor_id = null,
    log_date,
    weather = {},
    workers = [],
    materials = [],
    issues = [],
    notes = '',
    supervisor_name,
    sync_status = 'synced',
    created_at = null,
  } = logData;

  if (!VALID_SYNC_STATUSES.includes(sync_status)) {
    throw new Error(`DailyLog.upsert: invalid sync_status "${sync_status}"`);
  }

  const result = await query(
    `INSERT INTO daily_logs (
       log_id, project_id, supervisor_id, log_date, weather, workers,
       materials, issues, notes, supervisor_name, sync_status,
       created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5::jsonb, $6::jsonb,
       $7::jsonb, $8::jsonb, $9, $10, $11,
       COALESCE($12::timestamp, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP
     )
     ON CONFLICT (log_id) DO UPDATE SET
       project_id = EXCLUDED.project_id,
       supervisor_id = EXCLUDED.supervisor_id,
       log_date = EXCLUDED.log_date,
       weather = EXCLUDED.weather,
       workers = EXCLUDED.workers,
       materials = EXCLUDED.materials,
       issues = EXCLUDED.issues,
       notes = EXCLUDED.notes,
       supervisor_name = EXCLUDED.supervisor_name,
       sync_status = EXCLUDED.sync_status,
       updated_at = CURRENT_TIMESTAMP
     RETURNING *;`,
    [
      id,
      project_id,
      supervisor_id,
      log_date,
      JSON.stringify(weather),
      JSON.stringify(workers),
      JSON.stringify(materials),
      JSON.stringify(issues),
      notes,
      supervisor_name,
      sync_status,
      created_at,
    ]
  );

  return result.rows[0];
}

/**
 * Retrieves all logs for a project, optionally filtered by date range,
 * with pagination. Dates are inclusive on both ends.
 *
 * @param {string} projectId
 * @param {string|null} [startDate] - "YYYY-MM-DD" or null for no lower bound
 * @param {string|null} [endDate] - "YYYY-MM-DD" or null for no upper bound
 * @param {number} [limit=50]
 * @param {number} [offset=0]
 * @returns {Promise<Array<Object>>}
 */
async function getByProject(projectId, startDate = null, endDate = null, limit = 50, offset = 0) {
  const result = await query(
    `SELECT * FROM daily_logs
     WHERE project_id = $1
       AND ($2::date IS NULL OR log_date >= $2::date)
       AND ($3::date IS NULL OR log_date <= $3::date)
     ORDER BY log_date DESC, created_at DESC
     LIMIT $4 OFFSET $5;`,
    [projectId, startDate, endDate, limit, offset]
  );
  return result.rows;
}

/**
 * Retrieves a single log by id, with its photos attached as a nested
 * array (empty array if none). Returns null if not found.
 *
 * @param {string} logId
 * @returns {Promise<Object|null>}
 */
async function getById(logId) {
  const result = await query(
    `SELECT dl.*,
       COALESCE(
         (SELECT json_agg(p.* ORDER BY p.created_at ASC)
          FROM photos p
          WHERE p.log_id = dl.log_id),
         '[]'::json
       ) AS photos
     FROM daily_logs dl
     WHERE dl.log_id = $1;`,
    [logId]
  );
  return result.rows[0] || null;
}

/**
 * Checks whether any log already exists for a given project + date.
 *
 * @param {string} projectId
 * @param {string} logDate
 * @returns {Promise<boolean>}
 */
async function exists(projectId, logDate) {
  const result = await query(
    `SELECT EXISTS (
       SELECT 1 FROM daily_logs WHERE project_id = $1 AND log_date = $2
     ) AS "exists";`,
    [projectId, logDate]
  );
  return result.rows[0].exists;
}

/**
 * Retrieves every log for a given project + date, excluding a specific
 * log_id if provided. Used to detect conflicts: if this returns any rows
 * when syncing a brand-new log_id for that project/date, more than one
 * supervisor has independently logged the same day.
 *
 * @param {string} projectId
 * @param {string} logDate
 * @param {string|null} [excludeLogId]
 * @returns {Promise<Array<Object>>}
 */
async function getConflictingLogs(projectId, logDate, excludeLogId = null) {
  const result = await query(
    `SELECT * FROM daily_logs
     WHERE project_id = $1
       AND log_date = $2
       AND ($3::uuid IS NULL OR log_id != $3::uuid)
     ORDER BY created_at ASC;`,
    [projectId, logDate, excludeLogId]
  );
  return result.rows;
}

/**
 * Marks a set of logs as sync_status='conflict'. Used after conflict
 * detection to flag every log in a conflicting group (not just the newly
 * arrived one) so the dashboard's "unresolved conflicts" view can find
 * the whole group with one query, not just the last-synced row.
 *
 * @param {Array<string>} logIds
 * @returns {Promise<void>}
 */
async function markConflicting(logIds) {
  if (!logIds || logIds.length === 0) return;
  await query(
    `UPDATE daily_logs SET sync_status = 'conflict' WHERE log_id = ANY($1::uuid[]);`,
    [logIds]
  );
}

/**
 * Retrieves every unresolved conflict, grouped by (project_id, log_date).
 * Backs GET /api/v1/conflicts. Not part of the original spec's model list,
 * but needed since "unresolved conflicts" has to be computed from the
 * sync_status='conflict' rows rather than a dedicated conflicts table (the
 * Phase 3 schema doesn't define one) — see conflictResolver.js for why.
 *
 * @param {string|null} [projectId] - optionally scope to one project
 * @returns {Promise<Array<{project_id: string, log_date: string, logs: Array<Object>}>>}
 */
async function getUnresolvedConflicts(projectId = null) {
  const result = await query(
    `SELECT project_id, log_date, json_agg(daily_logs.* ORDER BY created_at ASC) AS logs
     FROM daily_logs
     WHERE sync_status = 'conflict'
       AND ($1::uuid IS NULL OR project_id = $1::uuid)
     GROUP BY project_id, log_date
     ORDER BY log_date DESC;`,
    [projectId]
  );
  return result.rows;
}

module.exports = {
  upsert,
  getByProject,
  getById,
  exists,
  getConflictingLogs,
  markConflicting,
  getUnresolvedConflicts,
};
