const express = require('express');
const { getConflicts } = require('../controllers/logController');

const router = express.Router();

// GET /api/v1/conflicts?projectId=...
router.get('/', getConflicts);

module.exports = router;
