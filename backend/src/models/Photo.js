/**
 * src/models/Photo.js
 *
 * All database access for the photos table. `create()` is written to be
 * idempotent (ON CONFLICT (photo_id) DO UPDATE ... returning the row
 * either way) rather than erroring on a duplicate insert. That matters
 * because the mobile app may retry a sync batch after a partial network
 * failure — if photo rows from the first attempt already landed, retrying
 * the same payload must not blow up on a primary-key collision.
 */

const { query } = require('../config/db');

/**
 * Inserts a photo record, or updates it in place if a row with the same
 * photo_id already exists (safe to call again with the same payload after
 * a retried/partial sync).
 *
 * @param {Object} photoData
 * @param {string} photoData.id - the photo's UUID (photo_id in the DB)
 * @param {string} photoData.log_id
 * @param {string} photoData.file_path - cloud storage path/URL
 * @param {number} [photoData.file_size]
 * @param {number} [photoData.width]
 * @param {number} [photoData.height]
 * @param {'pending'|'synced'|'failed'} [photoData.sync_status='synced']
 * @param {string} [photoData.created_at]
 * @param {import('pg').PoolClient} [client] - pass to participate in an existing transaction; defaults to the shared pool
 * @returns {Promise<Object>} the saved row
 */
async function create(photoData, client = null) {
  const {
    id,
    log_id,
    file_path,
    file_size = null,
    width = null,
    height = null,
    sync_status = 'synced',
    created_at = null,
  } = photoData;

  const exec = client ? (text, params) => client.query(text, params) : query;

  const result = await exec(
    `INSERT INTO photos (
       photo_id, log_id, file_path, file_size, width, height,
       sync_status, created_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamp, CURRENT_TIMESTAMP)
     )
     ON CONFLICT (photo_id) DO UPDATE SET
       log_id = EXCLUDED.log_id,
       file_path = EXCLUDED.file_path,
       file_size = EXCLUDED.file_size,
       width = EXCLUDED.width,
       height = EXCLUDED.height,
       sync_status = EXCLUDED.sync_status
     RETURNING *;`,
    [id, log_id, file_path, file_size, width, height, sync_status, created_at]
  );

  return result.rows[0];
}

/**
 * Retrieves all photos for a log, oldest first (capture order).
 *
 * @param {string} logId
 * @returns {Promise<Array<Object>>}
 */
async function getByLogId(logId) {
  const result = await query(
    `SELECT * FROM photos WHERE log_id = $1 ORDER BY created_at ASC;`,
    [logId]
  );
  return result.rows;
}

/**
 * Deletes every photo row for a log. Note: this only removes database
 * rows — actual cloud storage cleanup (e.g. an S3/Cloudinary delete call)
 * is not implemented here, since Phase 3 doesn't specify a storage
 * provider yet. Wire that in wherever this is called from once photo
 * uploads to cloud storage are implemented.
 *
 * @param {string} logId
 * @returns {Promise<number>} number of rows deleted
 */
async function deleteByLogId(logId) {
  const result = await query(`DELETE FROM photos WHERE log_id = $1;`, [logId]);
  return result.rowCount;
}

module.exports = { create, getByLogId, deleteByLogId };
