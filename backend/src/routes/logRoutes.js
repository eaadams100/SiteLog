const express = require('express');
const { getLogs, getLogById, flagIssue } = require('../controllers/logController');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/v1/logs?projectId=...&startDate=...&endDate=...&limit=...&offset=...
router.get('/', authenticate, getLogs);

// GET /api/v1/logs/:id
router.get('/:id', authenticate, getLogById);

// PUT /api/v1/logs/:id/flag — flagging issues is a project-manager action
router.put('/:id/flag', authenticate, requireRole('pm'), flagIssue);

module.exports = router;