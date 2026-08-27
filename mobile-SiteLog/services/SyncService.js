/**
 * services/SyncService.js
 *
 * The sync engine: pushes pending logs (and their photos) from local
 * SQLite up to the backend, in batches, only when online, without
 * blocking the UI. Not a React component or hook — a plain singleton
 * module, so it can be triggered from anywhere (a button press, a
 * NetInfo listener, an AppState change, a background interval) without
 * needing to live inside a component tree.
 *
 * IMPORTANT — payload/response format note:
 * The Phase 4 planning doc described a payload shape with a top-level
 * `projectId`, `log_id` as the log identifier, and a separate `photos`
 * object keyed by log id — plus a response shaped as
 * `{ success, data: { processed, conflicts, errors, details } }`.
 * That does NOT match the Phase 3 backend that's actually deployed at
 * https://sitelog-api.onrender.com. The real, tested contract is:
 *   - each log uses `id` (not `log_id`)
 *   - photos are nested *inside* each log as `log.photos` (not a
 *     separate top-level object)
 *   - no top-level `projectId` — each log carries its own `project_id`
 *   - the response is `{ success, summary: {...}, details: [...] }`,
 *     not `{ success, data: {...} }`
 * This file is written against the real, already-verified contract —
 * see backend/README.md's "API" section for the authoritative shape.
 *
 * `project_id` note (previously an open blocker, now resolved):
 * mobile/app/log-entry.js's DEFAULT_PROJECT_ID is a real UUID
 * (76f663d3-aeff-40f3-b7d6-7c8e0f7e83a0) matching a project seeded by
 * backend/src/db/seed.js — not the placeholder string
 * "default-project" that would fail every sync with a foreign key
 * violation. Verified end-to-end against a real Postgres instance: a
 * payload shaped exactly like this file's _buildPayload() output, sent
 * to a freshly migrated + seeded database, comes back
 * `{"success":true,"summary":{"processed":1,"conflicts":0,"errors":0}}`
 * with the row actually present in daily_logs. This is a single hardcoded
 * default, not a real project picker — see backend/README.md's "What's
 * next" section for that.
 *
 * PHASE 5 — conflict resolution:
 * The backend now auto-resolves conflicts (two logs for the same
 * project + date) during sync, rather than just flagging them. A
 * response detail with status "conflict_resolved" means this log's data
 * got merged with another log's — see _applyResponse below, which
 * fetches the canonical merged result and overwrites local content with
 * it. This is the one intentional exception to "local is always the
 * source of truth until synced" elsewhere in this app.
 */

import databaseManager from '../db/DatabaseManager';
import authService from './AuthService';
import {
  API_BASE_URL,
  API_ENDPOINTS,
  API_TIMEOUT_MS,
  SYNC_BATCH_SIZE,
  SYNC_RETRY_ATTEMPTS,
  SYNC_RETRY_DELAY_MS,
} from '../constants/api';

const LAST_SYNCED_AT_KEY = 'lastSyncedAt';

/**
 * Sync status values a listener might receive:
 *   'idle'     - not currently syncing
 *   'syncing'  - a sync is in progress
 *   'success'  - the most recent sync completed with no failures
 *   'error'    - the most recent sync completed with at least one failure,
 *                or couldn't run at all (e.g. no network)
 */

class SyncService {
  constructor() {
    this._isSyncing = false;
    this._listeners = new Set();
    this._state = {
      status: 'idle',
      progress: { current: 0, total: 0 },
      lastResult: null, // { synced, conflicts, failed, error? }
      lastSyncedAt: null,
    };

    // Auto-sync wiring (network reconnect / app foreground / interval) is
    // opt-in via startAutoSync() — see that method — rather than firing
    // automatically on import, so app/_layout.js stays the one place that
    // controls when auto-sync is actually active.
    this._netInfoUnsubscribe = null;
    this._appStateSubscription = null;
    this._intervalId = null;
    this._wasOffline = null; // tracks previous connectivity state to detect reconnects
  }

  // ===========================================================================
  // Subscription (used by useSyncStatus.js)
  // ===========================================================================

  /**
   * Subscribes to sync state changes. Returns an unsubscribe function.
   * Immediately invokes the listener once with current state, so callers
   * don't have to wait for the next change to render correctly.
   *
   * @param {(state: Object) => void} listener
   * @returns {() => void}
   */
  subscribe(listener) {
    this._listeners.add(listener);
    listener(this._state);
    return () => this._listeners.delete(listener);
  }

  _emit(partialState) {
    this._state = { ...this._state, ...partialState };
    for (const listener of this._listeners) {
      listener(this._state);
    }
  }

  // ===========================================================================
  // Setup / one-time init
  // ===========================================================================

  /**
   * Loads persisted state (last synced timestamp) from SQLite. Safe to
   * call once at app start, after databaseManager.initDatabase().
   *
   * @returns {Promise<void>}
   */
  async loadPersistedState() {
    try {
      const lastSyncedAt = await databaseManager.getSetting(LAST_SYNCED_AT_KEY);
      if (lastSyncedAt) {
        this._emit({ lastSyncedAt });
      }
    } catch (err) {
      console.warn('SyncService: failed to load persisted state:', err);
    }
  }

  // ===========================================================================
  // Core sync logic
  // ===========================================================================

  /**
   * Runs a sync now, regardless of network state checks elsewhere (the
   * fetch itself will simply fail if there's no connectivity — see
   * _postWithRetry). Safe to call concurrently; if a sync is already in
   * progress, this is a no-op that resolves immediately rather than
   * running two syncs at once.
   *
   * @returns {Promise<{synced: number, conflicts: number, failed: number, error?: string}>}
   */
  async syncNow() {
    if (this._isSyncing) {
      return this._state.lastResult ?? { synced: 0, conflicts: 0, failed: 0 };
    }

    this._isSyncing = true;
    this._emit({ status: 'syncing', progress: { current: 0, total: 0 } });

    const result = { synced: 0, conflicts: 0, failed: 0 };

    try {
      const pendingLogs = await databaseManager.getPendingLogs();

      if (pendingLogs.length === 0) {
        this._emit({ status: 'idle', lastResult: result });
        return result;
      }

      const batches = chunk(pendingLogs, SYNC_BATCH_SIZE);
      this._emit({ progress: { current: 0, total: pendingLogs.length } });

      let syncedSoFar = 0;

      for (const batch of batches) {
        const payload = await this._buildPayload(batch);
        const response = await this._postWithRetry(payload);
        await this._applyResponse(batch, response, result);

        syncedSoFar += batch.length;
        this._emit({ progress: { current: syncedSoFar, total: pendingLogs.length } });
      }

      const now = new Date().toISOString();
      await databaseManager.setSetting(LAST_SYNCED_AT_KEY, now);

      const status = result.failed > 0 ? 'error' : 'success';
      this._emit({ status, lastResult: result, lastSyncedAt: now });
      return result;
    } catch (err) {
      // A whole-batch failure we couldn't recover from even after retries
      // (e.g. genuinely offline, or the server is unreachable) — nothing
      // in this run got marked synced/failed locally, since we don't know
      // whether the server received it. Pending logs stay 'pending' and
      // will be retried on the next sync trigger.
      console.warn('SyncService: sync run failed:', err);
      const message = describeNetworkError(err);
      this._emit({ status: 'error', lastResult: { ...result, error: message } });
      return { ...result, error: message };
    } finally {
      this._isSyncing = false;
    }
  }

  /**
   * Convenience wrapper for automatic sync triggers (reconnect, app
   * foreground, interval): only actually syncs if there's something to
   * sync, and never throws — auto-triggers shouldn't crash the caller.
   *
   * @returns {Promise<void>}
   */
  async syncIfNeeded() {
    try {
      if (this._isSyncing) return;
      const pendingLogs = await databaseManager.getPendingLogs();
      if (pendingLogs.length === 0) return;
      await this.syncNow();
    } catch (err) {
      console.warn('SyncService: syncIfNeeded failed:', err);
    }
  }

  /**
   * Builds one sync request payload from a batch of local log rows,
   * attaching each log's photos. Matches the ACTUAL backend contract
   * (see file header) — not the doc's proposed shape.
   *
   * @private
   * @param {Array<Object>} logBatch - rows from databaseManager.getPendingLogs()
   * @returns {Promise<{logs: Array<Object>}>}
   */
  async _buildPayload(logBatch) {
    const logs = await Promise.all(
      logBatch.map(async (log) => {
        const photos = await databaseManager.getPhotosForLog(log.id);
        return {
          id: log.id,
          project_id: log.project_id,
          log_date: log.log_date,
          weather: log.weather,
          workers: log.workers,
          materials: log.materials,
          issues: log.issues,
          notes: log.notes,
          supervisor_name: log.supervisor_name,
          created_at: log.created_at,
          updated_at: log.updated_at,
          photos: photos.map((photo) => ({
            id: photo.id,
            file_path: photo.file_path,
            file_size: photo.file_size,
            width: photo.width,
            height: photo.height,
            created_at: photo.created_at,
          })),
        };
      })
    );

    return { logs };
  }

  /**
   * POSTs a payload to /api/v1/sync, retrying on whole-request network
   * failures (timeout, connection dropped, server unreachable) with a
   * short delay — but NOT retrying on a normal HTTP error response, since
   * that means the server was reachable and responded (retrying an
   * identical bad request would just fail the same way again).
   *
   * @private
   * @param {Object} payload
   * @returns {Promise<Object>} parsed JSON response body
   */
  async _postWithRetry(payload) {
    let lastError;

    for (let attempt = 0; attempt <= SYNC_RETRY_ATTEMPTS; attempt += 1) {
      try {
        return await this._post(payload);
      } catch (err) {
        lastError = err;
        const isLastAttempt = attempt === SYNC_RETRY_ATTEMPTS;
        if (isLastAttempt) break;
        await delay(SYNC_RETRY_DELAY_MS);
      }
    }

    throw lastError;
  }

  /**
   * Single POST attempt with a manual timeout (fetch has no built-in
   * timeout option) via AbortController.
   *
   * @private
   * @param {Object} payload
   * @returns {Promise<Object>}
   */
  async _post(payload) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    try {
      const token = await authService.getToken();
      const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.sync}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        const message = body?.error || `Server responded with status ${response.status}.`;
        const httpError = new Error(message);
        httpError.isHttpError = true;
        httpError.status = response.status;
        throw httpError;
      }

      return body;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Fetches a single log (with current, possibly server-merged, field
   * values) from GET /api/v1/logs/:id. Used only for the
   * 'conflict_resolved' case in _applyResponse — the normal sync path
   * never needs a read-back, since the server accepted exactly what was
   * sent.
   *
   * @private
   * @param {string} logId
   * @returns {Promise<Object|null>}
   */
  async _fetchLog(logId) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    try {
      const token = await authService.getToken();
      const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.logs}/${logId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const body = await response.json().catch(() => null);
      return body?.log ?? null;
    } catch (err) {
      console.warn(`SyncService: failed to fetch log ${logId} after conflict resolution:`, err);
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Applies a sync response to local storage: updates each log's (and its
   * photos') sync_status based on what the backend reported.
   *
   * PHASE 5 BEHAVIOR: a log with status "conflict_resolved" means the
   * backend detected another log for the same project + date and
   * automatically merged them (Last-Write-Wins for scalar fields, union
   * for arrays — see backend/README.md). Unlike Phase 4's older
   * "conflict" status (server flags it, does nothing further), this
   * device's local copy is now genuinely out of date — it might be
   * missing worker/material/issue entries the OTHER device submitted, or
   * have stale weather/notes if the other device's edit was more recent.
   * So this fetches the canonical merged log from the server
   * (detail.primary_log_id — the merge target might be a DIFFERENT log_id
   * than the one this device submitted, if the other device's log was
   * chosen as primary) and overwrites local content with it via
   * updateLogFields(). This is the one place in the app where server data
   * is allowed to overwrite local data — everywhere else, local is always
   * the source of truth until synced.
   *
   * Only "error" results in a local 'failed' status.
   *
   * @private
   * @param {Array<Object>} logBatch - the logs that were just sent
   * @param {Object} response - parsed response body from _post
   * @param {{synced: number, conflicts: number, failed: number}} result - mutated in place
   */
  async _applyResponse(logBatch, response, result) {
    const details = response?.details ?? [];
    const detailsById = new Map(details.map((d) => [d.log_id, d]));

    for (const log of logBatch) {
      const detail = detailsById.get(log.id);

      if (!detail || detail.status === 'error') {
        await databaseManager.updateSyncStatus(log.id, 'failed');
        result.failed += 1;
        continue;
      }

      if (detail.status === 'conflict_resolved') {
        // Local row is marked synced regardless of whether the fetch below
        // succeeds — the merge DID happen server-side either way; a failed
        // fetch just means this device's local copy stays one step behind
        // until the next sync, not that anything was lost.
        await databaseManager.updateSyncStatus(log.id, 'synced');
        result.conflicts += 1;

        const primaryLog = await this._fetchLog(detail.primary_log_id ?? log.id);
        if (primaryLog) {
          await databaseManager.updateLogFields(log.id, {
            weather: primaryLog.weather,
            workers: primaryLog.workers,
            materials: primaryLog.materials,
            issues: primaryLog.issues,
            notes: primaryLog.notes,
            supervisor_name: primaryLog.supervisor_name,
          });
        }
      } else {
        // 'synced' (and the older Phase 3/4 'conflict' status, kept for
        // backward compatibility with a not-yet-upgraded backend).
        await databaseManager.updateSyncStatus(log.id, 'synced');
        if (detail.status === 'conflict') {
          result.conflicts += 1;
        } else {
          result.synced += 1;
        }
      }

      // Response doesn't grant per-photo acknowledgement, only a count —
      // mark every local photo for this log as synced once the log
      // itself was accepted.
      const photos = await databaseManager.getPhotosForLog(log.id);
      await Promise.all(
        photos
          .filter((photo) => photo.sync_status === 'pending')
          .map((photo) => databaseManager.updatePhotoSyncStatus(photo.id, 'synced'))
      );
    }
  }

  // ===========================================================================
  // Automatic sync triggers
  // ===========================================================================

  /**
   * Wires up automatic sync: on reconnect to the network, on app
   * foreground, and on a periodic interval — each guarded by
   * syncIfNeeded() so nothing happens if there are no pending logs.
   * Call once from app/_layout.js on mount; call the returned cleanup
   * function on unmount.
   *
   * Deliberately takes NetInfo and AppState as parameters rather than
   * importing them directly in this file, so this module has no
   * React-Native-specific import at the top level — keeps it easy to
   * unit-test in plain Node if that's ever wanted.
   *
   * @param {Object} deps
   * @param {typeof import('@react-native-community/netinfo').default} deps.NetInfo
   * @param {typeof import('react-native').AppState} deps.AppState
   * @param {number} [deps.intervalMs] - periodic sync check interval; 0/undefined disables it
   * @returns {() => void} cleanup function
   */
  startAutoSync({ NetInfo, AppState, intervalMs = 5 * 60 * 1000 }) {
    // --- Sync on reconnect ---
    this._netInfoUnsubscribe = NetInfo.addEventListener((state) => {
      const isOnline = Boolean(state.isConnected && state.isInternetReachable !== false);
      const wasOffline = this._wasOffline;
      this._wasOffline = !isOnline;

      if (isOnline && wasOffline) {
        this.syncIfNeeded();
      }
    });

    // --- Sync on app foreground ---
    this._appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        this.syncIfNeeded();
      }
    });

    // --- Periodic sync while the app is open ---
    if (intervalMs > 0) {
      this._intervalId = setInterval(() => {
        this.syncIfNeeded();
      }, intervalMs);
    }

    return () => this.stopAutoSync();
  }

  /**
   * Tears down whatever startAutoSync() set up. Safe to call even if
   * startAutoSync() was never called.
   */
  stopAutoSync() {
    if (this._netInfoUnsubscribe) {
      this._netInfoUnsubscribe();
      this._netInfoUnsubscribe = null;
    }
    if (this._appStateSubscription) {
      this._appStateSubscription.remove();
      this._appStateSubscription = null;
    }
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }
}

// ===========================================================================
// Small helpers
// ===========================================================================

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Turns a raw fetch/AbortController error into a message a construction
 * site supervisor (not a developer) can actually act on.
 */
function describeNetworkError(err) {
  if (err?.name === 'AbortError') {
    return 'The server took too long to respond. This can happen on the first sync after a period of inactivity — try again in a moment.';
  }
  if (err?.isHttpError) {
    return err.message;
  }
  if (err?.message?.toLowerCase().includes('network')) {
    return 'No network connection. Your logs are saved locally and will sync automatically once you\'re back online.';
  }
  return err?.message || 'Sync failed for an unknown reason. Please try again.';
}

// Singleton, matching the DatabaseManager pattern used elsewhere in the app.
const syncService = new SyncService();
export default syncService;