/**
 * DatabaseManager.js
 *
 * Wraps all SQLite + local file access for SiteLog behind a single class so
 * screens never touch raw SQL or the filesystem directly. Built on the
 * modern async expo-sqlite API (SQLite.openDatabaseAsync / execAsync /
 * runAsync / getAllAsync), which ships with expo-sqlite ~14+ (Expo SDK 51+).
 *
 * JSON columns (weather, workers, materials, issues) are stored as TEXT and
 * transparently serialized/deserialized on the way in and out, so callers
 * always work with plain JS objects/arrays.
 *
 * Phase 2 adds a `photos` table plus local-file storage for captured
 * images. The database only ever stores a file_path (and metadata) — never
 * image bytes — so `logs.db` stays small and fast to query. Photo files
 * live under `${Paths.document}/photos/`.
 *
 * File access uses the class-based File/Directory/Paths API from
 * expo-file-system, which became the stable default import in Expo SDK 54
 * (expo-file-system ~19). The old functional API
 * (FileSystem.documentDirectory / getInfoAsync / copyAsync / deleteAsync /
 * makeDirectoryAsync) now throws at runtime when imported from
 * 'expo-file-system' directly — it only still works via the explicit
 * 'expo-file-system/legacy' import, which is itself on a deprecation path.
 * If your project is on Expo SDK ≤53, swap this import for the older
 * `import * as FileSystem from 'expo-file-system'` functional calls instead.
 */

import * as SQLite from 'expo-sqlite';
import { File, Directory, Paths } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { generateUUID, getCurrentTimestamp, safeJSONParse } from '../utils/helpers';

const DATABASE_NAME = 'sitelog.db';
const PHOTOS_DIR_NAME = 'photos';
const PHOTO_COMPRESS_WIDTH = 800;
const PHOTO_COMPRESS_QUALITY = 0.7; // 0-1, JPEG quality

class DatabaseManager {
  constructor() {
    this.db = null;
    this._initPromise = null;
    // Lazily created Directory instance for photo storage — see
    // ensurePhotosDirectory().
    this._photosDirectory = null;
  }

  /**
   * Opens the database, creates tables/indexes if they don't exist yet, and
   * ensures the on-disk photos directory exists. Safe to call multiple
   * times — subsequent calls reuse the same open connection / in-flight
   * initialization promise.
   *
   * @returns {Promise<void>}
   */
  async initDatabase() {
    if (this.db) return;
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DATABASE_NAME);

      // WAL mode gives better read/write concurrency on-device.
      await db.execAsync(`PRAGMA journal_mode = WAL;`);
      // Required for ON DELETE CASCADE (photos -> logs) to actually fire.
      await db.execAsync(`PRAGMA foreign_keys = ON;`);

      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS logs (
          id TEXT PRIMARY KEY NOT NULL,
          project_id TEXT NOT NULL,
          log_date TEXT NOT NULL,
          weather TEXT,
          workers TEXT,
          materials TEXT,
          issues TEXT,
          notes TEXT,
          supervisor_name TEXT NOT NULL,
          sync_status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      await db.execAsync(`
        CREATE INDEX IF NOT EXISTS idx_logs_log_date ON logs (log_date);
      `);
      await db.execAsync(`
        CREATE INDEX IF NOT EXISTS idx_logs_sync_status ON logs (sync_status);
      `);
      await db.execAsync(`
        CREATE INDEX IF NOT EXISTS idx_logs_project_id ON logs (project_id);
      `);

      // --- Phase 2: photos table ---
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS photos (
          id TEXT PRIMARY KEY NOT NULL,
          log_id TEXT NOT NULL,
          file_path TEXT NOT NULL,
          file_size INTEGER,
          width INTEGER,
          height INTEGER,
          sync_status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT NOT NULL,
          FOREIGN KEY (log_id) REFERENCES logs (id) ON DELETE CASCADE
        );
      `);

      await db.execAsync(`
        CREATE INDEX IF NOT EXISTS idx_photos_log_id ON photos (log_id);
      `);
      await db.execAsync(`
        CREATE INDEX IF NOT EXISTS idx_photos_sync_status ON photos (sync_status);
      `);

      // --- Phase 4: tiny key-value settings table ---
      // Everything else Phase 4 needs (getPendingLogs, getPendingPhotos,
      // updateSyncStatus, updatePhotoSyncStatus, getLogsByDateRange)
      // already existed from Phases 1-2. This is the one genuinely new
      // piece of storage needed: a place to persist app-level sync
      // metadata (currently just "last synced at") across app restarts,
      // without a whole new table per setting.
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT
        );
      `);

      this.db = db;

      // Make sure the on-disk photos folder exists before anyone tries to
      // write into it.
      await this.ensurePhotosDirectory();
    })();

    return this._initPromise;
  }

  /**
   * Throws a clear error if the database hasn't been initialized yet,
   * rather than letting a confusing null-pointer error bubble up.
   */
  _assertReady() {
    if (!this.db) {
      throw new Error(
        'DatabaseManager: database not initialized. Call initDatabase() first.'
      );
    }
  }

  // =========================================================================
  // Logs (Phase 1, plus updateLog + cascading deleteLog added in Phase 2)
  // =========================================================================

  /**
   * Inserts a new daily log.
   *
   * @param {Object} logData
   * @param {string} logData.id - UUID primary key (generate with generateUUID()).
   * @param {string} logData.project_id
   * @param {string} logData.log_date - ISO date string, e.g. "2026-07-31".
   * @param {Object} logData.weather - { condition, temp }
   * @param {Array}  logData.workers - [{ trade, count }]
   * @param {Array}  logData.materials - [{ name, quantity, unit }]
   * @param {Array}  logData.issues - [{ description, flagged }]
   * @param {string} [logData.notes]
   * @param {string} logData.supervisor_name
   * @param {string} [logData.sync_status='pending']
   * @returns {Promise<Object>} the inserted log, JSON fields parsed back out
   */
  async insertLog(logData) {
    this._assertReady();

    const now = getCurrentTimestamp();
    const row = {
      id: logData.id,
      project_id: logData.project_id,
      log_date: logData.log_date,
      weather: JSON.stringify(logData.weather ?? {}),
      workers: JSON.stringify(logData.workers ?? []),
      materials: JSON.stringify(logData.materials ?? []),
      issues: JSON.stringify(logData.issues ?? []),
      notes: logData.notes ?? '',
      supervisor_name: logData.supervisor_name,
      sync_status: logData.sync_status ?? 'pending',
      created_at: logData.created_at ?? now,
      updated_at: now,
    };

    await this.db.runAsync(
      `INSERT INTO logs (
        id, project_id, log_date, weather, workers, materials, issues,
        notes, supervisor_name, sync_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        row.id,
        row.project_id,
        row.log_date,
        row.weather,
        row.workers,
        row.materials,
        row.issues,
        row.notes,
        row.supervisor_name,
        row.sync_status,
        row.created_at,
        row.updated_at,
      ]
    );

    return this._deserializeLogRow(row);
  }

  /**
   * Updates an existing log in place (preserves id and created_at).
   * Added in Phase 2 to support the "auto-save on first photo, then Save
   * button finalizes the same row" flow — without this, pressing Save after
   * an auto-save would insert a duplicate log instead of updating it.
   *
   * @param {string} logId
   * @param {Object} logData - same shape as insertLog's logData
   * @returns {Promise<Object>} the updated log, JSON fields parsed back out
   */
  async updateLog(logId, logData) {
    this._assertReady();

    const now = getCurrentTimestamp();
    const row = {
      id: logId,
      project_id: logData.project_id,
      log_date: logData.log_date,
      weather: JSON.stringify(logData.weather ?? {}),
      workers: JSON.stringify(logData.workers ?? []),
      materials: JSON.stringify(logData.materials ?? []),
      issues: JSON.stringify(logData.issues ?? []),
      notes: logData.notes ?? '',
      supervisor_name: logData.supervisor_name,
      updated_at: now,
    };

    await this.db.runAsync(
      `UPDATE logs SET
        project_id = ?, log_date = ?, weather = ?, workers = ?,
        materials = ?, issues = ?, notes = ?, supervisor_name = ?,
        updated_at = ?
       WHERE id = ?;`,
      [
        row.project_id,
        row.log_date,
        row.weather,
        row.workers,
        row.materials,
        row.issues,
        row.notes,
        row.supervisor_name,
        row.updated_at,
        logId,
      ]
    );

    return this.getLogById(logId);
  }

  /**
   * Retrieves every saved log, newest first, with JSON fields parsed.
   *
   * @returns {Promise<Array<Object>>}
   */
  async getAllLogs() {
    this._assertReady();
    const rows = await this.db.getAllAsync(
      `SELECT * FROM logs ORDER BY log_date DESC, created_at DESC;`
    );
    return rows.map((row) => this._deserializeLogRow(row));
  }

  /**
   * Retrieves a single log by id.
   *
   * @param {string} logId
   * @returns {Promise<Object|null>}
   */
  async getLogById(logId) {
    this._assertReady();
    const row = await this.db.getFirstAsync(
      `SELECT * FROM logs WHERE id = ?;`,
      [logId]
    );
    return row ? this._deserializeLogRow(row) : null;
  }

  /**
   * Retrieves all logs still waiting to be synced.
   *
   * @returns {Promise<Array<Object>>}
   */
  async getPendingLogs() {
    this._assertReady();
    const rows = await this.db.getAllAsync(
      `SELECT * FROM logs WHERE sync_status = ? ORDER BY log_date ASC;`,
      ['pending']
    );
    return rows.map((row) => this._deserializeLogRow(row));
  }

  /**
   * Updates the sync_status of a given log (e.g. once it's been uploaded).
   *
   * @param {string} logId
   * @param {'pending'|'synced'|'failed'} status
   * @returns {Promise<void>}
   */
  async updateSyncStatus(logId, status) {
    this._assertReady();
    this._assertValidSyncStatus(status);
    await this.db.runAsync(
      `UPDATE logs SET sync_status = ?, updated_at = ? WHERE id = ?;`,
      [status, getCurrentTimestamp(), logId]
    );
  }

  /**
   * Updates specific content fields of a local log — used after a Phase 5
   * conflict resolution, to overwrite this device's local copy with the
   * server's merged/canonical version. Only ever touches the fields
   * explicitly passed in `fields` (a partial update), and only fields on
   * an allow-list — never id/created_at/sync_status, which have their own
   * dedicated update paths elsewhere.
   *
   * @param {string} logId
   * @param {Object} fields - any subset of: weather, workers, materials, issues, notes, supervisor_name
   * @returns {Promise<void>}
   */
  async updateLogFields(logId, fields) {
    this._assertReady();

    const allowedFields = ['weather', 'workers', 'materials', 'issues', 'notes', 'supervisor_name'];
    const jsonFields = ['weather', 'workers', 'materials', 'issues'];

    const setClauses = [];
    const params = [];

    for (const field of allowedFields) {
      if (fields[field] === undefined) continue;
      setClauses.push(`${field} = ?`);
      params.push(jsonFields.includes(field) ? JSON.stringify(fields[field]) : fields[field]);
    }

    if (setClauses.length === 0) return; // nothing recognized to update

    setClauses.push('updated_at = ?');
    params.push(getCurrentTimestamp());
    params.push(logId);

    await this.db.runAsync(
      `UPDATE logs SET ${setClauses.join(', ')} WHERE id = ?;`,
      params
    );
  }

  /**
   * Retrieves logs whose log_date falls within [startDate, endDate], inclusive.
   * Dates should be ISO date strings ("YYYY-MM-DD") so lexicographic
   * comparison matches chronological order.
   *
   * @param {string} startDate
   * @param {string} endDate
   * @returns {Promise<Array<Object>>}
   */
  async getLogsByDateRange(startDate, endDate) {
    this._assertReady();
    const rows = await this.db.getAllAsync(
      `SELECT * FROM logs
       WHERE log_date >= ? AND log_date <= ?
       ORDER BY log_date DESC;`,
      [startDate, endDate]
    );
    return rows.map((row) => this._deserializeLogRow(row));
  }

  /**
   * Deletes a log and everything that belongs to it. The `photos` row for
   * each photo is removed automatically by the ON DELETE CASCADE foreign
   * key, but the *files* on disk are not managed by SQLite at all, so they
   * have to be deleted explicitly first — otherwise you'd leak image files
   * with no database row pointing at them.
   *
   * @param {string} logId
   * @returns {Promise<void>}
   */
  async deleteLog(logId) {
    this._assertReady();
    await this.deletePhotosForLog(logId);
    await this.db.runAsync(`DELETE FROM logs WHERE id = ?;`, [logId]);
  }

  /**
   * Converts a raw SQLite `logs` row (JSON columns as TEXT) into a JS
   * object with parsed weather/workers/materials/issues fields.
   *
   * @private
   */
  _deserializeLogRow(row) {
    return {
      ...row,
      weather: safeJSONParse(row.weather, {}),
      workers: safeJSONParse(row.workers, []),
      materials: safeJSONParse(row.materials, []),
      issues: safeJSONParse(row.issues, []),
    };
  }

  _assertValidSyncStatus(status) {
    const validStatuses = ['pending', 'synced', 'failed'];
    if (!validStatuses.includes(status)) {
      throw new Error(
        `DatabaseManager: invalid sync_status "${status}". Must be one of ${validStatuses.join(', ')}.`
      );
    }
  }

  // =========================================================================
  // Photos (Phase 2)
  // =========================================================================

  /**
   * Ensures the local photos directory exists and returns the Directory
   * instance for it. Safe to call repeatedly — cheap once the directory has
   * been created. Called automatically from initDatabase(), but exposed
   * publicly too in case a caller wants to double-check before a write.
   *
   * @returns {Promise<Directory>}
   */
  async ensurePhotosDirectory() {
    if (!this._photosDirectory) {
      this._photosDirectory = new Directory(Paths.document, PHOTOS_DIR_NAME);
    }
    if (!this._photosDirectory.exists) {
      this._photosDirectory.create();
    }
    return this._photosDirectory;
  }

  /**
   * Compresses an image (resized to PHOTO_COMPRESS_WIDTH, re-encoded as
   * JPEG at PHOTO_COMPRESS_QUALITY) and copies it into the app's private
   * photos directory, then inserts a `photos` row pointing at it.
   *
   * This is the one method screens should call to add a photo — it handles
   * the full pipeline (compress -> persist -> record in DB) so screens
   * never touch ImageManipulator or FileSystem directly.
   *
   * @param {string} photoUri - the URI returned by ImagePicker (camera or gallery)
   * @param {string} logId - the log this photo belongs to (must already exist)
   * @returns {Promise<Object>} the inserted photo record
   */
  async savePhoto(photoUri, logId) {
    this._assertReady();
    const photosDirectory = await this.ensurePhotosDirectory();

    // Resize to a fixed width; ImageManipulator preserves aspect ratio when
    // only one dimension is given.
    const manipulated = await ImageManipulator.manipulateAsync(
      photoUri,
      [{ resize: { width: PHOTO_COMPRESS_WIDTH } }],
      {
        compress: PHOTO_COMPRESS_QUALITY,
        format: ImageManipulator.SaveFormat.JPEG,
      }
    );

    const photoId = generateUUID();

    // manipulateAsync writes its output to a cache/tmp location; copy it
    // into our permanent photos directory so it survives app restarts and
    // isn't cleared by the OS reclaiming cache space.
    const sourceFile = new File(manipulated.uri);
    const destinationFile = new File(photosDirectory, `${photoId}.jpg`);
    sourceFile.copy(destinationFile);

    return this.insertPhoto({
      id: photoId,
      log_id: logId,
      file_path: destinationFile.uri,
      file_size: destinationFile.exists ? destinationFile.size : null,
      width: manipulated.width,
      height: manipulated.height,
      sync_status: 'pending',
    });
  }

  /**
   * Inserts a photo record. Most callers should use savePhoto() instead,
   * which also handles compression and file storage — this is the lower
   * -level DB-only insert, exposed for cases where the file already exists
   * on disk (e.g. a future sync-retry path).
   *
   * @param {Object} photoData
   * @param {string} photoData.id
   * @param {string} photoData.log_id
   * @param {string} photoData.file_path
   * @param {number} [photoData.file_size]
   * @param {number} [photoData.width]
   * @param {number} [photoData.height]
   * @param {'pending'|'synced'|'failed'} [photoData.sync_status='pending']
   * @returns {Promise<Object>}
   */
  async insertPhoto(photoData) {
    this._assertReady();

    const row = {
      id: photoData.id,
      log_id: photoData.log_id,
      file_path: photoData.file_path,
      file_size: photoData.file_size ?? null,
      width: photoData.width ?? null,
      height: photoData.height ?? null,
      sync_status: photoData.sync_status ?? 'pending',
      created_at: photoData.created_at ?? getCurrentTimestamp(),
    };

    await this.db.runAsync(
      `INSERT INTO photos (
        id, log_id, file_path, file_size, width, height, sync_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        row.id,
        row.log_id,
        row.file_path,
        row.file_size,
        row.width,
        row.height,
        row.sync_status,
        row.created_at,
      ]
    );

    return row;
  }

  /**
   * Retrieves all photos for a given log, oldest first (capture order).
   *
   * @param {string} logId
   * @returns {Promise<Array<Object>>}
   */
  async getPhotosForLog(logId) {
    this._assertReady();
    return this.db.getAllAsync(
      `SELECT * FROM photos WHERE log_id = ? ORDER BY created_at ASC;`,
      [logId]
    );
  }

  /**
   * Retrieves all photos still waiting to be synced, across all logs.
   *
   * @returns {Promise<Array<Object>>}
   */
  async getPendingPhotos() {
    this._assertReady();
    return this.db.getAllAsync(
      `SELECT * FROM photos WHERE sync_status = ? ORDER BY created_at ASC;`,
      ['pending']
    );
  }

  /**
   * Updates the sync_status of a single photo.
   *
   * @param {string} photoId
   * @param {'pending'|'synced'|'failed'} status
   * @returns {Promise<void>}
   */
  async updatePhotoSyncStatus(photoId, status) {
    this._assertReady();
    this._assertValidSyncStatus(status);
    await this.db.runAsync(
      `UPDATE photos SET sync_status = ? WHERE id = ?;`,
      [status, photoId]
    );
  }

  /**
   * Deletes a single photo: removes the file from disk (idempotent — no
   * error if it's already gone) and removes its database row.
   *
   * @param {string} photoId
   * @param {string} filePath
   * @returns {Promise<void>}
   */
  async deletePhoto(photoId, filePath) {
    this._assertReady();
    if (filePath) {
      await this._deleteFileIfExists(filePath);
    }
    await this.db.runAsync(`DELETE FROM photos WHERE id = ?;`, [photoId]);
  }

  /**
   * Deletes every photo belonging to a log: all files on disk, then all
   * database rows. Used by deleteLog() before removing the log itself, and
   * safe to call directly too (e.g. "clear all photos" on a log).
   *
   * @param {string} logId
   * @returns {Promise<void>}
   */
  async deletePhotosForLog(logId) {
    this._assertReady();
    const photos = await this.getPhotosForLog(logId);

    await Promise.all(
      photos.map((photo) => this._deleteFileIfExists(photo.file_path))
    );

    await this.db.runAsync(`DELETE FROM photos WHERE log_id = ?;`, [logId]);
  }

  /**
   * Deletes a file by path if it exists, swallowing "already gone" errors
   * so callers get idempotent behavior — matching the old
   * `FileSystem.deleteAsync(path, { idempotent: true })` semantics, since
   * the new File class doesn't have a built-in idempotent option.
   *
   * @private
   * @param {string} filePath
   * @returns {Promise<void>}
   */
  async _deleteFileIfExists(filePath) {
    try {
      const file = new File(filePath);
      if (file.exists) {
        await file.delete();
      }
    } catch (err) {
      // File already gone, or otherwise inaccessible — treat as a no-op
      // rather than letting a delete-a-log-with-photos flow blow up.
      console.warn(`DatabaseManager: could not delete photo file at ${filePath}:`, err);
    }
  }

  // =========================================================================
  // App settings (Phase 4) — small persistent key-value store, currently
  // just used for "last synced at", but generic enough for future use
  // (e.g. selected project id, once a real project picker exists).
  // =========================================================================

  /**
   * Retrieves a single setting value by key. Returns null if unset.
   *
   * @param {string} key
   * @returns {Promise<string|null>}
   */
  async getSetting(key) {
    this._assertReady();
    const row = await this.db.getFirstAsync(
      `SELECT value FROM app_settings WHERE key = ?;`,
      [key]
    );
    return row ? row.value : null;
  }

  /**
   * Sets (or replaces) a setting value.
   *
   * @param {string} key
   * @param {string} value
   * @returns {Promise<void>}
   */
  async setSetting(key, value) {
    this._assertReady();
    await this.db.runAsync(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value;`,
      [key, value]
    );
  }
}

// Export a singleton instance — the whole app shares one DB connection.
const databaseManager = new DatabaseManager();
export default databaseManager;
