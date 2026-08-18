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

const VALID_SYNC_STATUSES = ['pending', 'synced', 'failed', 'conflict', 'conflict_resolved'];

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
 * @param {'pending'|'synced'|'failed'|'conflict'|'conflict_resolved'} [logData.sync_status='synced']
 * @param {string} [logData.created_at] - ISO timestamp from the client; only used on first insert
 * @param {string} [logData.updated_at] - ISO timestamp from the client, representing when the log's CONTENT was last edited on-device. Trusted as-is (falling back to CURRENT_TIMESTAMP only if absent) rather than always stamped with the server's insert time — conflict resolution's Last-Write-Wins logic depends on this reflecting real edit order, not sync/arrival order. See the bug this fixes: previously every upsert overwrote updated_at with the server's current time regardless of what the client sent, which silently broke LWW comparisons for any log that had already been synced once (its stored updated_at became "whenever it happened to sync", making a later conflict check compare arrival order instead of edit order).
 * @param {import('pg').PoolClient} [client] - pass to participate in an existing transaction (Phase 5's conflict-merge flow); defaults to the shared pool
 * @returns {Promise<Object>} the saved row
 */
async function upsert(logData, client = null) {
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
    updated_at = null,
  } = logData;

  if (!VALID_SYNC_STATUSES.includes(sync_status)) {
    throw new Error(`DailyLog.upsert: invalid sync_status "${sync_status}"`);
  }

  const exec = client ? (text, params) => client.query(text, params) : query;

  const result = await exec(
    `INSERT INTO daily_logs (
       log_id, project_id, supervisor_id, log_date, weather, workers,
       materials, issues, notes, supervisor_name, sync_status,
       created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5::jsonb, $6::jsonb,
       $7::jsonb, $8::jsonb, $9, $10, $11,
       COALESCE($12::timestamp, CURRENT_TIMESTAMP), COALESCE($13::timestamp, CURRENT_TIMESTAMP)
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
       updated_at = COALESCE($13::timestamp, CURRENT_TIMESTAMP)
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
      updated_at,
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
 * Phase 5: if this log is a merge primary (conflict_resolved = true,
 * merged_from_logs non-empty), photos are aggregated across this log AND
 * every log in merged_from_logs — not just this log's own log_id. Photos
 * are never physically moved between logs (see conflictResolver.js's file
 * header for why), so "merging" them means showing them all together at
 * read time instead.
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
          WHERE p.log_id = dl.log_id
             OR p.log_id = ANY(dl.merged_from_logs)),
         '[]'::json
       ) AS photos
     FROM daily_logs dl
     WHERE dl.log_id = $1;`,
    [logId]
  );
  return result.rows[0] || null;
}

/**
 * Toggles the `flagged` field of a single issue within a log's `issues`
 * JSONB array, identified by array index (issues don't have their own
 * id — they're plain objects inside the array, so index is the only way
 * to address one). Phase 6 addition, for the dashboard's flag button.
 *
 * Validates the index is in range before writing, rather than letting an
 * out-of-range jsonb_set silently no-op — a 400 with a clear message is
 * much easier to debug than "I clicked flag and nothing happened."
 *
 * @param {string} logId
 * @param {number} issueIndex - 0-based index into the log's issues array
 * @param {boolean} flagged
 * @returns {Promise<Object|null>} the updated log (with photos, via getById), or null if logId not found
 */
async function updateIssueFlag(logId, issueIndex, flagged) {
  const existing = await getById(logId);
  if (!existing) return null;

  const issues = Array.isArray(existing.issues) ? existing.issues : [];
  if (issueIndex < 0 || issueIndex >= issues.length) {
    const err = new Error(
      `Issue index ${issueIndex} is out of range — this log has ${issues.length} issue(s).`
    );
    err.status = 400;
    throw err;
  }

  await query(
    `UPDATE daily_logs
     SET issues = jsonb_set(issues, ARRAY[$2::text, 'flagged'], to_jsonb($3::boolean), true),
         updated_at = CURRENT_TIMESTAMP
     WHERE log_id = $1;`,
    [logId, String(issueIndex), flagged]
  );

  return getById(logId);
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
 * Kept from Phase 3 for defensive/backward-compat use — Phase 5's normal
 * flow no longer leaves logs sitting in 'conflict' (see
 * applyConflictResolution below, which resolves immediately instead).
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
 * Phase 5: updates the PRIMARY log of a conflict group in place with
 * merged field values, marking it conflict_resolved and recording every
 * log_id that was folded into it. Runs within the caller's transaction
 * (client is required, not optional, since this is only ever called as
 * part of syncController's atomic conflict-resolution flow — an
 * unguarded standalone call here would be a correctness bug, not a
 * convenience).
 *
 * merged_from_logs is set to the union of whatever was already recorded
 * (for a primary that's already been merged into before) plus the newly
 * involved log ids — not overwritten — so a log that joins its 3rd, 4th
 * conflict over time keeps full lineage of every log ever folded in.
 *
 * @param {import('pg').PoolClient} client - REQUIRED, must be mid-transaction
 * @param {string} primaryLogId
 * @param {{weather: *, notes: *, supervisor_name: *, workers: Array, materials: Array, issues: Array}} resolvedData
 * @param {Array<string>} newlyMergedLogIds - log_ids being folded in by this resolution (not including primaryLogId itself)
 * @returns {Promise<Object>} the updated primary row
 */
async function applyConflictResolution(client, primaryLogId, resolvedData, newlyMergedLogIds) {
  if (!client) {
    throw new Error('DailyLog.applyConflictResolution requires a transaction client.');
  }

  const result = await client.query(
    `UPDATE daily_logs SET
       weather = $2::jsonb,
       notes = $3,
       supervisor_name = $4,
       workers = $5::jsonb,
       materials = $6::jsonb,
       issues = $7::jsonb,
       sync_status = 'conflict_resolved',
       conflict_resolved = TRUE,
       merged_from_logs = (
         SELECT ARRAY(
           SELECT DISTINCT unnest(merged_from_logs || $8::uuid[])
         )
       ),
       updated_at = CURRENT_TIMESTAMP
     WHERE log_id = $1
     RETURNING *;`,
    [
      primaryLogId,
      JSON.stringify(resolvedData.weather ?? {}),
      resolvedData.notes ?? '',
      resolvedData.supervisor_name,
      JSON.stringify(resolvedData.workers ?? []),
      JSON.stringify(resolvedData.materials ?? []),
      JSON.stringify(resolvedData.issues ?? []),
      newlyMergedLogIds,
    ]
  );

  return result.rows[0];
}

/**
 * Retrieves logs still sitting in sync_status='conflict', grouped by
 * (project_id, log_date). Kept from Phase 3 for defensive/backward-compat
 * use, but no longer the primary way to see conflicts under Phase 5 —
 * normal resolution now happens synchronously during sync (see
 * applyConflictResolution above), so nothing should typically be stuck
 * here. GET /api/v1/conflicts now serves conflict HISTORY from the
 * conflict_log audit table instead — see ConflictLog.getHistory() and
 * conflictController.js.
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
  applyConflictResolution,
  getByProject,
  getById,
  exists,
  getConflictingLogs,
  markConflicting,
  getUnresolvedConflicts,
  updateIssueFlag,
};