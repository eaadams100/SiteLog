/**
 * DatabaseManager.js
 *
 * Wraps all SQLite access for SiteLog behind a single class so screens never
 * touch raw SQL. Built on the modern async expo-sqlite API
 * (SQLite.openDatabaseAsync / execAsync / runAsync / getAllAsync), which
 * ships with expo-sqlite ~14 (Expo SDK 51+).
 *
 * JSON columns (weather, workers, materials, issues) are stored as TEXT and
 * transparently serialized/deserialized on the way in and out, so callers
 * always work with plain JS objects/arrays.
 */

import * as SQLite from 'expo-sqlite';
import { getCurrentTimestamp, safeJSONParse } from '../utils/helpers';

const DATABASE_NAME = 'sitelog.db';

class DatabaseManager {
  constructor() {
    this.db = null;
    this._initPromise = null;
  }

  /**
   * Opens the database and creates tables/indexes if they don't exist yet.
   * Safe to call multiple times — subsequent calls reuse the same open
   * connection / in-flight initialization promise.
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

      this.db = db;
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

    return this._deserializeRow(row);
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
    return rows.map((row) => this._deserializeRow(row));
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
    return row ? this._deserializeRow(row) : null;
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
    return rows.map((row) => this._deserializeRow(row));
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
    const validStatuses = ['pending', 'synced', 'failed'];
    if (!validStatuses.includes(status)) {
      throw new Error(
        `DatabaseManager: invalid sync_status "${status}". Must be one of ${validStatuses.join(', ')}.`
      );
    }
    await this.db.runAsync(
      `UPDATE logs SET sync_status = ?, updated_at = ? WHERE id = ?;`,
      [status, getCurrentTimestamp(), logId]
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
    return rows.map((row) => this._deserializeRow(row));
  }

  /**
   * Deletes a log by id. Not in the original spec, but included since a
   * real supervisor will eventually need to remove a bad entry.
   *
   * @param {string} logId
   * @returns {Promise<void>}
   */
  async deleteLog(logId) {
    this._assertReady();
    await this.db.runAsync(`DELETE FROM logs WHERE id = ?;`, [logId]);
  }

  /**
   * Converts a raw SQLite row (JSON columns as TEXT) into a JS object with
   * parsed weather/workers/materials/issues fields.
   *
   * @private
   */
  _deserializeRow(row) {
    return {
      ...row,
      weather: safeJSONParse(row.weather, {}),
      workers: safeJSONParse(row.workers, []),
      materials: safeJSONParse(row.materials, []),
      issues: safeJSONParse(row.issues, []),
    };
  }
}

// Export a singleton instance — the whole app shares one DB connection.
const databaseManager = new DatabaseManager();
export default databaseManager;
