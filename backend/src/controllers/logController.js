/**
 * src/controllers/logController.js
 *
 * Handles the read-side endpoints the mobile app and web dashboard use to
 * fetch synced data back: GET /api/v1/logs, GET /api/v1/logs/:id, and
 * GET /api/v1/conflicts.
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

/**
 * GET /api/v1/conflicts?projectId=...
 */
async function getConflicts(req, res, next) {
  try {
    const conflicts = await DailyLog.getUnresolvedConflicts(req.query.projectId || null);
    res.json({ success: true, count: conflicts.length, conflicts });
  } catch (err) {
    next(err);
  }
}

module.exports = { getLogs, getLogById, getConflicts };
