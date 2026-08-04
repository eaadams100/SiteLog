/**
 * src/controllers/projectController.js
 *
 * Handles the projects endpoints: list, create, get by id.
 */

const Project = require('../models/Project');

/**
 * GET /api/v1/projects
 */
async function getAllProjects(req, res, next) {
  try {
    const projects = await Project.getAll();
    res.json({ success: true, count: projects.length, projects });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/projects
 */
async function createProject(req, res, next) {
  try {
    const { name, location } = req.body ?? {};

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'name is required.' });
    }

    const project = await Project.create({ name: name.trim(), location: location || null });
    res.status(201).json({ success: true, project });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/projects/:id
 */
async function getProjectById(req, res, next) {
  try {
    const project = await Project.getById(req.params.id);
    if (!project) {
      return res.status(404).json({ success: false, error: 'Project not found.' });
    }
    res.json({ success: true, project });
  } catch (err) {
    next(err);
  }
}

module.exports = { getAllProjects, createProject, getProjectById };
