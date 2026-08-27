/**
 * src/routes/index.js
 *
 * Aggregates every route module under a single router, mounted at
 * /api/v1 in index.js. Adding a new resource means adding one more
 * `router.use()` line here — nothing else in the app needs to change.
 */

const express = require('express');

const authRoutes = require('./authRoutes');
const syncRoutes = require('./syncRoutes');
const logRoutes = require('./logRoutes');
const conflictRoutes = require('./conflictRoutes');
const projectRoutes = require('./projectRoutes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/sync', syncRoutes);
router.use('/logs', logRoutes);
router.use('/conflicts', conflictRoutes);
router.use('/projects', projectRoutes);

module.exports = router;
