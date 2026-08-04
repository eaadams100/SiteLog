/**
 * src/services/conflictResolver.js
 *
 * Conflict resolution for daily logs. A conflict happens when two
 * supervisors, both working offline, each create a separate log (separate
 * log_id, generated client-side) for the same project on the same date.
 * There's no way to prevent this at write time — the mobile app can't
 * know about the other supervisor's unsynced log — so this runs at sync
 * time, when both logs finally reach the backend.
 *
 * Design decision (not fully specified by the Phase 3 doc, so documenting
 * the reasoning here): conflicting logs are NOT silently merged into a
 * single row that overwrites either supervisor's submission. For a
 * construction site's daily record, quietly discarding one supervisor's
 * entered data would be worse than surfacing the conflict — audit trail
 * matters here. Instead:
 *   - Every conflicting log_id is kept as its own row, all flagged
 *     sync_status='conflict'.
 *   - This resolver computes a *suggested* merged view (LWW for scalars,
 *     union for arrays) that the caller can store/return alongside the
 *     conflict, for a human (or the Phase 6 dashboard) to review and
 *     confirm — not applied automatically.
 *
 * Merge strategy:
 *   - Scalar fields (weather, notes, supervisor_name): Last-Write-Wins,
 *     based on each log's updated_at.
 *   - Array fields (workers, materials, issues): union by a natural key
 *     (trade / name+unit / description), keeping the most-recently-updated
 *     log's version of each entry when the same key appears in more than
 *     one log. This is a "keep latest per item" merge, not a sum — e.g.
 *     two logs both listing "Mason" won't have their counts added
 *     together, since that risks double-counting the same crew if one
 *     supervisor's entry is actually just a re-entry of the other's. If
 *     your business logic wants worker counts summed instead (e.g. two
 *     supervisors genuinely each brought a different crew), that's a
 *     one-line change in mergeArrayField below — flagging it here since
 *     it's a real judgment call, not something the spec settled.
 */

/**
 * Picks the value from whichever log has the latest updated_at, for a
 * given scalar field. Falls back through logs in order if the "latest"
 * one has a falsy/empty value for that field.
 *
 * @param {Array<Object>} logsNewestFirst
 * @param {string} field
 * @returns {*}
 */
function resolveScalarLWW(logsNewestFirst, field) {
  for (const log of logsNewestFirst) {
    const value = log[field];
    const isEmpty =
      value === null ||
      value === undefined ||
      value === '' ||
      (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);
    if (!isEmpty) return value;
  }
  return logsNewestFirst[0]?.[field] ?? null;
}

/**
 * Merges an array field across multiple logs, deduping by a natural key.
 * When the same key appears in more than one log, keeps the version from
 * whichever log is listed first in `logsNewestFirst` (i.e. most recently
 * updated).
 *
 * @param {Array<Object>} logsNewestFirst
 * @param {string} field
 * @param {(item: Object) => string} keyFn
 * @returns {Array<Object>}
 */
function mergeArrayField(logsNewestFirst, field, keyFn) {
  const merged = new Map();
  // Iterate oldest-first so that when we overwrite a key, the newest
  // log's version ends up as the final value for that key.
  const oldestFirst = [...logsNewestFirst].reverse();
  for (const log of oldestFirst) {
    const items = Array.isArray(log[field]) ? log[field] : [];
    for (const item of items) {
      merged.set(keyFn(item), item);
    }
  }
  return Array.from(merged.values());
}

const workerKey = (w) => `${(w.trade || '').trim().toLowerCase()}`;
const materialKey = (m) => `${(m.name || '').trim().toLowerCase()}__${(m.unit || '').trim().toLowerCase()}`;
const issueKey = (i) => `${(i.description || '').trim().toLowerCase()}`;

/**
 * Resolves a conflict between an incoming log and one or more existing
 * logs for the same project + date.
 *
 * @param {Object} incomingLog - the log currently being synced (must include log_id/id, updated_at, and the standard log fields)
 * @param {Array<Object>} existingLogs - other logs already in the DB for the same project + date
 * @returns {{ resolvedData: Object, hasConflict: boolean, conflictingLogIds: Array<string> }}
 */
function resolveConflict(incomingLog, existingLogs) {
  const hasConflict = existingLogs.length > 0;

  if (!hasConflict) {
    return {
      resolvedData: {
        weather: incomingLog.weather,
        notes: incomingLog.notes,
        supervisor_name: incomingLog.supervisor_name,
        workers: incomingLog.workers || [],
        materials: incomingLog.materials || [],
        issues: incomingLog.issues || [],
      },
      hasConflict: false,
      conflictingLogIds: [],
    };
  }

  const allLogs = [incomingLog, ...existingLogs];
  const logsNewestFirst = [...allLogs].sort(
    (a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at)
  );

  const resolvedData = {
    weather: resolveScalarLWW(logsNewestFirst, 'weather'),
    notes: resolveScalarLWW(logsNewestFirst, 'notes'),
    supervisor_name: resolveScalarLWW(logsNewestFirst, 'supervisor_name'),
    workers: mergeArrayField(logsNewestFirst, 'workers', workerKey),
    materials: mergeArrayField(logsNewestFirst, 'materials', materialKey),
    issues: mergeArrayField(logsNewestFirst, 'issues', issueKey),
  };

  const conflictingLogIds = existingLogs.map((log) => log.log_id || log.id);

  return { resolvedData, hasConflict: true, conflictingLogIds };
}

module.exports = { resolveConflict, resolveScalarLWW, mergeArrayField };
