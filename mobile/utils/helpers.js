/**
 * helpers.js
 * General-purpose utility functions used across the SiteLog app.
 */

/**
 * Generates an RFC-4122 version 4 UUID.
 * Uses Math.random() as a fallback source of randomness, which is sufficient
 * for local primary keys (not cryptographic use). If the `expo-crypto`
 * package is installed, you can swap this for `Crypto.randomUUID()`.
 *
 * @returns {string} a v4 UUID, e.g. "3fa85f64-5717-4562-b3fc-2c963f66afa6"
 */
export function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Returns the current date/time as an ISO-8601 timestamp string.
 * Example: "2026-07-31T14:23:05.123Z"
 *
 * @returns {string}
 */
export function getCurrentTimestamp() {
  return new Date().toISOString();
}

/**
 * Returns today's date as an ISO date string (YYYY-MM-DD), using local time
 * (not UTC), which is what a site supervisor would expect for "today".
 *
 * @returns {string} e.g. "2026-07-31"
 */
export function getTodayISODate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Formats an ISO date string (YYYY-MM-DD) for display, e.g. "Jul 31, 2026".
 * Falls back to the raw input if it cannot be parsed.
 *
 * @param {string} isoDateString
 * @returns {string}
 */
export function formatDate(isoDateString) {
  if (!isoDateString) return '';
  try {
    // Parse as local date to avoid timezone off-by-one issues with
    // date-only strings (new Date('2026-07-31') is parsed as UTC midnight).
    const [year, month, day] = isoDateString.split('-').map(Number);
    if (!year || !month || !day) return isoDateString;
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch (err) {
    return isoDateString;
  }
}

/**
 * Formats an ISO timestamp for display, e.g. "Jul 31, 2026, 2:23 PM".
 *
 * @param {string} isoTimestamp
 * @returns {string}
 */
export function formatTimestamp(isoTimestamp) {
  if (!isoTimestamp) return '';
  try {
    const date = new Date(isoTimestamp);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch (err) {
    return isoTimestamp;
  }
}

/**
 * Formats an ISO timestamp as a short relative time string, e.g.
 * "just now", "5 min ago", "3 hr ago", "2 days ago". Falls back to
 * formatTimestamp() for anything more than a week old, where a relative
 * string stops being more useful than an actual date.
 *
 * @param {string} isoTimestamp
 * @returns {string}
 */
export function formatRelativeTime(isoTimestamp) {
  if (!isoTimestamp) return '';
  try {
    const then = new Date(isoTimestamp).getTime();
    const now = Date.now();
    const diffMs = now - then;
    if (diffMs < 0) return 'just now';

    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return 'just now';

    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} min ago`;

    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr} hr ago`;

    const diffDays = Math.floor(diffHr / 24);
    if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;

    return formatTimestamp(isoTimestamp);
  } catch (err) {
    return isoTimestamp;
  }
}

/**
 * Safely parses a JSON string, returning a fallback value on failure.
 * Used when reading JSON columns back out of SQLite.
 *
 * @param {string} jsonString
 * @param {*} fallback
 * @returns {*}
 */
export function safeJSONParse(jsonString, fallback) {
  if (jsonString === null || jsonString === undefined) return fallback;
  try {
    return JSON.parse(jsonString);
  } catch (err) {
    return fallback;
  }
}
