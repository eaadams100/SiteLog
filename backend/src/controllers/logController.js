/**
 * src/controllers/logController.js
 *
 * Handles the read-side endpoints for logs: GET /api/v1/logs and
 * GET /api/v1/logs/:id. Conflict-related reads moved to
 * conflictController.js (Phase 5) for clean separation.
 */

const DailyLog = require('../models/DailyLog');

/**
 * GET /api/v1/logs?projectId=...&startDate=...&endDate=...&limit=...&offset=...
 */
async function getLogs(req, res, next) {
  try {
    const { projectId, startDate, endDate, limit, offset } = req.query;

    if (!projectId) {
      return res.status(400).json({
        success: false,
        error: 'projectId query parameter is required.',
      });
    }

    const parsedLimit = Math.min(parseInt(limit, 10) || 50, 200);
    const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);

    const logs = await DailyLog.getByProject(
      projectId,
      startDate || null,
      endDate || null,
      parsedLimit,
      parsedOffset
    );

    res.json({ success: true, count: logs.length, limit: parsedLimit, offset: parsedOffset, logs });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/logs/:id
 *
 * Note: if this log is a conflict-resolution primary (conflict_resolved
 * = true), the returned `photos` array includes photos from every log in
 * merged_from_logs too, not just this log's own — see
 * DailyLog.getById()'s comment for why.
 */
async function getLogById(req, res, next) {
  try {
    const log = await DailyLog.getById(req.params.id);
    if (!log) {
      return res.status(404).json({ success: false, error: 'Log not found.' });
    }
    res.json({ success: true, log });
  } catch (err) {
    next(err);
  }
}

module.exports = { getLogs, getLogById };
