const express = require('express');
const { getConflicts } = require('../controllers/conflictController');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/v1/conflicts?projectId=...&limit=...&offset=... — managerial oversight data
router.get('/', authenticate, requireRole('pm'), getConflicts);

module.exports = router;