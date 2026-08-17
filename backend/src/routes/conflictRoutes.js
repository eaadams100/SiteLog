const express = require('express');
const { getConflicts } = require('../controllers/conflictController');

const router = express.Router();

// GET /api/v1/conflicts?projectId=...&limit=...&offset=...
router.get('/', getConflicts);

module.exports = router;
