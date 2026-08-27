const express = require('express');
const { syncData } = require('../controllers/syncController');
const validateSyncPayload = require('../middleware/validateSyncPayload');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// POST /api/v1/sync — any authenticated user (supervisor or pm) can sync
router.post('/', authenticate, validateSyncPayload, syncData);

module.exports = router;