const express = require('express');
const {
  getAllProjects,
  createProject,
  getProjectById,
} = require('../controllers/projectController');

const router = express.Router();

// GET /api/v1/projects
router.get('/', getAllProjects);

// POST /api/v1/projects
router.post('/', createProject);

// GET /api/v1/projects/:id
router.get('/:id', getProjectById);

module.exports = router;
