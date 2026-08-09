/**
 * constants/api.js
 *
 * Central place for backend API configuration. A plain constant rather
 * than an env-based / app.json `extra` setup, since there's only one
 * deployed environment right now (Render). If you ever need different
 * URLs for dev vs. production builds, this is the file to swap for an
 * `expo-constants` + `app.json extra.apiBaseUrl` approach — nothing else
 * in the sync code needs to change, since everything imports from here.
 */

export const API_BASE_URL = 'https://sitelog-api.onrender.com';

export const API_ENDPOINTS = {
  sync: '/api/v1/sync',
  projects: '/api/v1/projects',
  logs: '/api/v1/logs',
  conflicts: '/api/v1/conflicts',
  health: '/health',
};

// Render's free tier spins the server down after inactivity — the first
// request after a period of idleness can take 30-50s to wake it back up.
// A short timeout here would make every "cold start" sync look like a
// network failure, so this is intentionally generous.
export const API_TIMEOUT_MS = 60000;

// How many logs to send per sync request. Keeps individual requests fast
// and lets the UI report progress incrementally, rather than one giant
// request for a large backlog of pending logs.
export const SYNC_BATCH_SIZE = 25;

// Network-triggered retry behavior for whole-batch failures (e.g. request
// timed out, no connectivity mid-request). Per-log failures reported by
// the backend (bad project_id, etc.) are NOT retried here — those get
// marked 'failed' immediately, since retrying the exact same invalid data
// would just fail again. See SyncService.js for where this is used.
export const SYNC_RETRY_ATTEMPTS = 2;
export const SYNC_RETRY_DELAY_MS = 3000;
