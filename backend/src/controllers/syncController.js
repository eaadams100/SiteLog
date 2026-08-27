/**
 * src/controllers/syncController.js
 *
 * Handles POST /api/v1/sync — the endpoint the mobile app calls to push
 * its local SQLite logs/photos up to the cloud database. Processes each
 * log independently: one bad log in a batch records a sync_errors row and
 * increments the error count, but doesn't fail the whole request.
 *
 * Phase 5: when a log conflicts with one or more existing logs for the
 * same project + date, resolution now happens automatically and
 * synchronously, inside a single database transaction covering: updating
 * the conflict group's primary log with merged data, recording the
 * conflict_log audit entry, upserting the incoming log itself, and
 * inserting its photos. All of it commits together or rolls back
 * together — see conflictResolver.js for the resolution logic and why
 * this replaces Phase 3's "flag and wait for a human" behavior.
 */

const DailyLog = require('../models/DailyLog');
const Photo = require('../models/Photo');
const ConflictLog = require('../models/ConflictLog');
const { resolveConflict } = require('../services/conflictResolver');
const { query, getClient } = require('../config/db');

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
 * Processes a single incoming log inside one transaction:
 *   1. (outside the transaction, a plain committed read) check for other
 *      logs already in the DB for the same project + date
 *   2. BEGIN
 *   3. if conflicting logs exist: resolve them, update the group's
 *      primary log with merged data, record a conflict_log audit entry
 *   4. upsert the incoming log itself (sync_status reflects whether it
 *      was part of a conflict)
 *   5. insert its photos
 *   6. COMMIT (or ROLLBACK on any failure, caught by the outer per-log
 *      try/catch in syncData, which records sync_errors and moves on)
 *
 * PHASE 7: supervisor_id and supervisor_name are taken from the
 * authenticated user (req.user, passed in as `authenticatedUser`) —
 * NOT from whatever the client included in the payload. Before auth
 * existed, supervisor_name was free text the mobile app just sent as-is;
 * trusting it now would let any authenticated device attribute a log to
 * a different supervisor by simply typing a different name. The mobile
 * app no longer even shows an editable field for this — see
 * mobile/app/log-entry.js.
 */
async function processLog(incoming, authenticatedUser) {
  const logId = incoming.id;
  const supervisorId = authenticatedUser.id;
  const supervisorName = authenticatedUser.name;

  // Plain read, not part of the transaction — see file header for why a
  // pessimistic lock here wasn't deemed necessary for this app's traffic
  // pattern (low-frequency site logs, not high-concurrency financial
  // transactions).
  const conflictingLogs = await DailyLog.getConflictingLogs(
    incoming.project_id,
    incoming.log_date,
    logId
  );

  const client = await getClient();
  let syncStatus = 'synced';
  let conflictInfo = null;

  try {
    await client.query('BEGIN');

    if (conflictingLogs.length > 0) {
      const resolution = resolveConflict(
        { ...incoming, log_id: logId, supervisor_name: supervisorName },
        conflictingLogs
      );

      syncStatus = 'conflict_resolved';

      // Upsert the incoming log FIRST, so that if it turns out to be the
      // resolution's chosen primary (see pickPrimaryLog in
      // conflictResolver.js — an incoming log with an earlier created_at
      // than what's already stored, e.g. a device syncing days late, can
      // legitimately become primary), the row exists for the next step's
      // UPDATE to actually hit.
      await DailyLog.upsert(
        {
          id: logId,
          project_id: incoming.project_id,
          supervisor_id: supervisorId,
          log_date: incoming.log_date,
          weather: incoming.weather || {},
          workers: incoming.workers || [],
          materials: incoming.materials || [],
          issues: incoming.issues || [],
          notes: incoming.notes || '',
          supervisor_name: supervisorName,
          sync_status: syncStatus,
          created_at: incoming.created_at,
          updated_at: incoming.updated_at,
        },
        client
      );

      const primaryRow = await DailyLog.applyConflictResolution(
        client,
        resolution.primaryLogId,
        resolution.resolvedData,
        resolution.conflictingLogIds
      );

      await ConflictLog.create(
        {
          logId: resolution.primaryLogId,
          conflictDate: incoming.log_date,
          resolutionStrategy: 'lww+union',
          resolutionDetails: {
            resolvedData: resolution.resolvedData,
            allInvolvedLogIds: [resolution.primaryLogId, ...resolution.conflictingLogIds],
            triggeredBySyncOfLogId: logId,
          },
        },
        client
      );

      conflictInfo = {
        primaryLogId: resolution.primaryLogId,
        mergedFrom: [resolution.primaryLogId, ...resolution.conflictingLogIds],
        updatedAt: primaryRow.updated_at,
      };
    } else {
      await DailyLog.upsert(
        {
          id: logId,
          project_id: incoming.project_id,
          supervisor_id: supervisorId,
          log_date: incoming.log_date,
          weather: incoming.weather || {},
          workers: incoming.workers || [],
          materials: incoming.materials || [],
          issues: incoming.issues || [],
          notes: incoming.notes || '',
          supervisor_name: supervisorName,
          sync_status: 'synced',
          created_at: incoming.created_at,
          updated_at: incoming.updated_at,
        },
        client
      );
    }

    let photosSynced = 0;
    for (const photo of incoming.photos || []) {
      await Photo.create(
        {
          id: photo.id,
          log_id: logId,
          file_path: photo.file_path,
          file_size: photo.file_size,
          width: photo.width,
          height: photo.height,
          sync_status: 'synced',
          created_at: photo.created_at,
        },
        client
      );
      photosSynced += 1;
    }

    await client.query('COMMIT');

    return { syncStatus, conflictInfo, photosSynced };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * POST /api/v1/sync — requires authenticate middleware to have run first
 * (see routes/syncRoutes.js), so req.user is always populated here.
 */
async function syncData(req, res, next) {
  try {
    const { logs } = req.body;

    const summary = { processed: 0, conflicts: 0, errors: 0 };
    const details = [];

    for (const incoming of logs) {
      try {
        const { syncStatus, conflictInfo, photosSynced } = await processLog(incoming, req.user);

        summary.processed += 1;
        if (conflictInfo) summary.conflicts += 1;

        details.push({
          log_id: incoming.id,
          status: syncStatus,
          conflict_resolved: Boolean(conflictInfo),
          primary_log_id: conflictInfo?.primaryLogId ?? incoming.id,
          merged_from: conflictInfo?.mergedFrom ?? [],
          updated_at: conflictInfo?.updatedAt ?? incoming.updated_at,
          photosSynced,
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
