const express = require('express');
const { syncData } = require('../controllers/syncController');
const validateSyncPayload = require('../middleware/validateSyncPayload');

const router = express.Router();

// POST /api/v1/sync
router.post('/', validateSyncPayload, syncData);

module.exports = router;
