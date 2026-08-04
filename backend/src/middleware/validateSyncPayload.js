/**
 * src/middleware/validateSyncPayload.js
 *
 * Validates the shape of a POST /api/v1/sync request body before it
 * reaches the controller. Checks structure and required fields only —
 * business-logic validation (does the project exist, is the date
 * sensible, etc.) happens per-log inside syncController so that one bad
 * log in a batch doesn't reject the entire sync.
 *
 * Expected payload shape:
 * {
 *   "logs": [
 *     {
 *       "id": "uuid",              // matches the mobile app's log id
 *       "project_id": "uuid",
 *       "log_date": "YYYY-MM-DD",
 *       "supervisor_name": "string",
 *       "weather": { "condition": "string", "temp": number },
 *       "workers": [{ "trade": "string", "count": number }],
 *       "materials": [{ "name": "string", "quantity": number, "unit": "string" }],
 *       "issues": [{ "description": "string", "flagged": boolean }],
 *       "notes": "string",
 *       "created_at": "ISO timestamp",
 *       "updated_at": "ISO timestamp",
 *       "photos": [
 *         { "id": "uuid", "file_path": "string", "file_size": number, "width": number, "height": number, "created_at": "ISO timestamp" }
 *       ]
 *     }
 *   ]
 * }
 */

const REQUIRED_LOG_FIELDS = ['id', 'project_id', 'log_date', 'supervisor_name'];

function validateSyncPayload(req, res, next) {
  const { logs } = req.body ?? {};

  if (!Array.isArray(logs)) {
    return res.status(400).json({
      success: false,
      error: 'Request body must include a "logs" array.',
    });
  }

  if (logs.length === 0) {
    return res.status(400).json({
      success: false,
      error: '"logs" array cannot be empty.',
    });
  }

  const invalidEntries = [];

  logs.forEach((log, index) => {
    const missingFields = REQUIRED_LOG_FIELDS.filter((field) => !log?.[field]);
    if (missingFields.length > 0) {
      invalidEntries.push({ index, id: log?.id ?? null, missingFields });
      return;
    }

    const arrayFields = ['workers', 'materials', 'issues', 'photos'];
    const badArrayFields = arrayFields.filter(
      (field) => log[field] !== undefined && !Array.isArray(log[field])
    );
    if (badArrayFields.length > 0) {
      invalidEntries.push({
        index,
        id: log.id,
        error: `Fields must be arrays: ${badArrayFields.join(', ')}`,
      });
    }
  });

  if (invalidEntries.length > 0) {
    return res.status(400).json({
      success: false,
      error: 'One or more log entries in the payload are invalid.',
      invalidEntries,
    });
  }

  next();
}

module.exports = validateSyncPayload;
