/**
 * src/services/conflictResolver.js
 *
 * Conflict resolution for daily logs. A conflict happens when two
 * supervisors, both working offline, each create a separate log (separate
 * log_id, generated client-side) for the same project on the same date.
 * There's no way to prevent this at write time, so it's caught at sync
 * time, when both logs finally reach the backend.
 *
 * PHASE 5 BEHAVIOR CHANGE (documented plainly, since it reverses a
 * deliberate Phase 3 decision):
 * Phase 3 never auto-merged conflicting logs — both rows were kept as-is,
 * flagged for human review, with a suggested merge computed but not
 * applied. Phase 5 asks for automatic, synchronous merging with no review
 * step, so that's what this file now does. To keep the audit-trail
 * concern that motivated Phase 3's original design, the merge still
 * doesn't destroy anything: every submitted log keeps its own row; one of
 * them (the "primary" — see pickPrimaryLog below) gets updated in place
 * with the merged data, and `merged_from_logs` records exactly which logs
 * were folded in. Nothing is deleted, but resolution now happens
 * automatically rather than waiting for a person.
 *
 * Merge strategy:
 *   - Scalar fields (weather, notes, supervisor_name): Last-Write-Wins,
 *     based on each log's updated_at.
 *   - workers: union keyed by `trade` — if the same trade appears in more
 *     than one log, the most-recently-updated log's entry for that trade
 *     wins (this can mean a worker COUNT gets overwritten, not summed —
 *     same reasoning as Phase 3: two "Mason: 4" entries are more likely
 *     the same crew logged twice than two different crews. Change the
 *     workerKey/merge call below if your usage pattern needs summing).
 *   - materials / issues: union with EXACT-duplicate removal — two
 *     materials are only treated as "the same" if name AND quantity AND
 *     unit all match (issues: description AND flagged). Unlike workers,
 *     this does NOT collapse two entries that share a name/description
 *     but differ in the other fields — both are kept. This matches the
 *     spec's literal wording ("remove exact duplicates (same name +
 *     quantity + unit)") rather than the partial-key "latest wins"
 *     approach used for workers.
 *
 * Photos are NOT merged here. Photos aren't a JSONB array column on
 * daily_logs — they're rows in a separate `photos` table, each already
 * tied to whichever log_id they were submitted under. "Merging" them for
 * Phase 5 means aggregating across the primary log + everything in its
 * merged_from_logs when reading a log back out — see
 * DailyLog.getById()'s photo query — rather than computing and storing a
 * merged photo array here, which wouldn't map onto the actual schema.
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
 * Merges an array field across multiple logs, deduping by a natural key,
 * keeping the most-recently-updated log's version when the same key
 * appears more than once. Used for `workers`.
 *
 * @param {Array<Object>} logsNewestFirst
 * @param {string} field
 * @param {(item: Object) => string} keyFn
 * @returns {Array<Object>}
 */
function mergeByKeyLatestWins(logsNewestFirst, field, keyFn) {
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

/**
 * Merges an array field across multiple logs as a true union, removing
 * only EXACT duplicates (every field in fieldsToCompare matches). Unlike
 * mergeByKeyLatestWins, this never overwrites one entry with another —
 * entries that share a partial key but differ elsewhere are both kept.
 * Used for `materials` and `issues`.
 *
 * @param {Array<Object>} logs - any order; order doesn't affect the result
 * @param {string} field
 * @param {(item: Object) => string} exactKeyFn - key built from ALL fields that define "duplicate"
 * @returns {Array<Object>}
 */
function unionRemoveExactDuplicates(logs, field, exactKeyFn) {
  const seen = new Map();
  for (const log of logs) {
    const items = Array.isArray(log[field]) ? log[field] : [];
    for (const item of items) {
      const key = exactKeyFn(item);
      if (!seen.has(key)) {
        seen.set(key, item);
      }
    }
  }
  return Array.from(seen.values());
}

const workerKey = (w) => `${(w.trade || '').trim().toLowerCase()}`;
const materialExactKey = (m) =>
  `${(m.name || '').trim().toLowerCase()}__${m.quantity}__${(m.unit || '').trim().toLowerCase()}`;
const issueExactKey = (i) => `${(i.description || '').trim().toLowerCase()}__${Boolean(i.flagged)}`;

/**
 * Deterministically picks which of a set of conflicting logs is the
 * "primary" — the one that gets updated in place with merged data.
 * Deterministic so re-running resolution (e.g. a third log arriving
 * later for the same date) always agrees on which row is primary:
 *   1. A log that's already marked conflict_resolved=true (i.e. already
 *      the primary from an earlier merge) stays primary — this is what
 *      lets a 3rd, 4th, ... conflicting log join an existing merge group
 *      instead of starting a new one.
 *   2. Otherwise, the earliest-created log wins.
 *
 * @param {Array<Object>} logs - all logs involved (existing + incoming), any order
 * @returns {Object} the chosen primary log
 */
function pickPrimaryLog(logs) {
  const alreadyPrimary = logs.find((log) => log.conflict_resolved === true);
  if (alreadyPrimary) return alreadyPrimary;

  return [...logs].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0];
}

/**
 * Resolves a conflict between an incoming log and one or more existing
 * logs for the same project + date. Returns the merged field values —
 * does NOT write anything to the database; see syncController.js for how
 * this gets applied within a transaction.
 *
 * @param {Object} incomingLog - the log currently being synced (must include log_id/id, updated_at, created_at, and the standard log fields)
 * @param {Array<Object>} existingLogs - other logs already in the DB for the same project + date
 * @returns {{
 *   resolvedData: {weather: *, notes: *, supervisor_name: *, workers: Array, materials: Array, issues: Array},
 *   hasConflict: boolean,
 *   conflictingLogIds: Array<string>,
 *   primaryLogId: string,
 * }}
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
      primaryLogId: incomingLog.log_id || incomingLog.id,
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
    workers: mergeByKeyLatestWins(logsNewestFirst, 'workers', workerKey),
    materials: unionRemoveExactDuplicates(allLogs, 'materials', materialExactKey),
    issues: unionRemoveExactDuplicates(allLogs, 'issues', issueExactKey),
  };

  const primary = pickPrimaryLog(allLogs);
  const primaryLogId = primary.log_id || primary.id;

  const conflictingLogIds = allLogs
    .map((log) => log.log_id || log.id)
    .filter((id) => id !== primaryLogId);

  return { resolvedData, hasConflict: true, conflictingLogIds, primaryLogId };
}

module.exports = {
  resolveConflict,
  pickPrimaryLog,
  resolveScalarLWW,
  mergeByKeyLatestWins,
  unionRemoveExactDuplicates,
};
