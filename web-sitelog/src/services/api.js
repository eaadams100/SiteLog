/**
 * services/api.js
 *
 * All backend communication goes through this file — components never
 * import axios directly. Every method returns already-unwrapped data
 * (the array/object the caller actually wants, not the full
 * `{success, ...}` envelope every SiteLog endpoint returns) and throws a
 * plain Error with a readable `.message` on failure, so components can
 * just `try/catch` without knowing anything about the response shape.
 *
 * Note on downloadPDF(): the original Phase 6 spec listed this as an
 * api.js method, but PDF generation is entirely client-side (jsPDF runs
 * in the browser against data already fetched via getLogs) — there's no
 * backend PDF endpoint, and building one wasn't asked for or needed. See
 * components/ExportPDF.jsx, which builds the PDF directly from props
 * rather than calling this file.
 *
 * Phase 7: every request now carries an Authorization header (via a
 * request interceptor, so every method below gets it automatically
 * without repeating the header object everywhere), and a response
 * interceptor logs the person out and reloads on any 401 — this catches
 * both "never logged in" and "token expired mid-session" the same way.
 */

import axios from 'axios';
import { getToken, logout } from './auth';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://sitelog-api.onrender.com';

const client = axios.create({
  baseURL: API_BASE_URL,
  timeout: 60000, // generous — the Render free tier can take 30-50s to wake from a cold start
  headers: { 'Content-Type': 'application/json' },
});

client.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token missing/invalid/expired — clear the stale session and let
      // App.jsx's auth gate show the login screen again. A hard reload
      // (rather than just calling logout()) also clears any in-flight
      // component state that assumed a valid session, avoiding a
      // confusing half-logged-out UI.
      logout();
      window.location.reload();
    }
    return Promise.reject(error);
  }
);

/**
 * Normalizes any axios error into a plain Error with a human-readable
 * message, preferring the backend's own error string when present.
 */
function normalizeError(err) {
  if (err.response) {
    // Server responded with a non-2xx status.
    const backendMessage = err.response.data?.error;
    return new Error(backendMessage || `Request failed with status ${err.response.status}.`);
  }
  if (err.request) {
    // Request was made, no response came back at all.
    return new Error(
      'Could not reach the SiteLog server. It may be waking up from sleep (Render free tier) — try again in a moment.'
    );
  }
  return new Error(err.message || 'An unexpected error occurred.');
}

/**
 * GET /api/v1/projects
 * @returns {Promise<Array<{project_id: string, name: string, location: string|null, log_count: number}>>}
 */
export async function getProjects() {
  try {
    const { data } = await client.get('/api/v1/projects');
    return data.projects ?? [];
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * GET /api/v1/logs?projectId=...&startDate=...&endDate=...&limit=...&offset=...
 *
 * Note: does NOT include photos — the list endpoint never has (only
 * getLogById does). limit defaults high (200, the backend's own cap) so
 * the dashboard can compute accurate stats and do client-side
 * sorting/pagination over the full filtered set in one request, rather
 * than juggling server-side pages against client-side aggregate stats.
 *
 * @param {string} projectId - required by the backend
 * @param {string|null} [startDate] - "YYYY-MM-DD"
 * @param {string|null} [endDate] - "YYYY-MM-DD"
 * @param {number} [limit=200]
 * @param {number} [offset=0]
 * @returns {Promise<Array<Object>>}
 */
export async function getLogs(projectId, startDate = null, endDate = null, limit = 200, offset = 0) {
  if (!projectId) return [];
  try {
    const { data } = await client.get('/api/v1/logs', {
      params: { projectId, startDate: startDate || undefined, endDate: endDate || undefined, limit, offset },
    });
    return data.logs ?? [];
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * GET /api/v1/logs/:id — includes photos, unlike getLogs().
 * @param {string} logId
 * @returns {Promise<Object>}
 */
export async function getLogById(logId) {
  try {
    const { data } = await client.get(`/api/v1/logs/${logId}`);
    return data.log;
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * PUT /api/v1/logs/:id/flag
 * @param {string} logId
 * @param {number} issueIndex - 0-based position in the log's issues array
 * @param {boolean} flagged
 * @returns {Promise<Object>} the updated log
 */
export async function flagIssue(logId, issueIndex, flagged) {
  try {
    const { data } = await client.put(`/api/v1/logs/${logId}/flag`, { issueIndex, flagged });
    return data.log;
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * GET /api/v1/conflicts?projectId=...
 *
 * Not wired into the main dashboard view (see App.jsx) — since Phase 5,
 * this returns conflict HISTORY (an audit trail of automatic merges),
 * not a review queue, and there's no manual-override UI to act on it
 * yet. Exported here so it's ready to use if a "Conflict History" panel
 * gets added later.
 *
 * @param {string} projectId
 * @returns {Promise<Array<Object>>}
 */
export async function getConflicts(projectId) {
  try {
    const { data } = await client.get('/api/v1/conflicts', { params: { projectId } });
    return data.conflicts ?? [];
  } catch (err) {
    throw normalizeError(err);
  }
}