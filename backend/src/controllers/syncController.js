/**
 * src/controllers/syncController.js
 *
 * Handles POST /api/v1/sync — the endpoint the mobile app calls to push
 * its local SQLite logs/photos up to the cloud database. Processes each
 * log independently: one bad log in a batch records a sync_errors row and
 * increments the error count, but doesn't fail the whole request.
 */

const DailyLog = require('../models/DailyLog');
const Photo = require('../models/Photo');
const { resolveConflict } = require('../services/conflictResolver');
const { query } = require('../config/db');

/**
 * Records a sync failure for one log into sync_errors, without letting a
 * failure to write the error itself take down the request.
 */
async function recordSyncError(logId, message) {
  try {
    await query(`INSERT INTO sync_errors (log_id, error_message) VALUES ($1, $2);`, [
      logId || null,
      message,
    ]);
  } catch (loggingErr) {
    console.error('Failed to record sync error:', loggingErr);
  }
}

/**
 * Processes a single incoming log: detects conflicts (if this is a new
 * log_id for a project/date that already has one), upserts it, then
 * upserts its photos.
 */
/**
 * Processes a single incoming log: re-evaluates conflict status against
 * every other log for the same project + date (not just on first insert —
 * see note below), upserts the log, then upserts its photos.
 *
 * Conflict status is re-checked on *every* sync of a log, not only when
 * its log_id is brand new. Earlier version of this only checked on
 * first-insert, which had a bug: re-syncing an already-conflicting log
 * (e.g. the supervisor edits it later and the app re-syncs) would reset
 * its sync_status straight back to 'synced', silently clearing the
 * conflict flag even though the other conflicting log was untouched and
 * still sitting there unresolved.
 */
async function processLog(incoming) {
  const logId = incoming.id;

  const conflictingLogs = await DailyLog.getConflictingLogs(
    incoming.project_id,
    incoming.log_date,
    logId
  );

  let syncStatus = 'synced';
  let conflict = null;

  if (conflictingLogs.length > 0) {
    const resolution = resolveConflict({ ...incoming, log_id: logId }, conflictingLogs);
    syncStatus = 'conflict';
    conflict = {
      conflictingLogIds: resolution.conflictingLogIds,
      suggestedMerge: resolution.resolvedData,
    };
    // Flag the pre-existing logs too, so the whole group is discoverable
    // from GET /api/v1/conflicts, not just this row.
    await DailyLog.markConflicting(resolution.conflictingLogIds);
  }

  const savedLog = await DailyLog.upsert({
    id: logId,
    project_id: incoming.project_id,
    supervisor_id: incoming.supervisor_id || null,
    log_date: incoming.log_date,
    weather: incoming.weather || {},
    workers: incoming.workers || [],
    materials: incoming.materials || [],
    issues: incoming.issues || [],
    notes: incoming.notes || '',
    supervisor_name: incoming.supervisor_name,
    sync_status: syncStatus,
    created_at: incoming.created_at,
  });

  let photosSynced = 0;
  for (const photo of incoming.photos || []) {
    await Photo.create({
      id: photo.id,
      log_id: logId,
      file_path: photo.file_path,
      file_size: photo.file_size,
      width: photo.width,
      height: photo.height,
      sync_status: 'synced',
      created_at: photo.created_at,
    });
    photosSynced += 1;
  }

  return { savedLog, syncStatus, conflict, photosSynced };
}

/**
 * POST /api/v1/sync
 */
async function syncData(req, res, next) {
  try {
    const { logs } = req.body;

    const summary = { processed: 0, conflicts: 0, errors: 0 };
    const details = [];

    for (const incoming of logs) {
      try {
        const { syncStatus, conflict, photosSynced } = await processLog(incoming);

        summary.processed += 1;
        if (conflict) summary.conflicts += 1;

        details.push({
          log_id: incoming.id,
          status: syncStatus,
          photosSynced,
          conflict,
        });
      } catch (err) {
        summary.errors += 1;
        details.push({ log_id: incoming.id ?? null, status: 'error', message: err.message });
        await recordSyncError(incoming.id, err.message);
      }
    }

    res.status(200).json({ success: true, summary, details });
  } catch (err) {
    next(err);
  }
}

module.exports = { syncData };
