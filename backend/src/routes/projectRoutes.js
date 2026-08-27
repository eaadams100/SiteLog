const express = require('express');
const {
  getAllProjects,
  createProject,
  getProjectById,
} = require('../controllers/projectController');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/v1/projects — any authenticated user (needed to pick a project)
router.get('/', authenticate, getAllProjects);

// POST /api/v1/projects — creating a project is a project-manager action
router.post('/', authenticate, requireRole('pm'), createProject);

// GET /api/v1/projects/:id
router.get('/:id', authenticate, getProjectById);

module.exports = router;