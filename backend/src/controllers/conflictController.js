/**
 * src/controllers/conflictController.js
 *
 * Handles GET /api/v1/conflicts. New in Phase 5, split out from
 * logController.js — conflicts are now a genuinely different concern
 * from plain log reads.
 *
 * Behavior change from Phase 3: this used to list logs stuck in
 * sync_status='conflict', awaiting human review — the "unresolved
 * conflicts" the spec's item 5 describes. Under Phase 5, conflicts
 * resolve automatically and synchronously during sync, so nothing
 * normally stays in that state. This endpoint now serves the conflict
 * HISTORY (the conflict_log audit trail) instead — "here's every
 * automatic merge that's happened", not "here's what's waiting on you".
 * If manual review/override is ever built, this is the natural place to
 * add it back, scoped to whatever the reviewable state ends up being.
 */

const ConflictLog = require('../models/ConflictLog');

/**
 * GET /api/v1/conflicts?projectId=...&limit=...&offset=...
 */
async function getConflicts(req, res, next) {
  try {
    const { projectId, limit, offset } = req.query;

    const parsedLimit = Math.min(parseInt(limit, 10) || 50, 200);
    const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);

    const conflicts = await ConflictLog.getHistory(projectId || null, parsedLimit, parsedOffset);

    res.json({
      success: true,
      count: conflicts.length,
      limit: parsedLimit,
      offset: parsedOffset,
      conflicts,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getConflicts };