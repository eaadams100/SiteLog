const express = require('express');
const { getLogs, getLogById, flagIssue } = require('../controllers/logController');

const router = express.Router();

// GET /api/v1/logs?projectId=...&startDate=...&endDate=...&limit=...&offset=...
router.get('/', getLogs);

// GET /api/v1/logs/:id
router.get('/:id', getLogById);

// PUT /api/v1/logs/:id/flag
router.put('/:id/flag', flagIssue);

module.exports = router;